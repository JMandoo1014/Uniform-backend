import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { formatKstDateTime } from '../common/utils/kst-date.util';

// Gmail SMTP로 인증/재설정 메일을 보낸다. EMAIL_USER/EMAIL_APP_PASSWORD는
// Gmail 앱 비밀번호(2단계 인증 활성화 후 발급) — 계정 비밀번호 그대로는
// SMTP 인증에 쓸 수 없다.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromAddress: string;
  private readonly frontendUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.fromAddress = this.configService.getOrThrow<string>('EMAIL_USER');
    this.frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:5173',
    );
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // STARTTLS
      auth: {
        user: this.fromAddress,
        pass: this.configService.getOrThrow<string>('EMAIL_APP_PASSWORD'),
      },
    });
  }

  async sendEmailVerification(
    to: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    const link = `${this.frontendUrl}/verify-email?token=${token}`;
    await this.send(
      to,
      '[UniForm] 이메일 인증을 완료해주세요',
      `<p>아래 링크를 눌러 이메일 인증을 완료해주세요.</p>` +
        `<p><a href="${link}">${link}</a></p>` +
        `<p>이 링크는 ${formatKstDateTime(expiresAt)}(KST)까지 유효합니다.</p>` +
        `<p>본인이 요청하지 않았다면 이 메일을 무시해주세요.</p>`,
    );
  }

  async sendPasswordReset(
    to: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    const link = `${this.frontendUrl}/reset-password?token=${token}`;
    await this.send(
      to,
      '[UniForm] 비밀번호 재설정 안내',
      `<p>아래 링크를 눌러 비밀번호를 재설정해주세요.</p>` +
        `<p><a href="${link}">${link}</a></p>` +
        `<p>이 링크는 ${formatKstDateTime(expiresAt)}(KST)까지 유효합니다.</p>` +
        `<p>본인이 요청하지 않았다면 이 메일을 무시해주세요. 비밀번호는 바뀌지 않습니다.</p>`,
    );
  }

  // 발송 실패를 호출자(AuthService)에 전파하지 않는다 — 회원가입/이메일
  // 변경/비밀번호 재설정 요청 자체는 메일 발송 성공 여부와 무관하게 항상
  // 그대로 성공 처리하고, 실패는 여기서 로그로만 남긴다(운영 환경 포함, 항상
  // 로그 — 메일 실패는 토큰 노출과 달리 보안이 아니라 운영 이슈라 숨길
  // 이유가 없다). 사용자는 재발송(resend-verification) 또는 재요청
  // (reset-request)으로 복구한다.
  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        html,
      });
    } catch (error) {
      this.logger.error(
        `메일 발송 실패 (to: ${to}, subject: ${subject}): ${(error as Error).message}`,
      );
    }
  }
}
