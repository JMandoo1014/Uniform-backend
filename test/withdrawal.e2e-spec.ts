import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { legacySha256Email } from '../src/common/utils/email-hash.util';
import { UserService } from '../src/user/user.service';

const PASSWORD = 'TestPass123!';
const DAY_MS = 24 * 60 * 60 * 1000;

// 실제 DB(DATABASE_URL)를 쓰는 e2e — 메일만 가짜로 바꿔 실제 발송을 막는다.
describe('Withdrawal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hashEmail: (email: string) => string;

  const suffix = Date.now().toString(36);
  const usedEmails: string[] = [];
  const createdUserIds: string[] = [];
  const createdSurveyIds: string[] = [];

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
    const userService = app.get(UserService);
    hashEmail = (email) => userService.hashWithdrawnEmail(email);
  });

  afterAll(async () => {
    await prisma.survey.deleteMany({ where: { id: { in: createdSurveyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.withdrawnEmail.deleteMany({
      where: {
        emailHash: {
          in: usedEmails.flatMap((e) => [hashEmail(e), legacySha256Email(e)]),
        },
      },
    });
    await app.close();
  });

  function signupBody(email: string, nickname: string) {
    return {
      email,
      password: PASSWORD,
      nickname,
      gender: 'PREFER_NOT_TO_SAY',
      grade: 'NOT_APPLICABLE',
      majorField: 'NOT_APPLICABLE',
      enrollmentStatus: 'NOT_APPLICABLE',
      agreedTermsVersion: 'v1',
    };
  }

  async function signupVerifyAndLogin(
    email: string,
    nickname: string,
  ): Promise<{ userId: string; accessToken: string }> {
    if (!usedEmails.includes(email)) usedEmails.push(email);
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send(signupBody(email, nickname))
      .expect(201);
    const userId = (signup.body as { id: string }).id;
    createdUserIds.push(userId);

    const { emailVerificationToken } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: emailVerificationToken })
      .expect(200);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      userId,
      accessToken: (login.body as { accessToken: string }).accessToken,
    };
  }

  function withdraw(accessToken: string) {
    return request(app.getHttpServer())
      .delete('/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
  }

  it('lets a user who re-signed up after 30 days withdraw again', async () => {
    const email = `e2e-rewd-${suffix}@example.com`;
    const first = await signupVerifyAndLogin(email, `wa${suffix}`);
    await withdraw(first.accessToken).expect(204);

    // 30일 이내 재가입은 막힌다.
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(signupBody(email, `wb${suffix}`))
      .expect(409);

    // 30일이 지난 것으로 만든다.
    await prisma.withdrawnEmail.update({
      where: { emailHash: hashEmail(email) },
      data: { withdrawnAt: new Date(Date.now() - 31 * DAY_MS) },
    });

    const second = await signupVerifyAndLogin(email, `wc${suffix}`);
    const beforeSecondWithdrawal = Date.now();
    await withdraw(second.accessToken).expect(204);

    const rows = await prisma.withdrawnEmail.findMany({
      where: { emailHash: hashEmail(email) },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].withdrawnAt.getTime()).toBeGreaterThanOrEqual(
      beforeSecondWithdrawal - 1000,
    );
  });

  it('clears credentials, tokens and profile history but keeps submitted responses', async () => {
    const email = `e2e-wdclr-${suffix}@example.com`;
    const { userId, accessToken } = await signupVerifyAndLogin(
      email,
      `wd${suffix}`,
    );

    // 프로필 이력을 남긴다.
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nickname: `we${suffix}` })
      .expect(200);
    // 남아 있을 수 있는 재설정 토큰을 만든다.
    await request(app.getHttpServer())
      .post('/auth/password/reset-request')
      .send({ email })
      .expect(200);

    // 다른 사람 설문에 제출한 응답 하나.
    const survey = await prisma.survey.create({
      data: {
        ownerType: 'USER',
        ownerId: 'e2e-other-owner',
        creatorId: 'e2e-other-owner',
        title: 'e2e 응답 보존 확인용',
        status: 'RECRUITING',
      },
    });
    createdSurveyIds.push(survey.id);
    const session = await prisma.responseSession.create({
      data: {
        surveyId: survey.id,
        userId,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        answers: { create: { questionId: 'q1', value: '응답 원문' } },
      },
    });

    expect(
      await prisma.userProfileHistory.count({ where: { userId } }),
    ).toBeGreaterThan(0);

    await withdraw(accessToken).expect(204);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({
      status: 'WITHDRAWN',
      email: null,
      passwordHash: null,
      nickname: null,
      emailVerificationToken: null,
      emailVerificationTokenExpiresAt: null,
      passwordResetToken: null,
      passwordResetTokenExpiresAt: null,
    });
    expect(await prisma.userProfileHistory.count({ where: { userId } })).toBe(
      0,
    );
    expect(
      await prisma.responseSession.findUnique({ where: { id: session.id } }),
    ).not.toBeNull();
    expect(
      await prisma.sessionAnswer.count({ where: { sessionId: session.id } }),
    ).toBe(1);
  });

  it('still blocks re-signup against a pre-HMAC (plain SHA-256) row for 30 days', async () => {
    const email = `e2e-legacy-${suffix}@example.com`;
    usedEmails.push(email);
    await prisma.withdrawnEmail.create({
      data: { emailHash: legacySha256Email(email), withdrawnAt: new Date() },
    });

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send(signupBody(email, `wf${suffix}`))
      .expect(409);

    await prisma.withdrawnEmail.update({
      where: { emailHash: legacySha256Email(email) },
      data: { withdrawnAt: new Date(Date.now() - 31 * DAY_MS) },
    });
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send(signupBody(email, `wg${suffix}`))
      .expect(201);
    createdUserIds.push((signup.body as { id: string }).id);
  });

  it('stores only the HMAC, never the plain SHA-256, on withdrawal', async () => {
    const email = `e2e-hmac-${suffix}@example.com`;
    const { accessToken } = await signupVerifyAndLogin(email, `wh${suffix}`);
    await withdraw(accessToken).expect(204);

    expect(
      await prisma.withdrawnEmail.count({
        where: { emailHash: hashEmail(email) },
      }),
    ).toBe(1);
    expect(hashEmail(email)).not.toBe(legacySha256Email(email));
    expect(
      await prisma.withdrawnEmail.count({
        where: { emailHash: legacySha256Email(email) },
      }),
    ).toBe(0);
  });
});
