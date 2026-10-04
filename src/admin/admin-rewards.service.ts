import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  ResponseSessionStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  formatKstDateTime,
  getKstWeekRange,
  getKstWeekStart,
} from '../common/utils/kst-date.util';
import { DEFAULT_LEADERBOARD_CONFIG_ID } from '../leaderboard/leaderboard.constants';
import { LeaderboardRewardsConfigDto } from '../leaderboard/dto/leaderboard-response.dto';
import { AdminAuditService } from './admin-audit.service';
import {
  ADMIN_ACTIONS,
  ADMIN_TARGET_TYPES,
  REWARD_CANDIDATE_COUNT,
  REWARD_RANK_LIMIT,
  REWARD_STEP_FINAL,
  REWARD_STEP_LABELS,
  REWARD_STEP_RANK_CONFIRMED,
} from './admin.constants';
import {
  RankedRow,
  assignRewardSlots,
  parseWeekKey,
  pickLotteryWinners,
  rankRows,
  resolveRewardWinners,
  toWeekKey,
  weekRangeLabel,
} from './admin-ranking.util';
import type { AdminMemberRole } from './dto/admin-member.dto';
import { AdminActionNoteDto } from './dto/admin-action-note.dto';
import { MarkRewardSentDto } from './dto/mark-reward-sent.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import {
  AdminRewardWeekDetailDto,
  AdminRewardWeekDto,
  AdminRewardWinnerDto,
  AdminWeeklyLeaderboardDto,
  AdminWeeklyRankDto,
} from './dto/admin-reward.dto';

export interface AdminWeeklyRow {
  userId: string;
  nickname: string;
  email: string | null;
  points: number;
  lastActiveAt: Date;
  status: UserStatus;
  role: AdminMemberRole;
  warningWeek: number;
}

interface LotteryResult {
  contestedUserIds: string[];
  winnerUserIds: string[];
}

export function memberRole(user: {
  isAdmin: boolean;
  isStaff: boolean;
}): AdminMemberRole {
  if (user.isAdmin) return 'ADMIN';
  if (user.isStaff) return 'STAFF';
  return 'USER';
}

