import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

const OLD_PASSWORD = 'OldPass1234!';
const NEW_PASSWORD = 'NewPass1234!';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

// 실제 DB(DATABASE_URL)를 쓰는 e2e — 메일만 가짜로 바꿔 실제 발송을 막는다.
// 토큰 값은 출력하지 않는다.
describe('Tokens issued before a password change (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = Date.now().toString(36);
  const createdUserIds: string[] = [];
  let seq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({
        sendEmailVerification: jest.fn(),
        sendPasswordReset: jest.fn(),
        sendInquiryNotification: jest.fn(),
        sendNotice: jest.fn(),
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    // main.ts와 같은 전역 필터 — 운영과 같은 401 응답 모양으로 비교한다.
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  async function createActiveUser(): Promise<{ id: string; email: string }> {
    seq += 1;
    const email = `e2e-tokinv-${seq}-${suffix}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        nickname: `ti${seq}${suffix}`.slice(0, 12),
        passwordHash: await bcrypt.hash(OLD_PASSWORD, 10),
        status: 'ACTIVE',
        agreedTermsVersion: '2026-09-01',
      },
    });
    createdUserIds.push(user.id);
    return { id: user.id, email };
  }

  async function login(email: string, password: string): Promise<Tokens> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body as Tokens;
  }

  async function resetPassword(userId: string, email: string) {
    await request(app.getHttpServer())
      .post('/auth/password/reset-request')
      .send({ email })
      .expect(200);
    const { passwordResetToken } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await request(app.getHttpServer())
      .post('/auth/password/reset-confirm')
      .send({ token: passwordResetToken, newPassword: NEW_PASSWORD })
      .expect(200);
  }

  const me = (accessToken: string) =>
    request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

  const refresh = (refreshToken: string) =>
    request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });

  const iatOf = (jwt: string): number =>
    (
      JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as {
        iat: number;
      }
    ).iat;

  // 다음 초가 시작될 때까지 기다린다 — "재설정 전에 발급된" 토큰을 확실히 만들기 위해.
  const waitForNextSecond = () =>
    new Promise((resolve) =>
      setTimeout(resolve, 1000 - (Date.now() % 1000) + 20),
    );

  const shape = (body: Record<string, unknown>) => {
    const rest = { ...body };
    delete rest.timestamp;
    return rest;
  };

  it('rejects access and refresh tokens issued before a password reset with the usual 401 bodies', async () => {
    const { id, email } = await createActiveUser();
    const old = await login(email, OLD_PASSWORD);
    await me(old.accessToken).expect(200);

    await waitForNextSecond();
    await resetPassword(id, email);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(stored.passwordChangedAt).not.toBeNull();

    // access: 서명이 틀린 토큰과 똑같은 401
    const rejectedAccess = await me(old.accessToken).expect(401);
    const garbageAccess = await me('not-a-jwt').expect(401);
    expect(shape(rejectedAccess.body as Record<string, unknown>)).toEqual(
      shape(garbageAccess.body as Record<string, unknown>),
    );
    expect(shape(rejectedAccess.body as Record<string, unknown>)).toEqual({
      statusCode: 401,
      message: 'Unauthorized',
      path: '/users/me',
    });

    // refresh: 서명이 틀린 refresh 토큰과 똑같은 401
    const rejectedRefresh = await refresh(old.refreshToken).expect(401);
    const garbageRefresh = await refresh('not-a-jwt').expect(401);
    expect(shape(rejectedRefresh.body as Record<string, unknown>)).toEqual(
      shape(garbageRefresh.body as Record<string, unknown>),
    );
  });

  it('a fresh login right after the reset works for both tokens', async () => {
    const { id, email } = await createActiveUser();
    await resetPassword(id, email);

    const fresh = await login(email, NEW_PASSWORD);
    await me(fresh.accessToken).expect(200);
    await refresh(fresh.refreshToken).expect(200);
  });

  it('boundary: a token issued in the same second as the change is accepted, an earlier second is not', async () => {
    const { id, email } = await createActiveUser();
    const tokens = await login(email, OLD_PASSWORD);
    const accessIat = iatOf(tokens.accessToken);
    const refreshIat = iatOf(tokens.refreshToken);

    const setChangedAt = (date: Date) =>
      prisma.user.update({ where: { id }, data: { passwordChangedAt: date } });

    // 같은 초의 끝(.999) — 토큰보다 늦게 바뀌었지만 같은 초라 통과
    await setChangedAt(new Date(accessIat * 1000 + 999));
    await me(tokens.accessToken).expect(200);
    await setChangedAt(new Date(refreshIat * 1000 + 999));
    await refresh(tokens.refreshToken).expect(200);

    // 다음 초의 시작 — 토큰 iat가 더 작으므로 거부
    await setChangedAt(new Date((accessIat + 1) * 1000));
    await me(tokens.accessToken).expect(401);
    await setChangedAt(new Date((refreshIat + 1) * 1000));
    await refresh(tokens.refreshToken).expect(401);
  });

  it('members who never changed their password (passwordChangedAt null) are unaffected', async () => {
    const { id, email } = await createActiveUser();
    const tokens = await login(email, OLD_PASSWORD);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(stored.passwordChangedAt).toBeNull();
    await me(tokens.accessToken).expect(200);
    await refresh(tokens.refreshToken).expect(200);
  });
});
