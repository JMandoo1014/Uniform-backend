import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { JwtPayload } from '../types/jwt-payload.type';

// JwtAuthGuard와 같은 'jwt' 전략을 쓰지만, 토큰이 없거나 유효하지 않아도
// 401을 던지지 않고 그냥 통과시킨다(req.user가 undefined로 남는다) — 로그인
// 여부와 무관하게 써야 하는 엔드포인트(예: 비로그인도 가능한 문의 접수)에서
// "로그인했으면 신원을 알고 싶다"는 경우에 쓴다.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = JwtPayload>(
    _err: unknown,
    user: TUser | false,
  ): TUser | undefined {
    return user || undefined;
  }
}
