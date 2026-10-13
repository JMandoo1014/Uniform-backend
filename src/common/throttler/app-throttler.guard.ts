import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { Response } from 'express';
import { TooManyRequestsException } from '../exceptions/business.exception';

// 기본 ThrottlerException 대신 다른 오류와 같은 { statusCode, message, code } 모양으로
// 429를 낸다. tracker(IP·이메일 해시)는 응답에도 로그에도 남기지 않는다.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    context: ExecutionContext,
    { timeToBlockExpire }: ThrottlerLimitDetail,
  ): Promise<void> {
    // 이름 붙은 제한(loginEmail)은 라이브러리가 Retry-After-loginEmail로만 내려 주므로
    // 어떤 제한에 걸렸든 표준 Retry-After(초)를 함께 둔다.
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(timeToBlockExpire));
    throw new TooManyRequestsException();
  }
}
