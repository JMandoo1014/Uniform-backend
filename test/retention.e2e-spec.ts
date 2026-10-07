import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  RETENTION_JOB_NAME,
  RetentionService,
} from '../src/retention/retention.service';
import { toKstDateString } from '../src/common/utils/kst-date.util';

const DAY_MS = 24 * 60 * 60 * 1000;

// 정리 배치는 테이블 전체를 기준 시각으로 지우므로 개발 DB에서 돌리면 그
// DB의 실제 데이터도 지워진다. 전용 DB(이름이 _e2e/_test로 끝나는)에서만 돈다:
//   DATABASE_URL=postgresql://.../uniform_e2e npx jest --config test/jest-e2e.json retention
const dbName = new URL(
  process.env.DATABASE_URL ?? 'postgresql://x/none',
).pathname.slice(1);
const describeIfIsolatedDb = /_(e2e|test)$/.test(dbName)
  ? describe
  : describe.skip;

describeIfIsolatedDb('RetentionService (e2e, isolated DB)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let retention: RetentionService;

  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const s = Date.now().toString(36);
  const ids = {} as Record<string, string>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    retention = app.get(RetentionService);

    await prisma.scheduledJobRun.deleteMany({
      where: { jobName: RETENTION_JOB_NAME, runDate: toKstDateString(now) },
    });

    const user = (tag: string, data: Record<string, unknown>) =>
      prisma.user.create({
        data: {
          email: `ret-${tag}-${s}@example.com`,
          nickname: `r${tag}${s}`.slice(0, 12),
          passwordHash: 'x',
          agreedTermsVersion: 'v1',
          ...data,
        },
      });
    ids.admin = (await user('ad', { status: 'ACTIVE', isAdmin: true })).id;
    ids.respondent = (await user('rs', { status: 'ACTIVE' })).id;
    ids.pendingOld = (
      await user('po', { status: 'PENDING_VERIFICATION', createdAt: ago(8) })
    ).id;
    ids.pendingNew = (
      await user('pn', { status: 'PENDING_VERIFICATION', createdAt: ago(6) })
    ).id;

    const surveyWithResponse = async (tag: string, purgeAt: Date) => {
      const survey = await prisma.survey.create({
        data: {
          ownerType: 'USER',
          ownerId: ids.admin,
          creatorId: ids.admin,
          title: `ret-${tag}`,
          status: 'CLOSED',
          purgeAt,
          questions: {
            create: {
              orderNo: 1,
              stableKey: 'q1',
              type: 'SHORT_ANSWER',
              questionText: '문항입니다',
            },
          },
        },
      });
      const session = await prisma.responseSession.create({
        data: {
          surveyId: survey.id,
          userId: ids.respondent,
          status: 'SUBMITTED',
          submittedAt: ago(40),
          answers: { create: { questionId: 'q1', value: `${tag} 원문` } },
          score: {
            create: { userId: ids.respondent, weekStart: ago(40), points: 1 },
          },
        },
      });
      const message = await prisma.formMateMessage.create({
        data: {
          surveyId: survey.id,
          userId: ids.admin,
          role: 'USER',
          content: '문항 만들어줘',
          changes: {
            create: { surveyId: survey.id, type: 'ADD_QUESTION', summary: 's' },
          },
        },
      });
      return {
        surveyId: survey.id,
        sessionId: session.id,
        messageId: message.id,
      };
    };
    const purged = await surveyWithResponse('past', ago(1));
    const notYet = await surveyWithResponse('future', ago(-1));
    Object.assign(ids, {
      purgedSurvey: purged.surveyId,
      purgedSession: purged.sessionId,
      futureSurvey: notYet.surveyId,
      futureSession: notYet.sessionId,
    });

    await prisma.withdrawnEmail.createMany({
      data: [
        { emailHash: `ret-old-${s}`, withdrawnAt: ago(31) },
        { emailHash: `ret-new-${s}`, withdrawnAt: ago(29) },
      ],
    });

    const inquiry = (subject: string, data: Record<string, unknown>) =>
      prisma.inquiry.create({
        data: { email: `q-${s}@example.com`, subject, message: 'm', ...data },
      });
    ids.inqOld = (
      await inquiry('old', { status: 'ANSWERED', answeredAt: ago(366) })
    ).id;
    ids.inqNew = (
      await inquiry('new', { status: 'ANSWERED', answeredAt: ago(364) })
    ).id;
    ids.inqPending = (await inquiry('pending', { createdAt: ago(400) })).id;

    const log = (createdAt: Date) =>
      prisma.adminActionLog.create({
        data: {
          adminId: ids.admin,
          action: 'MEMBER_NICKNAME_FORCE',
          targetType: 'Member',
          targetId: ids.respondent,
          targetName: '옛닉네임',
          reason: '부적절한 닉네임',
          memo: '메모',
          beforeValue: '옛닉네임',
          afterValue: '회원1234',
          createdAt,
        },
      });
    ids.logOld = (await log(ago(366))).id;
    ids.logNew = (await log(ago(364))).id;

    const restriction = (data: Record<string, unknown>) =>
      prisma.userRestriction.create({
        data: {
          userId: ids.respondent,
          createdByAdminId: ids.admin,
          reason: '욕설 신고 누적',
          durationDays: 7,
          startedAt: ago(500),
          ...data,
        },
      });
    ids.restrictLiftedOld = (
      await restriction({ liftedAt: ago(366), liftedReason: '소명 확인' })
    ).id;
    ids.restrictLiftedNew = (
      await restriction({ liftedAt: ago(364), liftedReason: '소명 확인' })
    ).id;
    // 기간은 끝났지만 해제되지 않음(자동 해제가 없어 여전히 제한 중) — 유지
    ids.restrictExpiredNotLifted = (await restriction({ endsAt: ago(400) })).id;
    ids.restrictPermanent = (
      await restriction({ durationDays: null, endsAt: null })
    ).id;
  });

  afterAll(async () => {
    await prisma.userRestriction.deleteMany({
      where: { userId: ids.respondent },
    });
    await prisma.adminActionLog.deleteMany({
      where: { id: { in: [ids.logOld, ids.logNew] } },
    });
    await prisma.inquiry.deleteMany({ where: { email: `q-${s}@example.com` } });
    await prisma.withdrawnEmail.deleteMany({
      where: { emailHash: { startsWith: 'ret-' } },
    });
    await prisma.survey.deleteMany({
      where: { id: { in: [ids.purgedSurvey, ids.futureSurvey] } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `-${s}@example.com` } },
    });
    await app.close();
  });

  async function snapshot() {
    const answers = (sessionId: string) =>
      prisma.sessionAnswer.count({ where: { sessionId } });
    const messages = (surveyId: string) =>
      prisma.formMateMessage.count({ where: { surveyId } });
    const changes = (surveyId: string) =>
      prisma.formMateProposedChange.count({ where: { surveyId } });
    const exists = async (p: Promise<unknown>) => (await p) !== null;
    return {
      purgedAnswers: await answers(ids.purgedSession),
      purgedMessages: await messages(ids.purgedSurvey),
      purgedChanges: await changes(ids.purgedSurvey),
      purgedSessionKept: await exists(
        prisma.responseSession.findUnique({ where: { id: ids.purgedSession } }),
      ),
      purgedScoreKept: await exists(
        prisma.leaderboardScore.findUnique({
          where: { submissionId: ids.purgedSession },
        }),
      ),
      purgedQuestions: await prisma.surveyQuestion.count({
        where: { surveyId: ids.purgedSurvey },
      }),
      futureAnswers: await answers(ids.futureSession),
      futureMessages: await messages(ids.futureSurvey),
      pendingOld: await exists(
        prisma.user.findUnique({ where: { id: ids.pendingOld } }),
      ),
      pendingNew: await exists(
        prisma.user.findUnique({ where: { id: ids.pendingNew } }),
      ),
      withdrawnOld: await prisma.withdrawnEmail.count({
        where: { emailHash: `ret-old-${s}` },
      }),
      withdrawnNew: await prisma.withdrawnEmail.count({
        where: { emailHash: `ret-new-${s}` },
      }),
      inqOld: await exists(
        prisma.inquiry.findUnique({ where: { id: ids.inqOld } }),
      ),
      inqNew: await exists(
        prisma.inquiry.findUnique({ where: { id: ids.inqNew } }),
      ),
      inqPending: await exists(
        prisma.inquiry.findUnique({ where: { id: ids.inqPending } }),
      ),
      logOld: await prisma.adminActionLog.findUniqueOrThrow({
        where: { id: ids.logOld },
      }),
      logNew: await prisma.adminActionLog.findUniqueOrThrow({
        where: { id: ids.logNew },
      }),
      restrictions: await prisma.userRestriction.findMany({
        where: { userId: ids.respondent },
        orderBy: { id: 'asc' },
      }),
    };
  }

  it('dry-run changes nothing', async () => {
    const before = await snapshot();
    process.env.RETENTION_DRY_RUN = 'true';
    try {
      const result = await retention.runOnce(now);
      expect(result).toMatchObject({ status: 'completed', dryRun: true });
    } finally {
      delete process.env.RETENTION_DRY_RUN;
    }
    expect(await snapshot()).toEqual(before);
  });

  it('deletes/scrubs exactly what is past its retention period and keeps the rest', async () => {
    // dry-run이 오늘 실행 기록을 차지했으므로 실제 실행 전에 비운다.
    await prisma.scheduledJobRun.deleteMany({
      where: { jobName: RETENTION_JOB_NAME, runDate: toKstDateString(now) },
    });

    const result = await retention.runOnce(now);
    expect(result).toMatchObject({ status: 'completed', dryRun: false });

    const after = await snapshot();
    expect(after).toMatchObject({
      // a. 응답 원문·대화만 파기, 세션·점수·문항은 유지
      purgedAnswers: 0,
      purgedMessages: 0,
      purgedChanges: 0,
      purgedSessionKept: true,
      purgedScoreKept: true,
      purgedQuestions: 1,
      futureAnswers: 1,
      futureMessages: 1,
      // b. 인증 대기 7일
      pendingOld: false,
      pendingNew: true,
      // c. 탈퇴 이메일 30일
      withdrawnOld: 0,
      withdrawnNew: 1,
      // d. 처리 완료 문의 1년
      inqOld: false,
      inqNew: true,
      inqPending: true,
    });
    expect(after.logOld).toMatchObject({
      targetName: null,
      memo: null,
      beforeValue: null,
      afterValue: null,
      reason: '부적절한 닉네임',
      adminId: ids.admin,
      targetId: ids.respondent,
    });
    expect(after.logNew).toMatchObject({
      targetName: '옛닉네임',
      memo: '메모',
      beforeValue: '옛닉네임',
      afterValue: '회원1234',
    });

    // 이용 제한: 해제 후 1년 지난 기록만 사유 파기, 행·기간·조치자는 유지
    const byId = new Map(after.restrictions.map((r) => [r.id, r]));
    expect(byId.get(ids.restrictLiftedOld)).toMatchObject({
      reason: '(보관 기간이 지나 파기됨)',
      liftedReason: null,
      durationDays: 7,
      userId: ids.respondent,
      createdByAdminId: ids.admin,
    });
    expect(byId.get(ids.restrictLiftedOld)?.liftedAt).not.toBeNull();
    for (const kept of [
      ids.restrictLiftedNew,
      ids.restrictExpiredNotLifted,
      ids.restrictPermanent,
    ]) {
      expect(byId.get(kept)?.reason).toBe('욕설 신고 누적');
    }
    expect(byId.get(ids.restrictLiftedNew)?.liftedReason).toBe('소명 확인');
  });

  it('skips a second run on the same KST day', async () => {
    expect(await retention.runOnce(now)).toEqual({ status: 'skipped' });
  });
});
