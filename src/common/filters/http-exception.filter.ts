import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { maskEmailsInText } from '../utils/mask.util';

// 500 로그에는 요청 body나 사용자가 보낸 값이 들어가지 않게 한다. Prisma
// 오류 메시지는 쿼리 인자(입력값)나 DB 제약 위반 값("Key (email)=(...)")을
// 그대로 담을 수 있어 클래스명과 코드만 남긴다.
function describeError(exception: unknown): string {
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    return `${exception.name} ${exception.code}`;
  }
  if (exception instanceof Prisma.PrismaClientInitializationError) {
    return `${exception.name} ${exception.errorCode ?? ''}`.trim();
  }
  if (
    exception instanceof Prisma.PrismaClientValidationError ||
    exception instanceof Prisma.PrismaClientUnknownRequestError ||
    exception instanceof Prisma.PrismaClientRustPanicError
  ) {
    return exception.name;
  }
  if (exception instanceof Error) {
    return `${exception.name}: ${maskEmailsInText(exception.message)}`;
  }
  return `Non-Error thrown (${typeof exception})`;
}

// stack 첫 줄은 "Name: message"라 위와 같은 이유로 빼고 호출 위치만 남긴다.
function stackFrames(exception: unknown): string | undefined {
  if (!(exception instanceof Error) || !exception.stack) {
    return undefined;
  }
  return exception.stack
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n');
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException
      ? exception.getResponse()
      : 'Internal server error';

    const responseObject =
      typeof exceptionResponse === 'string'
        ? { message: exceptionResponse }
        : (exceptionResponse as { message?: string | string[] } & Record<
            string,
            unknown
          >);
    const { message } = responseObject;
    const extra = Object.fromEntries(
      Object.entries(responseObject).filter(
        ([key]) => key !== 'message' && key !== 'statusCode',
      ),
    );

    if (!isHttpException) {
      const path = request.originalUrl.split('?')[0];
      this.logger.error(
        `${request.method} ${path} — ${describeError(exception)}`,
        stackFrames(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message: message ?? exceptionResponse,
      ...extra,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
