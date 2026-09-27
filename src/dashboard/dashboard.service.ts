import { Injectable } from '@nestjs/common';
import {
  NotificationType,
  ResponseSessionStatus,
  SurveyOwnerType,
  SurveyStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDaysToKstDateString,
  getKstTodayDateString,
  getKstWeekStart,
  kstDateStringToUtcStartOfDay,
} from '../common/utils/kst-date.util';
import { DashboardSummaryResponseDto } from './dto/dashboard-summary-response.dto';
import {
  TrendMetric,
  TrendRange,
  WeeklyTrendQueryDto,
} from './dto/weekly-trend-query.dto';
import { TrendBucketDto } from './dto/trend-bucket.dto';
import { RecentActivityItemDto } from './dto/recent-activity-item.dto';

// Spec 8.5 / 12.3⑨: "최근 활동"에 남기는 이벤트는 응답 제출·설문 게시뿐 —
// "결과 확인"은 조회 행위라 별도 기록을 남기지 않기로 확정.
const RECENT_ACTIVITY_TYPES: NotificationType[] = [
  NotificationType.RESPONSE_SUBMITTED,
  NotificationType.SURVEY_PUBLISHED,
];
const RECENT_ACTIVITY_LIMIT = 4;

const RANGE_TOTAL_DAYS: Record<TrendRange, number> = {
  '7d': 7,
  '30d': 30,
  '3m': 90,
};
const TREND_BUCKET_COUNT = 7;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // Spec 8.5: 요약 카드 4개. 모두 본인(+소속 팀) 기준이고, 이번 주 참여
  // 횟수는 기간 선택과 무관하게 항상 이번 주 고정.
  async getSummary(userId: string): Promise<DashboardSummaryResponseDto> {
    const myOwnerIds = await this.resolveMyOwnerIds(userId);
    const mySurveys = await this.prisma.survey.findMany({
      where: { OR: myOwnerIds },
      select: { status: true, responseCount: true },
    });

    const activeSurveyCount = mySurveys.filter(
      (s) => s.status === SurveyStatus.RECRUITING,
    ).length;
    const totalResponses = mySurveys.reduce(
      (sum, s) => sum + s.responseCount,
      0,
    );
    const analyzableSurveyCount = mySurveys.filter(
      (s) => s.responseCount >= 1,
    ).length;

    const thisWeekStart = getKstWeekStart(new Date());
    const lastWeekStart = new Date(
      thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000,
    );
    const [weeklyParticipationCount, lastWeekParticipationCount] =
      await Promise.all([
        this.prisma.responseSession.count({
          where: {
            userId,
            status: ResponseSessionStatus.SUBMITTED,
            submittedAt: { gte: thisWeekStart },
          },
        }),
        this.prisma.responseSession.count({
          where: {
            userId,
            status: ResponseSessionStatus.SUBMITTED,
            submittedAt: { gte: lastWeekStart, lt: thisWeekStart },
          },
        }),
      ]);

    return new DashboardSummaryResponseDto({
      activeSurveyCount,
      totalResponses,
      analyzableSurveyCount,
      weeklyParticipationCount,
      weeklyParticipationDelta:
        weeklyParticipationCount - lastWeekParticipationCount,
    });
  }

  // Spec 8.5 / 12.3⑨: 참여 추이 차트 — 항상 막대 7개. 7일은 하루 단위, 30일·
  // 3개월은 기간을 7구간으로 균등 분할. 집계는 내 활동(응답 제출) 기준으로
  // 확정됐고, 서비스 전체 기준이 아니다.
  async getWeeklyTrend(
    userId: string,
    query: WeeklyTrendQueryDto,
  ): Promise<TrendBucketDto[]> {
    const range: TrendRange = query.range ?? '7d';
    const metric: TrendMetric = query.metric ?? 'response';
    const totalDays = RANGE_TOTAL_DAYS[range];

    const today = getKstTodayDateString();
    const windowStartDate = addDaysToKstDateString(today, -(totalDays - 1));
    const boundaryDates = Array.from(
      { length: TREND_BUCKET_COUNT + 1 },
      (_, i) =>
        addDaysToKstDateString(
          windowStartDate,
          Math.round((i * totalDays) / TREND_BUCKET_COUNT),
        ),
    );
    const boundaryInstants = boundaryDates.map(kstDateStringToUtcStartOfDay);

    const sessions = await this.prisma.responseSession.findMany({
      where: {
        userId,
        status: ResponseSessionStatus.SUBMITTED,
        submittedAt: {
          gte: boundaryInstants[0],
          lt: boundaryInstants[TREND_BUCKET_COUNT],
        },
      },
      select: { surveyId: true, submittedAt: true },
    });

    return Array.from({ length: TREND_BUCKET_COUNT }, (_, i) => {
      const bucketStart = boundaryInstants[i];
      const bucketEnd = boundaryInstants[i + 1];
      const inBucket = sessions.filter(
        (s) => s.submittedAt! >= bucketStart && s.submittedAt! < bucketEnd,
      );
      const value =
        metric === 'survey'
          ? new Set(inBucket.map((s) => s.surveyId)).size
          : inBucket.length;
      return new TrendBucketDto(boundaryDates[i], value);
    });
  }

  // Spec 8.5 / 12.3⑨: 최근 활동 4건 고정(페이징 없음), 새 테이블 없이 알림
  // 데이터를 재사용.
  async getRecentActivity(userId: string): Promise<RecentActivityItemDto[]> {
    const notifications = await this.prisma.notification.findMany({
      where: { userId, type: { in: RECENT_ACTIVITY_TYPES } },
      orderBy: { createdAt: 'desc' },
      take: RECENT_ACTIVITY_LIMIT,
    });

    return notifications.map(
      (n) =>
        new RecentActivityItemDto({
          type: n.type,
          message: n.message,
          createdAt: n.createdAt.toISOString(),
          targetUrl: n.targetUrl,
        }),
    );
  }

  // Spec 8.3/8.5: "내 설문" = 본인 설문 + 소속 팀의 설문. MyPage와 같은 기준.
  private async resolveMyOwnerIds(userId: string) {
    const teamIds = await this.prisma.teamMember
      .findMany({ where: { userId }, select: { teamId: true } })
      .then((rows) => rows.map((r) => r.teamId));

    return [
      { ownerType: SurveyOwnerType.USER, ownerId: userId },
      { ownerType: SurveyOwnerType.TEAM, ownerId: { in: teamIds } },
    ];
  }
}
