// setup-e2e-env.ts가 올려 둔 테스트용 배수를 끄고 실제 한도로 검증한다(앱을 띄우기 전).
process.env.THROTTLE_LIMIT_MULTIPLIER = '1';

import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { applyTrustProxy } from '../src/common/utils/trust-proxy.util';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

const TOO_MANY = {
  statusCode: 429,
  message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  code: 'TOO_MANY_REQUESTS',
};

// 가드만 검증한다 — AuthService·Prisma는 가짜라 DB 없이 돈다. 요청은 모두
// 127.0.0.1에서 오므로(nginx와 같은 위치) X-Forwarded-For로 접속자 IP를 바꿔 가며
// 테스트마다 다른 IP를 써서 칸이 섞이지 않게 한다.
describe('Rate limiting (e2e)', () => {
  let app: NestExpressApplication;
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `203.0.113.${ipSeq}`;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(MailService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue({
        signup: jest.fn().mockResolvedValue({}),
        login: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({}),
        resendVerification: jest.fn().mockResolvedValue(undefined),
        requestPasswordReset: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    applyTrustProxy(app);
    // 가드는 파이프보다 먼저 돌지만 main.ts와 같은 구성으로 둔다.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    // 한 포트로 한 번만 연다 — supertest가 요청마다 서버를 열고 닫으면 수백 번
    // 연속 요청에서 가끔 socket hang up이 난다.
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, ip: string, body: object = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set('X-Forwarded-For', ip)
      .send(body);

  async function expectLimit(
    send: (i: number) => request.Test,
    allowed: number,
  ): Promise<request.Response> {
    for (let i = 0; i < allowed; i += 1) {
      const res = await send(i);
      expect(res.status).not.toBe(429);
    }
    const blocked = await send(allowed);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject(TOO_MANY);
    expect(blocked.headers['retry-after']).toBeDefined();
    return blocked;
  }

  it('login: 10 per minute per IP (different emails)', async () => {
    const ip = nextIp();
    await expectLimit(
      (i) =>
        post('/auth/login', ip, {
          email: `ip-${i}@example.com`,
          password: 'x',
        }),
      10,
    );
    // 다른 IP는 영향 없음 — X-Forwarded-For(루프백 프록시가 넘긴 값)가 req.ip가 된다.
    const other = await post('/auth/login', nextIp(), {
      email: 'fresh@example.com',
      password: 'x',
    });
    expect(other.status).toBe(200);
  });

  it('login: 10 per 15 minutes per email (case/space-insensitive), across IPs, without echoing the email', async () => {
    const variants = [
      'Victim@Example.com',
      ' victim@example.com ',
      'VICTIM@EXAMPLE.COM',
    ];
    const blocked = await expectLimit(
      (i) =>
        post('/auth/login', nextIp(), {
          email: variants[i % variants.length],
          password: 'wrong',
        }),
      10,
    );
    expect(JSON.stringify(blocked.body).toLowerCase()).not.toContain('victim');
    // 다른 이메일은 영향 없음.
    const other = await post('/auth/login', nextIp(), {
      email: 'someone-else@example.com',
      password: 'x',
    });
    expect(other.status).toBe(200);
  });

  it.each([
    '/auth/signup',
    '/auth/resend-verification',
    '/auth/password/reset-request',
  ])('%s: 5 per 10 minutes per IP', async (path) => {
    const ip = nextIp();
    await expectLimit(() => post(path, ip), 5);
  });

  it('refresh: 30 per minute per IP', async () => {
    const ip = nextIp();
    await expectLimit(
      () => post('/auth/refresh', ip, { refreshToken: 'x' }),
      30,
    );
  });

  it('everything else: 120 per minute per IP', async () => {
    const ip = nextIp();
    // 인증 가드(401)보다 전역 요청 제한이 먼저 돈다.
    await expectLimit(
      () =>
        request(app.getHttpServer())
          .get('/users/me')
          .set('X-Forwarded-For', ip),
      120,
    );
  });
});
