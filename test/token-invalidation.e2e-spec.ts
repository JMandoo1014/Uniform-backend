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
    // 이용 제한의 조치자(createdByAdminId)는 Restrict FK라 회원보다 먼저 지운다.
    await prisma.userRestriction.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
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

  const changePassword = (
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ) =>
    request(app.getHttpServer())
      .patch('/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword, newPassword });

  it("a withdrawn member's leftover access token gets the usual 401 everywhere, including PATCH /users/me", async () => {
    const { id, email } = await createActiveUser();
    const tokens = await login(email, OLD_PASSWORD);

    await request(app.getHttpServer())
      .delete('/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(204);

    const patched = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ nickname: 'revived1' })
      .expect(401);
    const garbage = await me('not-a-jwt').expect(401);
    expect(shape(patched.body as Record<string, unknown>)).toEqual({
      ...shape(garbage.body as Record<string, unknown>),
      path: '/users/me',
    });
    await me(tokens.accessToken).expect(401);
    await refresh(tokens.refreshToken).expect(401);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(stored.status).toBe('WITHDRAWN');
    expect(stored.nickname).toBeNull();
  });

  it("password change: other devices' tokens get 401, the tokens in the response keep this device signed in", async () => {
    const { id, email } = await createActiveUser();
    const deviceA = await login(email, OLD_PASSWORD);
    const deviceB = await login(email, OLD_PASSWORD);

    await waitForNextSecond();
    const res = await changePassword(
      deviceA.accessToken,
      OLD_PASSWORD,
      NEW_PASSWORD,
    ).expect(200);
    const fresh = res.body as Tokens;
    expect(Object.keys(fresh).sort()).toEqual(['accessToken', 'refreshToken']);

    // 다른 기기(B)와 요청한 기기의 이전 토큰은 401
    await me(deviceB.accessToken).expect(401);
    await refresh(deviceB.refreshToken).expect(401);
    await me(deviceA.accessToken).expect(401);

    // 응답의 새 토큰은 바로 쓸 수 있다
    await me(fresh.accessToken).expect(200);
    await refresh(fresh.refreshToken).expect(200);

    const { passwordChangedAt } = await prisma.user.findUniqueOrThrow({
      where: { id },
    });
    const changedSec = Math.floor(passwordChangedAt!.getTime() / 1000);
    expect(iatOf(fresh.accessToken)).toBeGreaterThanOrEqual(changedSec);
    expect(iatOf(fresh.refreshToken)).toBeGreaterThanOrEqual(changedSec);
  });

  it('the new tokens work even when the change and their issue land in the same second (5 changes in a row)', async () => {
    const { id, email } = await createActiveUser();
    let current = OLD_PASSWORD;
    let tokens = await login(email, current);

    for (let i = 1; i <= 5; i += 1) {
      const next = `Rotate${i}Pass12!`;
      const res = await changePassword(
        tokens.accessToken,
        current,
        next,
      ).expect(200);
      tokens = res.body as Tokens;
      current = next;

      await me(tokens.accessToken).expect(200);
      await refresh(tokens.refreshToken).expect(200);
      const { passwordChangedAt } = await prisma.user.findUniqueOrThrow({
        where: { id },
      });
      expect(iatOf(tokens.accessToken)).toBeGreaterThanOrEqual(
        Math.floor(passwordChangedAt!.getTime() / 1000),
      );
    }
  });

  it('wrong current password and same password are 400 with codes, and change nothing', async () => {
    const { id, email } = await createActiveUser();
    const tokens = await login(email, OLD_PASSWORD);

    const wrong = await changePassword(
      tokens.accessToken,
      'Wrong1234!',
      NEW_PASSWORD,
    ).expect(400);
    expect(shape(wrong.body as Record<string, unknown>)).toEqual({
      statusCode: 400,
      message: '현재 비밀번호가 올바르지 않습니다.',
      code: 'CURRENT_PASSWORD_MISMATCH',
      path: '/users/me/password',
    });

    const same = await changePassword(
      tokens.accessToken,
      OLD_PASSWORD,
      OLD_PASSWORD,
    ).expect(400);
    expect(same.body).toMatchObject({
      message: '현재 비밀번호와 다른 비밀번호를 입력해주세요',
      code: 'SAME_AS_CURRENT_PASSWORD',
    });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(stored.passwordChangedAt).toBeNull();
    await me(tokens.accessToken).expect(200);
  });

  it('a restricted member can still log in and use /users/me; publishing is 403; refresh stays rejected (current behavior)', async () => {
    const { id, email } = await createActiveUser();
    await prisma.user.update({ where: { id }, data: { status: 'RESTRICTED' } });
    await prisma.userRestriction.create({
      data: { userId: id, reason: 'e2e 제한', createdByAdminId: id },
    });

    const tokens = await login(email, OLD_PASSWORD);
    const profile = await me(tokens.accessToken).expect(200);
    expect(profile.body).toMatchObject({
      status: 'RESTRICTED',
      restriction: { reason: 'e2e 제한' },
    });

    const draft = await request(app.getHttpServer())
      .post('/surveys/drafts')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ title: 'e2e 제한 회원 초안' })
      .expect(201);
    const draftId = (draft.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/surveys/drafts/${draftId}/publish`)
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(403);
    await prisma.survey.delete({ where: { id: draftId } });

    // AuthService.refresh는 ACTIVE가 아니면 거부한다(주석에 의도로 적힌 동작).
    await refresh(tokens.refreshToken).expect(401);
  });
});
