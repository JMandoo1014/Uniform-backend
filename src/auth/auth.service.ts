import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { parseDurationToMs } from '../common/utils/duration.util';
import { BCRYPT_SALT_ROUNDS } from '../common/constants/password.constant';
import {
  AccountWithdrawnException,
  EmailAlreadyExistsException,
  EmailChangeNotAllowedException,
  EmailNotVerifiedException,
  InvalidCredentialsException,
  InvalidPasswordResetTokenException,
  SameAsCurrentPasswordException,
  InvalidRefreshTokenException,
  InvalidVerificationTokenException,
  NicknameAlreadyExistsException,
  RecentlyWithdrawnEmailException,
} from '../common/exceptions/business.exception';
import { UserService } from '../user/user.service';
import { MailService } from '../mail/mail.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { ChangePendingEmailDto } from './dto/change-pending-email.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { TokenService } from './token.service';
import { AccessTokenResponseDto } from './dto/access-token-response.dto';
import { JwtPayload } from './types/jwt-payload.type';
import { isIssuedBeforePasswordChange } from './password-change.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly tokenService: TokenService,
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
      termsAgreedAt: new Date(),
      status: UserStatus.PENDING_VERIFICATION,
      emailVerificationToken,
      emailVerificationTokenExpiresAt,
    });

    // 토큰은 메일로만 전달한다 — 응답 본문에 실으면 가입된 이메일만 알아도
    // 누구나 인증을 완료할 수 있는 계정 탈취 경로였다(과거 임시 shim, PR #34
    // 에서 제거). 발송 실패는 회원가입 자체를 실패시키지 않는다(정책은
    // mail.service.ts 주석 참고) — 실패해도 계정은 만들어지고, 사용자는
    // resend-verification으로 재발송받을 수 있다.
    await this.mailService.sendEmailVerification(
      dto.email,
      emailVerificationToken,
      emailVerificationTokenExpiresAt,
    );
    return {
      id: user.id,
      email: user.email,
      status: user.status,
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

    const passwordMatches =
      user.passwordHash !== null &&
      (await bcrypt.compare(dto.password, user.passwordHash));
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

  // Stateless refresh: refreshToken is not rotated on use (no server-side
  // revocation list yet, so rotating would not add real security here). We
  // still re-check the account's current status so a login-time-valid token
  // stops working the moment the account is withdrawn/restricted afterwards.
  async refresh(dto: RefreshTokenDto): Promise<AccessTokenResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(
        dto.refreshToken,
        { secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET') },
      );
    } catch {
      throw new InvalidRefreshTokenException();
    }

    const user = await this.userService.findById(payload.sub);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new InvalidRefreshTokenException();
    }
    // 비밀번호를 바꾸기 전에 발급된 refresh 토큰도 다른 무효 토큰과 같은 401.
    if (isIssuedBeforePasswordChange(payload.iat, user.passwordChangedAt)) {
      throw new InvalidRefreshTokenException();
    }

    const accessToken = await this.tokenService.signAccessToken({
      sub: user.id,
      email: payload.email,
    });

    return { accessToken };
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
      await this.mailService.sendEmailVerification(dto.email, token, expiresAt);
    }
    // Intentionally no return value: the controller always responds with the
    // same generic message regardless of whether a user/email matched.
  }

  // Spec 2.4: "가입 이메일로 재설정 링크를 보낸다. 가입되지 않은 주소여도
  // 같은 안내 문구를 보여준다." 응답 형태(message)는 계정 유무와 무관하게
  // 항상 동일하다 — resetToken은 계정 존재 여부와 무관하게 응답에 절대
  // 포함하지 않는다(가입 이메일만 알면 누구나 비밀번호를 재설정할 수 있는
  // 계정 탈취 취약점이었다). TODO: 실제 이메일 발송(SES/SendGrid 등) 연동.
  async requestPasswordReset(dto: PasswordResetRequestDto): Promise<void> {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      return;
    }

    const { token, expiresAt } = this.buildPasswordResetToken();
    await this.userService.setPasswordResetToken(user.id, token, expiresAt);
    await this.mailService.sendPasswordReset(dto.email, token, expiresAt);
  }

  // 없는·만료된·이미 쓴 토큰과 동시 요청에서 진 쪽은 모두 같은 예외(같은 400
  // 응답)로 끝나서, 응답만으로는 토큰이 있었는지 구분할 수 없다.
  async confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<void> {
    const now = new Date();
    const user = await this.userService.findByPasswordResetToken(dto.token);

    if (
      !user ||
      !user.passwordResetTokenExpiresAt ||
      user.passwordResetTokenExpiresAt.getTime() <= now.getTime()
    ) {
      throw new InvalidPasswordResetTokenException();
    }

    if (
      user.passwordHash !== null &&
      (await bcrypt.compare(dto.newPassword, user.passwordHash))
    ) {
      throw new SameAsCurrentPasswordException();
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_SALT_ROUNDS);
    const consumed = await this.userService.consumePasswordResetToken(
      user.id,
      dto.token,
      passwordHash,
      now,
    );
    if (!consumed) {
      throw new InvalidPasswordResetTokenException();
    }
  }

  // Spec 2.2: "인증 대기: ... 재발송과 가입 이메일 변경만 가능하다." 로그인
  // 전이라 JWT가 없으므로 현재 이메일+비밀번호로 본인 확인한다.
  async changePendingEmail(dto: ChangePendingEmailDto) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new InvalidCredentialsException();
    }

    const passwordMatches =
      user.passwordHash !== null &&
      (await bcrypt.compare(dto.password, user.passwordHash));
    if (!passwordMatches) {
      throw new InvalidCredentialsException();
    }

    if (user.status !== UserStatus.PENDING_VERIFICATION) {
      throw new EmailChangeNotAllowedException();
    }

    const [existingEmail, recentlyWithdrawn] = await Promise.all([
      this.userService.findByEmail(dto.newEmail),
      this.userService.isEmailBlockedByRecentWithdrawal(dto.newEmail),
    ]);
    if (existingEmail) {
      throw new EmailAlreadyExistsException();
    }
    if (recentlyWithdrawn) {
      throw new RecentlyWithdrawnEmailException();
    }

    const { token, expiresAt } = this.buildEmailVerificationToken();
    const updated = await this.userService.setEmailVerificationToken(
      user.id,
      token,
      expiresAt,
      dto.newEmail,
    );

    // requestPasswordReset과 같은 이유로 응답에는 토큰을 절대 포함하지 않는다
    // — 새 이메일로만 발송한다(변경 전 이메일이 아니라 새 이메일 소유를
    // 확인하는 절차이므로).
    await this.mailService.sendEmailVerification(
      dto.newEmail,
      token,
      expiresAt,
    );
    return {
      id: updated.id,
      email: updated.email,
      status: updated.status,
    };
  }

  private buildPasswordResetToken(): { token: string; expiresAt: Date } {
    const ttl = this.configService.get<string>(
      'PASSWORD_RESET_TOKEN_EXPIRES_IN',
      '30m',
    );
    return {
      token: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + parseDurationToMs(ttl)),
    };
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

  private issueTokens(payload: JwtPayload): Promise<TokenResponseDto> {
    return this.tokenService.issueTokens(payload);
  }
}
