import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { ChangePendingEmailDto } from './dto/change-pending-email.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { AccessTokenResponseDto } from './dto/access-token-response.dto';

// signup/changePendingEmail이 공유하는 응답 모양 — 별도 DTO 클래스 없이 순수
// 타입 애노테이션 용도로만 쓴다(런타임 로직 변경 없음). emailVerificationToken은
// 응답에 절대 포함하지 않는다(계정 탈취로 이어지는 보안 이슈였다) — 이메일
// 발송이 연동되기 전까지는 개발 환경 서버 로그로만 확인한다.
type PendingAccountResponse = {
  id: string;
  email: string | null;
  status: UserStatus;
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto): Promise<PendingAccountResponse> {
    return this.authService.signup(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ status: UserStatus }> {
    return this.authService.verifyEmail(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  async resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    await this.authService.resendVerification(dto);
    return {
      message: '요청하신 이메일 주소로 인증 메일 재발송을 처리했습니다.',
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<TokenResponseDto> {
    return this.authService.login(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto): Promise<AccessTokenResponseDto> {
    return this.authService.refresh(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('password/reset-request')
  async requestPasswordReset(
    @Body() dto: PasswordResetRequestDto,
  ): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(dto);
    return {
      message: '가입된 이메일이면 비밀번호 재설정 안내를 보냈습니다.',
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('password/reset-confirm')
  async confirmPasswordReset(
    @Body() dto: PasswordResetConfirmDto,
  ): Promise<{ message: string }> {
    await this.authService.confirmPasswordReset(dto);
    return { message: '비밀번호가 재설정되었습니다.' };
  }

  @HttpCode(HttpStatus.OK)
  @Post('pending-email-change')
  changePendingEmail(
    @Body() dto: ChangePendingEmailDto,
  ): Promise<PendingAccountResponse> {
    return this.authService.changePendingEmail(dto);
  }
}
