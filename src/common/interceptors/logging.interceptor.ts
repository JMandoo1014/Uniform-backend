import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    // 쿼리스트링은 남기지 않는다 — 관리자 회원 검색(?email=&nickname=)처럼
    // 개인정보가 쿼리로 들어오는 경로가 있고, 키 이름으로 골라 가리는 방식은
    // 새 파라미터가 생길 때 빠뜨리기 쉽다.
    const path = request.originalUrl.split('?')[0];
    const { method } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.logger.log(`${method} ${path} ${Date.now() - start}ms`);
      }),
    );
  }
}