@Injectable()
export class AdminRewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly mail: MailService,
  ) {}

  parseWeekOrThrow(weekKey: string): Date {
    const weekStart = parseWeekKey(weekKey);
    if (!weekStart) {
      throw new BadRequestException('주차는 YYYY-MM-DD 형식이어야 합니다.');
    }
    return weekStart;
  }

  // 그 주 점수가 있는 모든 회원(이용 제한·운영팀 포함)의 순위. 차감된 점수는 뺀다.
  async getWeeklyRanking(
    weekStart: Date,
  ): Promise<RankedRow<AdminWeeklyRow>[]> {
    const grouped = await this.prisma.leaderboardScore.groupBy({
      by: ['userId'],
      where: { weekStart, revokedAt: null },
      _sum: { points: true },
      _max: { awardedAt: true },
    });
    if (grouped.length === 0) return [];

    const userIds = grouped.map((g) => g.userId);
    const [users, warnings] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          nickname: true,
          email: true,
          status: true,
          isAdmin: true,
          isStaff: true,
        },
      }),
      this.prisma.responseSession.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          status: ResponseSessionStatus.SUBMITTED,
          sameScaleWarningAcknowledged: true,
          submittedAt: {
            gte: getKstWeekRange(weekStart).start,
            lt: getKstWeekRange(weekStart).end,
          },
        },
        _count: { _all: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const warningsById = new Map(
      warnings.map((w) => [w.userId, w._count._all]),
    );

    const rows: AdminWeeklyRow[] = [];
    for (const g of grouped) {
      const user = userById.get(g.userId);
      const points = g._sum.points ?? 0;
      if (!user || points <= 0) continue;
      rows.push({
        userId: user.id,
        nickname: user.nickname ?? '',
        email: user.email,
        points,
        lastActiveAt: g._max.awardedAt!,
        status: user.status,
        role: memberRole(user),
        warningWeek: warningsById.get(user.id) ?? 0,
      });
    }
    return rankRows(rows);
  }

  // Spec 6.3: 보상 대상은 이용 제한·탈퇴 회원과 운영팀 계정을 뺀 순위에서 정한다.
  private eligibleRanking(
    ranking: RankedRow<AdminWeeklyRow>[],
  ): RankedRow<AdminWeeklyRow>[] {
    return rankRows(
      ranking.filter(
        (r) => r.status === UserStatus.ACTIVE && r.role !== 'STAFF',
      ),
    );
  }

  async getWeeklyLeaderboard(
    weekKey: string,
  ): Promise<AdminWeeklyLeaderboardDto> {
    const weekStart = this.parseWeekOrThrow(weekKey);
    const ranking = await this.getWeeklyRanking(weekStart);
    return {
      week: toWeekKey(weekStart),
      range: weekRangeLabel(weekStart),
      ranks: ranking.map(
        (r) =>
          new AdminWeeklyRankDto({
            rank: r.rank,
            userId: r.userId,
            nickname: r.nickname,
            points: r.points,
            status: r.status,
            role: r.role,
            warningWeek: r.warningWeek,
            lastActiveAt: r.lastActiveAt.toISOString(),
          }),
      ),
    };
  }

  // 순위를 확정한(3단계 이상) 주차의 점수는 더 이상 바꿀 수 없다.
  async assertWeekAdjustable(weekStart: Date): Promise<void> {
    const state = await this.prisma.leaderboardRewardWeek.findUnique({
      where: { weekStart },
    });
    if (state && state.step >= REWARD_STEP_RANK_CONFIRMED) {
      throw new ConflictException(
        '순위를 확정한 주차의 응답은 제외하거나 점수를 조정할 수 없습니다.',
      );
    }
  }

  private async loadRewardWeek(weekStart: Date) {
    const [state, lottery, rows, ranking] = await Promise.all([
      this.prisma.leaderboardRewardWeek.findUnique({ where: { weekStart } }),
      this.prisma.leaderboardLottery.findUnique({ where: { weekStart } }),
      this.prisma.leaderboardReward.findMany({
        where: { weekStart },
        orderBy: { rank: 'asc' },
        include: { user: { select: { nickname: true, email: true } } },
      }),
      this.getWeeklyRanking(weekStart),
    ]);
    const eligible = this.eligibleRanking(ranking);
    const { clearWinners, contestedGroup, remainingSlots } =
      resolveRewardWinners(eligible, REWARD_RANK_LIMIT);
    const lotteryResult = lottery?.result as LotteryResult | undefined;

    const winners: AdminRewardWinnerDto[] = rows.length
      ? rows.map((row) => ({
          rank: row.rank,
          userId: row.userId,
          nickname: row.user.nickname ?? '',
          email: row.user.email,
          reward: row.rewardText,
          sentAt: row.sentAt?.toISOString() ?? null,
        }))
      : assignRewardSlots(
          clearWinners,
          contestedGroup,
          lotteryResult?.winnerUserIds ?? [],
        ).map((row) => ({
          rank: row.slot,
          userId: row.userId,
          nickname: row.nickname,
          email: row.email,
          reward: null,
          sentAt: null,
        }));

    return {
      weekStart,
      step: state?.step ?? 1,
      lottery,
      lotteryResult,
      eligible,
      clearWinners,
      contestedGroup,
      remainingSlots,
      winners,
      sentCount: rows.filter((row) => row.sentAt).length,
    };
  }

  private toWeekDto(
    info: Awaited<ReturnType<AdminRewardsService['loadRewardWeek']>>,
  ): AdminRewardWeekDto {
    return new AdminRewardWeekDto({
      week: toWeekKey(info.weekStart),
      range: weekRangeLabel(info.weekStart),
      step: info.step,
      stepLabel: REWARD_STEP_LABELS[info.step - 1],
      participantCount: info.eligible.length,
      tieCount: info.contestedGroup.length,
      winners: info.winners,
      sentCount: info.sentCount,
    });
  }

  // 끝난 주차 중 점수 기록이 있는 주차, 최신순.
  async listRewardWeeks(): Promise<AdminRewardWeekDto[]> {
    const currentWeekStart = getKstWeekStart(new Date());
    const weeks = await this.prisma.leaderboardScore.findMany({
      where: { weekStart: { lt: currentWeekStart }, revokedAt: null },
      distinct: ['weekStart'],
      select: { weekStart: true },
      orderBy: { weekStart: 'desc' },
    });
    const infos = await Promise.all(
      weeks.map((w) => this.loadRewardWeek(w.weekStart)),
    );
    return infos
      .filter((info) => info.eligible.length > 0)
      .map((info) => this.toWeekDto(info));
  }

  async getRewardWeek(weekKey: string): Promise<AdminRewardWeekDetailDto> {
    const weekStart = this.parseWeekOrThrow(weekKey);
    return this.buildDetail(await this.loadRewardWeek(weekStart));
  }

  private buildDetail(
    info: Awaited<ReturnType<AdminRewardsService['loadRewardWeek']>>,
  ): AdminRewardWeekDetailDto {
    return new AdminRewardWeekDetailDto({
      ...this.toWeekDto(info),
      candidates: info.eligible.slice(0, REWARD_CANDIDATE_COUNT).map((r) => ({
        userId: r.userId,
        nickname: r.nickname,
        rank: r.rank,
        points: r.points,
        warningWeek: r.warningWeek,
      })),
      lottery:
        info.lottery && info.lotteryResult
          ? {
              executedAt: info.lottery.executedAt.toISOString(),
              contestedUserIds: info.lotteryResult.contestedUserIds,
              winnerUserIds: info.lotteryResult.winnerUserIds,
            }
          : null,
    });
  }

  // 정산을 한 단계 진행한다. 3→4에서 동점이면 한 번만 추첨하고, 4→5에서
  // 보상 대상 행을 만들어 대상자에게 알린다. 완료한 단계는 되돌릴 수 없다.
  async advance(
    adminId: string,
    weekKey: string,
    note: AdminActionNoteDto,
  ): Promise<AdminRewardWeekDetailDto> {
    const weekStart = this.parseWeekOrThrow(weekKey);
    if (getKstWeekRange(weekStart).end.getTime() > Date.now()) {
      throw new BadRequestException(
        '아직 끝나지 않은 주차는 정산할 수 없습니다.',
      );
    }
    const info = await this.loadRewardWeek(weekStart);
    if (info.eligible.length === 0) {
      throw new BadRequestException('정산할 참여자가 없는 주차입니다.');
    }
    const current = info.step;
    if (current >= REWARD_STEP_FINAL) {
      throw new ConflictException('이미 발송 기록 단계인 주차입니다.');
    }
    const week = toWeekKey(weekStart);
    let selectedWinners: { userId: string; slot: number }[] = [];

    await this.prisma.$transaction(async (tx) => {
      await tx.leaderboardRewardWeek.upsert({
        where: { weekStart },
        create: { weekStart },
        update: {},
      });
      const { count } = await tx.leaderboardRewardWeek.updateMany({
        where: { weekStart, step: current },
        data: { step: current + 1 },
      });
      if (count === 0) {
        throw new ConflictException(
          '다른 관리자가 먼저 이 주차를 진행했습니다. 새로고침 후 다시 확인해주세요.',
        );
      }

      let lotteryWinnerIds = info.lotteryResult?.winnerUserIds ?? [];
      if (
        current === REWARD_STEP_RANK_CONFIRMED &&
        info.contestedGroup.length > 0 &&
        !info.lottery
      ) {
        const picked = pickLotteryWinners(
          info.contestedGroup,
          info.remainingSlots,
        );
        lotteryWinnerIds = picked.map((r) => r.userId);
        await tx.leaderboardLottery.create({
          data: {
            weekStart,
            executedByAdminId: adminId,
            result: {
              contestedUserIds: info.contestedGroup.map((r) => r.userId),
              winnerUserIds: lotteryWinnerIds,
            },
          },
        });
        await this.audit.record(
          {
            adminId,
            action: ADMIN_ACTIONS.REWARD_LOTTERY,
            targetType: ADMIN_TARGET_TYPES.REWARD_WEEK,
            targetId: week,
            targetName: `${week} 주차 동점 추첨`,
            beforeValue: info.contestedGroup.map((r) => r.nickname).join(', '),
            afterValue: picked.map((r) => r.nickname).join(', '),
          },
          tx,
        );
      }

      if (current === REWARD_STEP_FINAL - 1) {
        if (info.contestedGroup.length > 0 && !info.lottery) {
          throw new ConflictException(
            '동점 추첨 결과가 없어 대상을 확정할 수 없습니다.',
          );
        }
        const slots = assignRewardSlots(
          info.clearWinners,
          info.contestedGroup,
          lotteryWinnerIds,
        );
        selectedWinners = slots;
        await tx.leaderboardReward.createMany({
          data: slots.map((row) => ({
            userId: row.userId,
            weekStart,
            rank: row.slot,
          })),
          skipDuplicates: true,
        });
        await tx.notification.createMany({
          data: slots.map((row) => ({
            userId: row.userId,
            type: NotificationType.REWARD_SELECTED,
            message: `${weekRangeLabel(weekStart)} 주간 리더보드 ${row.slot}위 보상 대상으로 선정되었습니다.`,
            targetUrl: '/mypage',
          })),
        });
      }

      await this.audit.record(
        {
          adminId,
          action: ADMIN_ACTIONS.REWARD_ADVANCE,
          targetType: ADMIN_TARGET_TYPES.REWARD_WEEK,
          targetId: week,
          targetName: `${week} 주차 정산`,
          reason: note.reason,
          memo: note.memo,
          beforeValue: REWARD_STEP_LABELS[current - 1],
          afterValue: REWARD_STEP_LABELS[current],
        },
        tx,
      );
    });

    const emailById = new Map(info.eligible.map((r) => [r.userId, r.email]));
    void Promise.all(
      selectedWinners
        .filter((row) => emailById.get(row.userId))
        .map((row) =>
          this.mail.sendNotice(
            emailById.get(row.userId)!,
            '리더보드 보상 대상 안내',
            `${weekRangeLabel(weekStart)} 주간 리더보드 ${row.slot}위 보상 대상으로 선정되었습니다. 보상은 가입하신 이메일로 발송됩니다.`,
          ),
        ),
    );

    return this.getRewardWeek(week);
  }

  // Spec 6.3/10.4: 순위별로 보상 내용·발송 시각을 기록하고 대상자에게 알린다.
  async markSent(
    adminId: string,
    weekKey: string,
    rank: number,
    dto: MarkRewardSentDto,
  ): Promise<AdminRewardWeekDetailDto> {
    const weekStart = this.parseWeekOrThrow(weekKey);
    const state = await this.prisma.leaderboardRewardWeek.findUnique({
      where: { weekStart },
    });
    if (!state || state.step < REWARD_STEP_FINAL) {
      throw new ConflictException(
        '대상을 확정한 뒤에 발송을 기록할 수 있습니다.',
      );
    }
    const row = await this.prisma.leaderboardReward.findUnique({
      where: { weekStart_rank: { weekStart, rank } },
      include: { user: { select: { nickname: true, email: true } } },
    });
    if (!row) {
      throw new NotFoundException('해당 순위의 보상 대상이 없습니다.');
    }
    const sentAt = new Date(dto.sentAt);
    const week = toWeekKey(weekStart);
    const reward = dto.reward.trim();

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.leaderboardReward.updateMany({
        where: { id: row.id, sentAt: null },
        data: { rewardText: reward, sentAt, sentByAdminId: adminId },
      });
      if (count === 0) {
        throw new ConflictException('이미 발송을 기록한 순위입니다.');
      }
      await tx.notification.create({
        data: {
          userId: row.userId,
          type: NotificationType.REWARD_SENT,
          message: `${weekRangeLabel(weekStart)} 주간 리더보드 ${rank}위 보상(${reward})이 발송되었습니다.`,
          targetUrl: '/mypage',
        },
      });
      await this.audit.record(
        {
          adminId,
          action: ADMIN_ACTIONS.REWARD_SENT,
          targetType: ADMIN_TARGET_TYPES.REWARD_WEEK,
          targetId: week,
          targetName: `${week} ${rank}위 · ${row.user.nickname ?? ''}`,
          reason: '보상 발송 완료',
          memo: reward,
          beforeValue: '미발송',
          afterValue: formatKstDateTime(sentAt),
        },
        tx,
      );
    });

    if (row.user.email) {
      void this.mail.sendNotice(
        row.user.email,
        '리더보드 보상 발송 안내',
        `${weekRangeLabel(weekStart)} 주간 리더보드 ${rank}위 보상(${reward})이 발송되었습니다.`,
      );
    }
    return this.getRewardWeek(week);
  }

  async updateNotice(
    adminId: string,
    dto: UpdateAnnouncementDto,
  ): Promise<LeaderboardRewardsConfigDto> {
    const data = {
      title: dto.title.trim(),
      body: dto.body.trim(),
      tiers: dto.tiers.map((tier) => tier.trim()),
      tieRuleText: dto.tieRule.trim(),
      updatedByAdminId: adminId,
    };
    const config = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.leaderboardConfig.upsert({
        where: { id: DEFAULT_LEADERBOARD_CONFIG_ID },
        create: { id: DEFAULT_LEADERBOARD_CONFIG_ID, ...data },
        update: data,
      });
      await this.audit.record(
        {
          adminId,
          action: ADMIN_ACTIONS.REWARD_NOTICE_UPDATE,
          targetType: ADMIN_TARGET_TYPES.NOTICE,
          targetId: DEFAULT_LEADERBOARD_CONFIG_ID,
          targetName: '리더보드 보상 안내',
          reason: dto.reason,
          memo: dto.memo,
          afterValue: data.title,
        },
        tx,
      );
      return saved;
    });
    return new LeaderboardRewardsConfigDto({
      title: config.title,
      body: config.body,
      tiers: [0, 1, 2].map((i) => config.tiers[i] ?? ''),
      tieRuleText: config.tieRuleText,
    });
  }
}
