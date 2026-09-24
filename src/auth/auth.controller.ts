import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { ChangePendingEmailDto } from './dto/change-pending-email.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.authService.resendVerification(dto);
    return {
      message: '요청하신 이메일 주소로 인증 메일 재발송을 처리했습니다.',
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('password/reset-request')
  async requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    const { resetToken } = await this.authService.requestPasswordReset(dto);
    return {
      message: '가입된 이메일이면 비밀번호 재설정 안내를 보냈습니다.',
      ...(resetToken !== undefined ? { resetToken } : {}),
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('password/reset-confirm')
  async confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    await this.authService.confirmPasswordReset(dto);
    return { message: '비밀번호가 재설정되었습니다.' };
  }

  @HttpCode(HttpStatus.OK)
  @Post('pending-email-change')
  changePendingEmail(@Body() dto: ChangePendingEmailDto) {
    return this.authService.changePendingEmail(dto);
  }
}
