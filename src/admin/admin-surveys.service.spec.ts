import { NotificationType, ResponseSessionStatus } from '@prisma/client';
import { AdminAuditService } from './admin-audit.service';
import { AdminSurveysService } from './admin-surveys.service';

// 2026-09-28 추가: 응답 제외 시 응답자 본인에게 앱 알림 + 이메일을 보내는지만
// 좁게 검증한다(이 전까지는 excludeSubmission에 이 알림이 전혀 없었다).
describe('AdminSurveysService.excludeSubmission notification', () => {
  const SESSION = {
    id: 'session-1',
    surveyId: 'survey-1',
    userId: 'user-1',
    status: ResponseSessionStatus.SUBMITTED,
    excludedAt: null as Date | null,
    survey: { title: '테스트 설문' },
    user: { nickname: '응답자', email: 'respondent@example.com' },
  };

  let prisma: {
    responseSession: { findUnique: jest.Mock; updateMany: jest.Mock };
    leaderboardScore: { findUnique: jest.Mock; updateMany: jest.Mock };
    survey: { update: jest.Mock };
    notification: { create: jest.Mock };
    adminActionLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let rewards: { assertWeekAdjustable: jest.Mock };
  let mail: { sendNotice: jest.Mock };
  let service: AdminSurveysService;

  beforeEach(() => {
    prisma = {
      responseSession: {
        findUnique: jest.fn().mockResolvedValue(SESSION),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      leaderboardScore: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      survey: { update: jest.fn() },
      notification: { create: jest.fn() },
      adminActionLog: { create: jest.fn() },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({
          responseSession: prisma.responseSession,
          leaderboardScore: prisma.leaderboardScore,
          survey: prisma.survey,
          notification: prisma.notification,
          adminActionLog: prisma.adminActionLog,
        }),
      ),
    };
    rewards = { assertWeekAdjustable: jest.fn() };
    mail = { sendNotice: jest.fn().mockResolvedValue(undefined) };

    service = new AdminSurveysService(
      prisma as never,
      new AdminAuditService(prisma as never),
      rewards as never,
      mail as never,
    );
  });

  it('creates a RESPONSE_EXCLUDED notification for the respondent', async () => {
    await service.excludeSubmission('admin-1', 'session-1', {
      reason: '중복 응답',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        type: NotificationType.RESPONSE_EXCLUDED,
        targetUrl: '/mypage/responses',
      }) as unknown,
    });
  });

  it('emails the respondent with the exclusion reason', async () => {
    await service.excludeSubmission('admin-1', 'session-1', {
      reason: '중복 응답',
    });

    expect(mail.sendNotice).toHaveBeenCalledWith(
      'respondent@example.com',
      '응답 제외 안내',
      expect.stringContaining('중복 응답'),
    );
  });
});
