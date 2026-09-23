import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { parseDurationToMs } from '../common/utils/duration.util';
import {
  EmailAlreadyExistsException,
  EmailNotVerifiedException,
  InvalidCredentialsException,
  InvalidVerificationTokenException,
  NicknameAlreadyExistsException,
} from '../common/exceptions/business.exception';
import { UserService } from '../user/user.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { JwtPayload } from './types/jwt-payload.type';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async signup(dto: SignupDto) {
    const [existingEmail, existingNickname] = await Promise.all([
      this.userService.findByEmail(dto.email),
      this.userService.findByNickname(dto.nickname),
    ]);
    if (existingEmail) {
      throw new EmailAlreadyExistsException();
    }
    if (existingNickname) {
      throw new NicknameAlreadyExistsException();
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const emailVerificationToken = randomBytes(32).toString('hex');
    const ttl = this.configService.get<string>(
      'EMAIL_VERIFICATION_TOKEN_EXPIRES_IN',
      '24h',
    );
    const emailVerificationTokenExpiresAt = new Date(
      Date.now() + parseDurationToMs(ttl),
    );

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

    return this.issueTokens({ sub: user.id, email: user.email });
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
