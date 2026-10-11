import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UserService } from '../src/user/user.service';

const PASSWORD = 'TestPass123!';
const OLD_VERSION = '2026-08-01';

interface MeBody {
  agreedTermsVersion: string;
  termsAgreedAt: string;
  currentTermsVersion: string;
  needsTermsConsent: boolean;
}

// 실제 DB(DATABASE_URL)를 쓰는 e2e — 메일만 가짜로 바꿔 실제 발송을 막는다.
describe('Terms consent (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userService: UserService;
  const current = process.env.TERMS_VERSION!;
  const suffix = Date.now().toString(36);
  const createdUserIds: string[] = [];
  const usedEmails: string[] = [];

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
    await app.init();
    prisma = app.get(PrismaService);
    userService = app.get(UserService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.withdrawnEmail.deleteMany({
      where: {
        emailHash: {
          in: usedEmails.map((e) => userService.hashWithdrawnEmail(e)),
        },
      },
    });
    await app.close();
  });

  function signup(
    email: string,
    nickname: string,
    agreedTermsVersion: unknown,
  ) {
    return request(app.getHttpServer()).post('/auth/signup').send({
      email,
      password: PASSWORD,
      nickname,
      gender: 'PREFER_NOT_TO_SAY',
      grade: 'NOT_APPLICABLE',
      majorField: 'NOT_APPLICABLE',
      enrollmentStatus: 'NOT_APPLICABLE',
      agreedTermsVersion,
    });
  }

  async function signupVerifyLogin(
    tag: string,
    agreedTermsVersion: string,
  ): Promise<{ userId: string; token: string; signedUpAt: number }> {
    const email = `e2e-terms-${tag}-${suffix}@example.com`;
    usedEmails.push(email);
    const signedUpAt = Date.now();
    const res = await signup(
      email,
      `t${tag}${suffix}`,
      agreedTermsVersion,
    ).expect(201);
    const userId = (res.body as { id: string }).id;
    createdUserIds.push(userId);
    const { emailVerificationToken } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: emailVerificationToken })
      .expect(200);
    // 동의 전에도 로그인은 된다.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      userId,
      token: (login.body as { accessToken: string }).accessToken,
      signedUpAt,
    };
  }

  const me = (token: string) =>
    request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`);

  it.each([['v1'], ['2026-02-30'], ['2026/09/01'], [''], [20260901]])(
    'rejects signup with a terms version that is not a YYYY-MM-DD date (%p)',
    async (version) => {
      const res = await signup(
        `e2e-terms-bad-${suffix}@example.com`,
        `tb${suffix}`,
        version,
      ).expect(400);
      expect(JSON.stringify(res.body)).toContain('YYYY-MM-DD');
    },
  );

  it('stores the agreed version and time at signup, and flags an out-of-date consent', async () => {
    const { userId, token, signedUpAt } = await signupVerifyLogin(
      'a',
      OLD_VERSION,
    );

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(stored.agreedTermsVersion).toBe(OLD_VERSION);
    expect(stored.termsAgreedAt.getTime()).toBeGreaterThanOrEqual(
      signedUpAt - 1000,
    );

    const body = (await me(token).expect(200)).body as MeBody;
    expect(body).toMatchObject({
      agreedTermsVersion: OLD_VERSION,
      currentTermsVersion: current,
      needsTermsConsent: true,
    });
  });

  it('re-consent records the server version (ignoring the client body) and clears the flag', async () => {
    const { token } = await signupVerifyLogin('b', OLD_VERSION);
    const before = (await me(token).expect(200)).body as MeBody;

    const res = await request(app.getHttpServer())
      .post('/users/me/terms-consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ agreedTermsVersion: '1999-01-01' })
      .expect(200);

    const after = res.body as MeBody;
    expect(after).toMatchObject({
      agreedTermsVersion: current,
      currentTermsVersion: current,
      needsTermsConsent: false,
    });
    expect(new Date(after.termsAgreedAt).getTime()).toBeGreaterThan(
      new Date(before.termsAgreedAt).getTime(),
    );
    expect(
      ((await me(token).expect(200)).body as MeBody).needsTermsConsent,
    ).toBe(false);
  });

  it('a member signing up with the current version needs no consent', async () => {
    const { token } = await signupVerifyLogin('c', current);
    expect(
      ((await me(token).expect(200)).body as MeBody).needsTermsConsent,
    ).toBe(false);
  });

  it('requires login for terms consent', async () => {
    await request(app.getHttpServer())
      .post('/users/me/terms-consent')
      .expect(401);
  });

  it('lets a member who has not re-consented still withdraw', async () => {
    const { token } = await signupVerifyLogin('d', OLD_VERSION);
    await request(app.getHttpServer())
      .delete('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });
});
