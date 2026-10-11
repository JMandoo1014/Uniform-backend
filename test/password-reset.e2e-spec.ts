import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

const OLD_PASSWORD = 'OldPass1234!';
const INVALID_TOKEN_MESSAGE = '유효하지 않거나 만료된 재설정 토큰입니다.';
const INVALID_TOKEN_CODE = 'INVALID_PASSWORD_RESET_TOKEN';

// 실제 DB(DATABASE_URL)를 쓰는 e2e — 메일만 가짜로 바꿔 실제 발송을 막는다.
// 토큰은 테스트 안에서 DB로만 읽고 출력하지 않는다.
describe('Password reset (e2e)', () => {
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
    // main.ts와 같은 전역 필터 — 운영과 같은 오류 응답 모양(path·timestamp)으로 비교한다.
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
    const email = `e2e-reset-${seq}-${suffix}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        nickname: `rs${seq}${suffix}`.slice(0, 12),
        passwordHash: await bcrypt.hash(OLD_PASSWORD, 10),
        status: 'ACTIVE',
        agreedTermsVersion: '2026-09-01',
      },
    });
    createdUserIds.push(user.id);
    return { id: user.id, email };
  }

  const requestReset = (email: string) =>
    request(app.getHttpServer())
      .post('/auth/password/reset-request')
      .send({ email })
      .expect(200);

  async function currentToken(userId: string): Promise<string> {
    const { passwordResetToken } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (!passwordResetToken) throw new Error('no reset token stored');
    return passwordResetToken;
  }

  const confirm = (token: string, newPassword: string) =>
    request(app.getHttpServer())
      .post('/auth/password/reset-confirm')
      .send({ token, newPassword });

  const loginStatus = async (email: string, password: string) =>
    (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
    ).status;

  // timestamp는 매번 달라서 빼고 비교한다.
  const shape = (body: Record<string, unknown>) => {
    const rest = { ...body };
    delete rest.timestamp;
    return rest;
  };

  it('a reset token works only once', async () => {
    const { id, email } = await createActiveUser();
    await requestReset(email);
    const token = await currentToken(id);

    await confirm(token, 'NewPass1234!').expect(200);
    const second = await confirm(token, 'Other1234!').expect(400);

    expect(second.body).toMatchObject({
      message: INVALID_TOKEN_MESSAGE,
      code: INVALID_TOKEN_CODE,
    });
    expect(await loginStatus(email, 'NewPass1234!')).toBe(200);
    expect(await loginStatus(email, 'Other1234!')).toBe(401);
  });

  it('two concurrent confirms with the same token: exactly one succeeds', async () => {
    const { id, email } = await createActiveUser();
    await requestReset(email);
    const token = await currentToken(id);

    const results = await Promise.all([
      confirm(token, 'RaceA1234!'),
      confirm(token, 'RaceB1234!'),
    ]);
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([200, 400]);
    const loser = results.find((r) => r.status === 400)!;
    expect(loser.body).toMatchObject({
      message: INVALID_TOKEN_MESSAGE,
      code: INVALID_TOKEN_CODE,
    });
    const winnerPassword =
      results[0].status === 200 ? 'RaceA1234!' : 'RaceB1234!';
    const loserPassword =
      winnerPassword === 'RaceA1234!' ? 'RaceB1234!' : 'RaceA1234!';
    expect(await loginStatus(email, winnerPassword)).toBe(200);
    expect(await loginStatus(email, loserPassword)).toBe(401);
  });

  it('rejects the current password as the new one, without consuming the token', async () => {
    const { id, email } = await createActiveUser();
    await requestReset(email);
    const token = await currentToken(id);

    const res = await confirm(token, OLD_PASSWORD).expect(400);
    expect(res.body).toMatchObject({
      message: '현재 비밀번호와 다른 비밀번호를 입력해주세요',
      code: 'SAME_AS_CURRENT_PASSWORD',
    });

    // 토큰은 그대로 살아 있어 다른 비밀번호로 다시 시도할 수 있다.
    await confirm(token, 'Fresh1234!').expect(200);
    expect(await loginStatus(email, 'Fresh1234!')).toBe(200);
  });

  it('expired, already-used and unknown tokens get the identical 400 response', async () => {
    const expired = await createActiveUser();
    await requestReset(expired.email);
    const expiredToken = await currentToken(expired.id);
    await prisma.user.update({
      where: { id: expired.id },
      data: { passwordResetTokenExpiresAt: new Date(Date.now() - 1000) },
    });

    const used = await createActiveUser();
    await requestReset(used.email);
    const usedToken = await currentToken(used.id);
    await confirm(usedToken, 'Used1234!').expect(200);

    const unknownToken = randomBytes(32).toString('hex');

    const responses = await Promise.all(
      [expiredToken, usedToken, unknownToken].map((t) =>
        confirm(t, 'Whatever1234!').expect(400),
      ),
    );
    const shapes = responses.map((r) =>
      shape(r.body as Record<string, unknown>),
    );
    expect(shapes[0]).toEqual({
      statusCode: 400,
      message: INVALID_TOKEN_MESSAGE,
      code: INVALID_TOKEN_CODE,
      path: '/auth/password/reset-confirm',
    });
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
    // 만료 토큰으로는 비밀번호가 바뀌지 않았다.
    expect(await loginStatus(expired.email, OLD_PASSWORD)).toBe(200);
  });

  it('only the most recently requested token is valid', async () => {
    const { id, email } = await createActiveUser();
    await requestReset(email);
    const first = await currentToken(id);
    await requestReset(email);
    const second = await currentToken(id);
    expect(second).not.toBe(first);

    const stale = await confirm(first, 'First1234!').expect(400);
    expect(stale.body).toMatchObject({ code: INVALID_TOKEN_CODE });
    await confirm(second, 'Second1234!').expect(200);
  });

  it('a successful reset leaves no reset token stored for the member', async () => {
    const { id, email } = await createActiveUser();
    await requestReset(email);
    await confirm(await currentToken(id), 'Clear1234!').expect(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(stored.passwordResetToken).toBeNull();
    expect(stored.passwordResetTokenExpiresAt).toBeNull();
  });
});
