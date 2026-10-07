import { Prisma } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { RetentionService } from './retention.service';

function buildPrisma() {
  const model = () => ({
    count: jest.fn().mockResolvedValue(2),
    deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    updateMany: jest.fn().mockResolvedValue({ count: 2 }),
  });
  const prisma = {
    scheduledJobRun: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    survey: model(),
    sessionAnswer: model(),
    formMateMessage: model(),
    formMateProposedChange: model(),
    user: model(),
    withdrawnEmail: model(),
    inquiry: model(),
    adminActionLog: model(),
    userRestriction: model(),
    notification: model(),
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

function buildService(
  prisma: ReturnType<typeof buildPrisma>,
  dryRun = false,
  disabledJobs?: string,
) {
  const env: Record<string, string | undefined> = {
    RETENTION_DRY_RUN: String(dryRun),
    RETENTION_DISABLED_JOBS: disabledJobs,
  };
  const config = { get: jest.fn((key: string) => env[key]) };
  return new RetentionService(prisma as never, config as never);
}

const NOW = new Date('2026-10-06T19:00:00.000Z'); // 2026-10-07 04:00 KST

describe('RetentionService', () => {
  it('claims the KST run date and skips when another instance already ran today', async () => {
    const prisma = buildPrisma();
    prisma.scheduledJobRun.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await buildService(prisma).runOnce(NOW);

    expect(prisma.scheduledJobRun.create).toHaveBeenCalledWith({
      data: {
        jobName: 'privacy-retention',
        runDate: '2026-10-07',
        dryRun: false,
      },
    });
    expect(result).toEqual({ status: 'skipped' });
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('only counts in dry-run mode — nothing is deleted or updated', async () => {
    const prisma = buildPrisma();

    const result = await buildService(prisma, true).runOnce(NOW);

    expect(result.status).toBe('completed');
    for (const name of [
      'sessionAnswer',
      'formMateMessage',
      'formMateProposedChange',
      'user',
      'withdrawnEmail',
      'inquiry',
    ] as const) {
      expect(prisma[name].deleteMany).not.toHaveBeenCalled();
    }
    expect(prisma.adminActionLog.updateMany).not.toHaveBeenCalled();
    expect(prisma.userRestriction.updateMany).not.toHaveBeenCalled();
    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.scheduledJobRun.update).toHaveBeenCalled();
  });

  it('keeps running the remaining jobs when one job fails', async () => {
    const prisma = buildPrisma();
    prisma.user.deleteMany.mockRejectedValueOnce(new Error('boom'));

    const result = await buildService(prisma).runOnce(NOW);

    if (result.status !== 'completed') throw new Error('expected completed');
    expect(result.jobs['unverified-accounts']).toEqual({ error: 'boom' });
    expect(prisma.withdrawnEmail.deleteMany).toHaveBeenCalled();
    expect(prisma.inquiry.deleteMany).toHaveBeenCalled();
    expect(prisma.adminActionLog.updateMany).toHaveBeenCalled();
    expect(prisma.userRestriction.updateMany).toHaveBeenCalled();
    expect(prisma.notification.deleteMany).toHaveBeenCalled();
    expect(prisma.scheduledJobRun.update).toHaveBeenCalledWith({
      where: {
        jobName_runDate: {
          jobName: 'privacy-retention',
          runDate: '2026-10-07',
        },
      },
      data: { finishedAt: expect.any(Date) as Date },
    });
  });

  it('skips jobs listed in RETENTION_DISABLED_JOBS and logs them as disabled', async () => {
    const prisma = buildPrisma();
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    try {
      const result = await buildService(
        prisma,
        false,
        ' survey-purge , admin-log-scrub',
      ).runOnce(NOW);

      if (result.status !== 'completed') throw new Error('expected completed');
      expect(result.jobs['survey-purge']).toEqual({ disabled: true });
      expect(result.jobs['admin-log-scrub']).toEqual({ disabled: true });
      expect(prisma.survey.count).not.toHaveBeenCalled();
      expect(prisma.sessionAnswer.count).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.adminActionLog.count).not.toHaveBeenCalled();
      expect(prisma.adminActionLog.updateMany).not.toHaveBeenCalled();
      // 나머지 작업은 그대로 돈다.
      expect(prisma.user.deleteMany).toHaveBeenCalled();
      expect(prisma.withdrawnEmail.deleteMany).toHaveBeenCalled();
      expect(prisma.inquiry.deleteMany).toHaveBeenCalled();

      const logged = (logSpy.mock.calls as unknown[][]).map((c) =>
        String(c[0]),
      );
      expect(logged).toContain(
        '[survey-purge] disabled (RETENTION_DISABLED_JOBS) — 실행하지 않음',
      );
      expect(logged).toContain(
        '[admin-log-scrub] disabled (RETENTION_DISABLED_JOBS) — 실행하지 않음',
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('warns about unknown job names and still runs every job', async () => {
    const prisma = buildPrisma();
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    try {
      const result = await buildService(prisma, false, 'survey_purge').runOnce(
        NOW,
      );

      if (result.status !== 'completed') throw new Error('expected completed');
      expect(Object.values(result.jobs)).not.toContainEqual({ disabled: true });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(String(warnSpy.mock.calls[0][0])).toContain('survey_purge');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('admin-log-scrub overwrites each personal field separately with the scrub text', async () => {
    const prisma = buildPrisma();

    await buildService(prisma).scrubAdminLogPersonalData(NOW, false);

    const calls = prisma.adminActionLog.updateMany.mock.calls as [
      { where: Record<string, unknown>; data: Record<string, string> },
    ][];
    expect(calls.map(([args]) => Object.keys(args.data)[0]).sort()).toEqual(
      ['afterValue', 'beforeValue', 'memo', 'reason', 'targetName'].sort(),
    );
    for (const [args] of calls) {
      expect(Object.values(args.data)).toEqual(['(보관 기간이 지나 파기됨)']);
    }
  });
});
