import { BadRequestException, ConflictException } from '@nestjs/common';
import { NotificationType, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { getKstWeekStart } from '../common/utils/kst-date.util';
import { AdminAuditService } from './admin-audit.service';
import { AdminRewardsService } from './admin-rewards.service';
import { ADMIN_ACTIONS } from './admin.constants';
import { toWeekKey } from './admin-ranking.util';

const WEEK = '2026-09-14';

interface MockUser {
  id: string;
  nickname: string;
  email: string;
  status: UserStatus;
  isAdmin: boolean;
  isStaff: boolean;
  points: number;
  minute: number;
}

const user = (
  id: string,
  points: number,
  minute: number,
  extra: Partial<MockUser> = {},
): MockUser => ({
  id,
  nickname: id,
  email: `${id}@test.com`,
  status: UserStatus.ACTIVE,
  isAdmin: false,
  isStaff: false,
  points,
  minute,
  ...extra,
});

// A 1위, B·C·D 2위 동점(남은 자리 2개 → 추첨), 운영팀 S·제한 회원 R은 보상 대상에서 빠진다.
const USERS = [
  user('A', 5, 1),
  user('B', 3, 2),
  user('C', 3, 3),
  user('D', 3, 4),
  user('S', 9, 0, { isStaff: true }),
  user('R', 7, 0, { status: UserStatus.RESTRICTED }),
];

function createPrismaMock() {
  const prisma = {
    leaderboardScore: {
      groupBy: jest.fn().mockResolvedValue(
        USERS.map((u) => ({
          userId: u.id,
          _sum: { points: u.points },
          _max: { awardedAt: new Date(Date.UTC(2026, 8, 15, 0, u.minute)) },
        })),
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { findMany: jest.fn().mockResolvedValue(USERS) },
    responseSession: { groupBy: jest.fn().mockResolvedValue([]) },
    leaderboardRewardWeek: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    leaderboardLottery: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    leaderboardReward: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 3 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notification: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({}),
    },
    adminActionLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );
  return prisma;
}

describe('AdminRewardsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: AdminRewardsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    const asPrisma = prisma as unknown as PrismaService;
    const mail = {
      sendNotice: jest.fn().mockResolvedValue(undefined),
    } as unknown as MailService;
    service = new AdminRewardsService(
      asPrisma,
      new AdminAuditService(asPrisma),
      mail,
    );
  });

  const loggedActions = () =>
    prisma.adminActionLog.create.mock.calls.map(
      ([args]: [{ data: { action: string } }]) => args.data.action,
    );

  it('excludes staff and restricted members from reward candidates and finds the tie', async () => {
    const detail = await service.getRewardWeek(WEEK);

    expect(detail.candidates.map((c) => c.userId)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
    expect(detail.candidates.map((c) => c.rank)).toEqual([1, 2, 2, 2]);
    expect(detail.participantCount).toBe(4);
    expect(detail.tieCount).toBe(3);
    expect(detail.step).toBe(1);
    // 추첨 전 예상 대상은 확정 당첨자(A)뿐.
    expect(detail.winners.map((w) => [w.userId, w.rank])).toEqual([['A', 1]]);
  });

  it('shows staff and restricted members in the admin weekly leaderboard with their role', async () => {
    const board = await service.getWeeklyLeaderboard('2026-09-17');

    expect(board.week).toBe(WEEK);
    expect(board.ranks[0]).toMatchObject({
      userId: 'S',
      rank: 1,
      role: 'STAFF',
    });
    expect(board.ranks.find((r) => r.userId === 'R')?.status).toBe(
      UserStatus.RESTRICTED,
    );
  });

  it('draws the lottery exactly once when leaving the tie step', async () => {
    prisma.leaderboardRewardWeek.findUnique.mockResolvedValue({ step: 3 });

    await service.advance('admin', WEEK, {});

    const [[stepArgs]] = prisma.leaderboardRewardWeek.updateMany.mock.calls as [
      [{ where: { step: number }; data: { step: number } }],
    ];
    expect(stepArgs.where.step).toBe(3);
    expect(stepArgs.data.step).toBe(4);
    expect(prisma.leaderboardLottery.create).toHaveBeenCalledTimes(1);
    const [[lotteryArgs]] = prisma.leaderboardLottery.create.mock.calls as [
      [
        {
          data: {
            result: { contestedUserIds: string[]; winnerUserIds: string[] };
          };
        },
      ],
    ];
    expect(lotteryArgs.data.result.contestedUserIds).toEqual(['B', 'C', 'D']);
    expect(lotteryArgs.data.result.winnerUserIds).toHaveLength(2);
    lotteryArgs.data.result.winnerUserIds.forEach((id) =>
      expect(['B', 'C', 'D']).toContain(id),
    );
    expect(loggedActions()).toEqual([
      ADMIN_ACTIONS.REWARD_LOTTERY,
      ADMIN_ACTIONS.REWARD_ADVANCE,
    ]);
  });

  it('does not draw again when a lottery already exists', async () => {
    prisma.leaderboardRewardWeek.findUnique.mockResolvedValue({ step: 3 });
    prisma.leaderboardLottery.findUnique.mockResolvedValue({
      executedAt: new Date(),
      result: { contestedUserIds: ['B', 'C', 'D'], winnerUserIds: ['C', 'D'] },
    });

    await service.advance('admin', WEEK, {});

    expect(prisma.leaderboardLottery.create).not.toHaveBeenCalled();
  });

  it('creates slot-numbered reward rows and notifies winners when confirming targets', async () => {
    prisma.leaderboardRewardWeek.findUnique.mockResolvedValue({ step: 4 });
    prisma.leaderboardLottery.findUnique.mockResolvedValue({
      executedAt: new Date(),
      result: { contestedUserIds: ['B', 'C', 'D'], winnerUserIds: ['D', 'B'] },
    });

    await service.advance('admin', WEEK, { reason: '주차 정산 진행' });

    const [[createArgs]] = prisma.leaderboardReward.createMany.mock.calls as [
      [{ data: { userId: string; rank: number }[] }],
    ];
    // 추첨 당첨자는 리더보드 정렬 순(B가 D보다 먼저 도달)으로 자리를 받는다.
    expect(createArgs.data.map((r) => [r.userId, r.rank])).toEqual([
      ['A', 1],
      ['B', 2],
      ['D', 3],
    ]);
    const [[notifyArgs]] = prisma.notification.createMany.mock.calls as [
      [{ data: { type: NotificationType }[] }],
    ];
    expect(notifyArgs.data).toHaveLength(3);
    expect(notifyArgs.data[0].type).toBe(NotificationType.REWARD_SELECTED);
  });

  it('rejects a second admin advancing the same step at the same time', async () => {
    prisma.leaderboardRewardWeek.findUnique.mockResolvedValue({ step: 2 });
    prisma.leaderboardRewardWeek.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.advance('admin', WEEK, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses to settle a week that has not ended yet', async () => {
    const thisWeek = toWeekKey(getKstWeekStart(new Date()));

    await expect(service.advance('admin', thisWeek, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses to advance past the final step', async () => {
    prisma.leaderboardRewardWeek.findUnique.mockResolvedValue({ step: 5 });

    await expect(service.advance('admin', WEEK, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('only records a send after targets are confirmed', async () => {
    prisma.leaderboardRewardWeek.findUnique.mockResolvedValue({ step: 4 });

    await expect(
      service.markSent('admin', WEEK, 1, {
        reward: '상품권',
        sentAt: '2026-09-22T10:00:00Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records a per-rank send once and rejects a duplicate', async () => {
    prisma.leaderboardRewardWeek.findUnique.mockResolvedValue({ step: 5 });
    prisma.leaderboardReward.findUnique.mockResolvedValue({
      id: 'reward-1',
      userId: 'A',
      rank: 1,
      user: { nickname: 'A', email: 'A@test.com' },
    });

    await service.markSent('admin', WEEK, 1, {
      reward: ' 모바일 상품권 ',
      sentAt: '2026-09-22T10:00:00Z',
    });
    const [[sentArgs]] = prisma.leaderboardReward.updateMany.mock.calls as [
      [{ where: { id: string; sentAt: null }; data: { rewardText: string } }],
    ];
    expect(sentArgs.where).toEqual({ id: 'reward-1', sentAt: null });
    expect(sentArgs.data.rewardText).toBe('모바일 상품권');
    expect(loggedActions()).toContain(ADMIN_ACTIONS.REWARD_SENT);

    prisma.leaderboardReward.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.markSent('admin', WEEK, 1, {
        reward: '모바일 상품권',
        sentAt: '2026-09-22T10:00:00Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('locks score adjustments once the ranking is confirmed', async () => {
    prisma.leaderboardRewardWeek.findUnique.mockResolvedValue({ step: 2 });
    await expect(
      service.assertWeekAdjustable(new Date()),
    ).resolves.toBeUndefined();

    prisma.leaderboardRewardWeek.findUnique.mockResolvedValue({ step: 3 });
    await expect(
      service.assertWeekAdjustable(new Date()),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
