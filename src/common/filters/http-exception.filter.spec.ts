import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BusinessException,
  InvalidCredentialsException,
  InvalidPasswordResetTokenException,
  SameAsCurrentPasswordException,
} from '../exceptions/business.exception';
import { HttpExceptionFilter } from './http-exception.filter';

function buildHost() {
  const json = jest.fn();
  const response = { status: jest.fn(() => ({ json })) };
  const request = {
    method: 'POST',
    url: '/admin/users?email=secret@example.com',
    originalUrl: '/admin/users?email=secret@example.com',
    body: { email: 'body@example.com', password: 'p@ssw0rd!' },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, response, json };
}

describe('HttpExceptionFilter', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  function loggedText(): string {
    return (errorSpy.mock.calls as unknown[][])
      .flat()
      .map((part) => String(part))
      .join('\n');
  }

  it('logs method, path without query, message and stack frames for a 500', () => {
    const { host, response } = buildHost();

    new HttpExceptionFilter().catch(
      new TypeError('cannot read x of undefined'),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(500);
    const [[message, stack]] = errorSpy.mock.calls as [[string, string]];
    expect(message).toBe(
      'POST /admin/users — TypeError: cannot read x of undefined',
    );
    expect(stack).toMatch(/^\s*at /);
    expect(stack).not.toContain('cannot read x of undefined');
    expect(loggedText()).not.toContain('secret@example.com');
    expect(loggedText()).not.toContain('body@example.com');
    expect(loggedText()).not.toContain('p@ssw0rd!');
  });

  it('keeps Prisma error messages (which can carry input values) out of the log', () => {
    const { host } = buildHost();
    const error = new Prisma.PrismaClientValidationError(
      'Invalid `prisma.user.create()` invocation: { data: { email: "body@example.com" } }',
      { clientVersion: 'test' },
    );

    new HttpExceptionFilter().catch(error, host);

    expect(loggedText()).toContain(
      'POST /admin/users — PrismaClientValidationError',
    );
    expect(loggedText()).not.toContain('body@example.com');
    expect(loggedText()).not.toContain('invocation');
  });

  it('does not log handled HTTP exceptions', () => {
    const { host, response } = buildHost();

    new HttpExceptionFilter().catch(new NotFoundException(), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // body-parser(http-errors)가 만드는 오류 모양: status/statusCode, expose, type.
  function bodyParserError(status: number, message: string, type: string) {
    return Object.assign(new Error(message), {
      status,
      statusCode: status,
      expose: status < 500,
      type,
    });
  }

  it('answers 413 (not 500) when body-parser rejects an oversized body', () => {
    const { host, response, json } = buildHost();

    new HttpExceptionFilter().catch(
      bodyParserError(413, 'request entity too large', 'entity.too.large'),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        message: 'request entity too large',
        error: 'Payload Too Large',
      }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps other body-parser client errors at their own status (415)', () => {
    const { host, response } = buildHost();

    new HttpExceptionFilter().catch(
      bodyParserError(
        415,
        'unsupported charset "UTF-7"',
        'charset.unsupported',
      ),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(415);
  });

  it('still treats plain errors that merely carry a status as 500', () => {
    const { host, response } = buildHost();
    const error = Object.assign(new Error('boom'), { status: 404 });

    new HttpExceptionFilter().catch(error, host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(errorSpy).toHaveBeenCalled();
  });

  describe('BusinessException code', () => {
    function bodyOf(exception: unknown): Record<string, unknown> {
      const { host, json } = buildHost();
      new HttpExceptionFilter().catch(exception, host);
      const [[body]] = json.mock.calls as [[Record<string, unknown>]];
      return body;
    }

    it('adds code next to the usual fields when the exception has one', () => {
      expect(bodyOf(new BusinessException('메시지', 409, 'SOME_CODE'))).toEqual(
        {
          statusCode: 409,
          message: '메시지',
          code: 'SOME_CODE',
          path: '/admin/users?email=secret@example.com',
          timestamp: expect.any(String) as string,
        },
      );
    });

    it('keeps the old response shape (no code key) for exceptions without a code', () => {
      const body = bodyOf(new InvalidCredentialsException());
      expect(body).toEqual({
        statusCode: 401,
        message: '이메일 또는 비밀번호가 올바르지 않습니다.',
        path: '/admin/users?email=secret@example.com',
        timestamp: expect.any(String) as string,
      });
      expect('code' in body).toBe(false);
    });

    it('password reset errors carry their fixed codes with unchanged messages', () => {
      expect(bodyOf(new SameAsCurrentPasswordException())).toMatchObject({
        statusCode: 400,
        message: '현재 비밀번호와 다른 비밀번호를 입력해주세요',
        code: 'SAME_AS_CURRENT_PASSWORD',
      });
      expect(bodyOf(new InvalidPasswordResetTokenException())).toMatchObject({
        statusCode: 400,
        message: '유효하지 않거나 만료된 재설정 토큰입니다.',
        code: 'INVALID_PASSWORD_RESET_TOKEN',
      });
    });
  });
});
