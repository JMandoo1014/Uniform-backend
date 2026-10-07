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
import { STATUS_CODES } from 'http';
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

// body-parser가 던지는 클라이언트 오류(413 entity.too.large, 415
// charset/encoding.unsupported, 400 request.aborted 등). Nest는 잘못된 JSON
// (SyntaxError)만 400으로 바꿔 주고 나머지는 그대로 넘기므로, 여기서 원래 상태
// 코드로 돌려주지 않으면 500이 된다. http-errors가 노출해도 된다고 표시한
// (expose) 4xx만 바꾼다.
function fromBodyParserError(exception: unknown): HttpException | null {
  if (!(exception instanceof Error)) {
    return null;
  }
  const { status, expose, type } = exception as Error & {
    status?: unknown;
    expose?: unknown;
    type?: unknown;
  };
  if (
    typeof type !== 'string' ||
    expose !== true ||
    typeof status !== 'number' ||
    status < 400 ||
    status >= 500
  ) {
    return null;
  }
  return new HttpException(
    {
      statusCode: status,
      message: exception.message,
      error: STATUS_CODES[status],
    },
    status,
  );
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(caught: unknown, host: ArgumentsHost) {
    const exception = fromBodyParserError(caught) ?? caught;
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
