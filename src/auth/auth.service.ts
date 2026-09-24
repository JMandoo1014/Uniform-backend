import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { parseDurationToMs } from '../common/utils/duration.util';
import { BCRYPT_SALT_ROUNDS } from '../common/constants/password.constant';
import {
  AccountWithdrawnException,
  EmailAlreadyExistsException,
  EmailNotVerifiedException,
  InvalidCredentialsException,
  InvalidVerificationTokenException,
  NicknameAlreadyExistsException,
  RecentlyWithdrawnEmailException,
} from '../common/exceptions/business.exception';
import { UserService } from '../user/user.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { JwtPayload } from './types/jwt-payload.type';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async signup(dto: SignupDto) {
    const [existingEmail, existingNickname, recentlyWithdrawn] =
      await Promise.all([
        this.userService.findByEmail(dto.email),
        this.userService.findByNickname(dto.nickname),
        this.userService.isEmailBlockedByRecentWithdrawal(dto.email),
      ]);
    if (existingEmail) {
      throw new EmailAlreadyExistsException();
    }
    if (existingNickname) {
      throw new NicknameAlreadyExistsException();
    }
    if (recentlyWithdrawn) {
      throw new RecentlyWithdrawnEmailException();
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    const {
      token: emailVerificationToken,
      expiresAt: emailVerificationTokenExpiresAt,
    } = this.buildEmailVerificationToken();

    const user = await this.userService.create({
      email: dto.email,
      passwordHash,
      nickname: dto.nickname,
      gender: dto.gender,
      grade: dto.grade,
      majorField: dto.majorField,
      enrollmentStatus: dto.enrollmentStatus,
      marketingOptIn: dto.marketingOptIn ?? false,
      agreedTermsVersion: dto.agreedTermsVersion,
      status: UserStatus.PENDING_VERIFICATION,
      emailVerificationToken,
      emailVerificationTokenExpiresAt,
    });

    // TODO: wire up an actual email provider. For now the token is returned
    // directly so the signup -> verify flow can be exercised end-to-end.
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      emailVerificationToken,
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.userService.findByVerificationToken(dto.token);

    if (
      !user ||
      !user.emailVerificationTokenExpiresAt ||
      user.emailVerificationTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new InvalidVerificationTokenException();
    }

    await this.userService.activateByVerificationToken(user.id);

    return { status: UserStatus.ACTIVE };
  }

  async login(dto: LoginDto): Promise<TokenResponseDto> {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new InvalidCredentialsException();
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new InvalidCredentialsException();
    }

    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new EmailNotVerifiedException();
    }
    if (user.status === UserStatus.WITHDRAWN) {
      throw new AccountWithdrawnException();
    }

    return this.issueTokens({ sub: user.id, email: dto.email });
  }

  // Spec 2.2: "인증 대기" 상태에서 재발송 요청 가능. 계정 존재 여부를 노출하지
  // 않기 위해 항상 같은 응답을 반환하고, 실제 재발송 처리는 내부적으로만 한다.
  async resendVerification(dto: ResendVerificationDto): Promise<void> {
    const user = await this.userService.findByEmail(dto.email);
    if (user && user.status === UserStatus.PENDING_VERIFICATION) {
      const { token, expiresAt } = this.buildEmailVerificationToken();
      await this.userService.setEmailVerificationToken(
        user.id,
        token,
        expiresAt,
      );
    }
    // Intentionally no return value: the controller always responds with the
    // same generic message regardless of whether a user/email matched.
  }

  private buildEmailVerificationToken(): { token: string; expiresAt: Date } {
    const ttl = this.configService.get<string>(
      'EMAIL_VERIFICATION_TOKEN_EXPIRES_IN',
      '24h',
    );
    return {
      token: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + parseDurationToMs(ttl)),
    };
  }

  private async issueTokens(payload: JwtPayload): Promise<TokenResponseDto> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_EXPIRES_IN',
          '15m',
        ) as JwtSignOptions['expiresIn'],
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
          '7d',
        ) as JwtSignOptions['expiresIn'],
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
