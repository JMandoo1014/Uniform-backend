import { Injectable } from '@nestjs/common';
import { ResponseSessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  getKstTodayDateString,
  getKstWeekStart,
  kstDateStringToUtcStartOfDay,
} from '../common/utils/kst-date.util';
import { AdminRewardsService } from './admin-rewards.service';
import { REWARD_STEP_FINAL } from './admin.constants';
import { AdminMetricDto, AdminSummaryDto } from './dto/admin-summary.dto';

// Spec 10.1: 관리자 첫 화면 — 오늘·이번 주 가입자 수, 게시 설문 수, 응답 수.
@Injectable()
export class AdminSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rewards: AdminRewardsService,
  ) {}

  async getSummary(): Promise<AdminSummaryDto> {
    const today = kstDateStringToUtcStartOfDay(getKstTodayDateString());
    const week = getKstWeekStart(new Date());

    const metric = async (
      countSince: (since?: Date) => Promise<number>,
    ): Promise<AdminMetricDto> => {
      const [total, todayCount, weekCount] = await Promise.all([
        countSince(),
        countSince(today),
        countSince(week),
      ]);
      return { total, today: todayCount, week: weekCount };
    };

    const [members, surveys, responses, rewardWeeks] = await Promise.all([
      metric((since) =>
        this.prisma.user.count({
          where: since ? { createdAt: { gte: since } } : {},
        }),
      ),
      metric((since) =>
        this.prisma.survey.count({
          where: { publishedAt: since ? { gte: since } : { not: null } },
        }),
      ),
      metric((since) =>
        this.prisma.responseSession.count({
          where: {
            status: ResponseSessionStatus.SUBMITTED,
            ...(since ? { submittedAt: { gte: since } } : {}),
          },
        }),
      ),
      this.rewards.listRewardWeeks(),
    ]);

    const todos = rewardWeeks
      .filter(
        (w) => w.step < REWARD_STEP_FINAL || w.sentCount < w.winners.length,
      )
      .map((w) => ({
        type: 'reward',
        label:
          w.step < REWARD_STEP_FINAL
            ? `${w.range} 주차 보상 정산이 남았어요 (${w.stepLabel} 단계)`
            : `${w.range} 주차 보상 발송 기록이 남았어요`,
        to: `/admin/rewards/${w.week}`,
      }));

    return { members, surveys, responses, todos };
  }
}
