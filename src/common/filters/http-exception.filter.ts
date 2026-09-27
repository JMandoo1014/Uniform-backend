import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

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
      this.logger.error(exception);
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
