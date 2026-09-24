import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getKstWeekStart } from '../common/utils/kst-date.util';
import {
  DEFAULT_LEADERBOARD_CONFIG_ID,
  LEADERBOARD_MAX_ENTRIES,
  LEADERBOARD_MAX_PAGES,
  LEADERBOARD_PAGE_SIZE,
} from './leaderboard.constants';
import {
  LastWeekLeaderboardResponseDto,
  LeaderboardEntryDto,
  LeaderboardRanksDto,
  LeaderboardResponseDto,
  LeaderboardRewardsConfigDto,
  MyRankDto,
} from './dto/leaderboard-response.dto';

interface RankedRow {
  userId: string;
  nickname: string;
  points: number;
  lastActiveAt: Date;
  rank: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentWeek(
    userId: string,
    page: number | undefined,
  ): Promise<LeaderboardResponseDto> {
    const weekStart = getKstWeekStart(new Date());
    const weekEnd = new Date(weekStart.getTime() + WEEK_MS - 1);
    const ranked = await this.getRankedRows(weekStart);

    const currentPage = page ?? 1;
    const totalPages = Math.min(
      LEADERBOARD_MAX_PAGES,
      Math.max(1, Math.ceil(ranked.length / LEADERBOARD_PAGE_SIZE)),
    );
    const pageItems = ranked
      .slice(
        (currentPage - 1) * LEADERBOARD_PAGE_SIZE,
        currentPage * LEADERBOARD_PAGE_SIZE,
      )
      .map(
        (row) =>
          new LeaderboardEntryDto(
            row.rank,
            row.nickname,
            row.points,
            row.lastActiveAt,
          ),
      );

    const top3 = ranked
      .slice(0, 3)
      .map(
        (row) => new LeaderboardEntryDto(row.rank, row.nickname, row.points),
      );

    const mine = ranked.find((row) => row.userId === userId) ?? null;
    const pointsToNext = this.computePointsToNext(ranked, mine);

    const previousWeekRanked = await this.getRankedRows(
      new Date(weekStart.getTime() - WEEK_MS),
    );
    const previousWeekRank =
      previousWeekRanked.find((row) => row.userId === userId)?.rank ?? null;

    const myRank = new MyRankDto(
      mine?.rank ?? null,
      mine?.points ?? 0,
      pointsToNext,
      previousWeekRank,
    );

    return new LeaderboardResponseDto(
      weekStart,
      weekEnd,
      ranked.length,
      top3,
      new LeaderboardRanksDto(currentPage, totalPages, pageItems),
      myRank,
    );
  }

  async getLastWeek(): Promise<LastWeekLeaderboardResponseDto> {
    const currentWeekStart = getKstWeekStart(new Date());
    const weekStart = new Date(currentWeekStart.getTime() - WEEK_MS);
    const weekEnd = new Date(weekStart.getTime() + WEEK_MS - 1);
    const ranked = await this.getRankedRows(weekStart);
    const top3 = ranked
      .slice(0, 3)
      .map(
        (row) => new LeaderboardEntryDto(row.rank, row.nickname, row.points),
      );
    return new LastWeekLeaderboardResponseDto(weekStart, weekEnd, top3);
  }

  async getRewardsConfig(): Promise<LeaderboardRewardsConfigDto> {
    const config = await this.prisma.leaderboardConfig.upsert({
      where: { id: DEFAULT_LEADERBOARD_CONFIG_ID },
      create: { id: DEFAULT_LEADERBOARD_CONFIG_ID },
      update: {},
    });
    return new LeaderboardRewardsConfigDto(
      config.rewardText,
      config.tieRuleText,
    );
  }

  // Spec 6.4/6.5: 나와 같은 순위 번호를 가진 사람이 2명 이상이면(동점 그룹)
  // "공동 순위"(0 반환) — 1위 동점도 포함이라 "전체 1위"보다 우선한다.
  // 동점이 아니고 1위면 전체 1위(null), 그 외엔 바로 위 순위와의 점수 차이.
  private computePointsToNext(
    ranked: RankedRow[],
    mine: RankedRow | null,
  ): number | null {
    if (!mine) return null;

    const isTied = ranked.filter((row) => row.rank === mine.rank).length > 1;
    if (isTied) return 0;
    if (mine.rank === 1) return null;

    const above = ranked.find((row) => row.rank === mine.rank - 1);
    return (above?.points ?? mine.points) - mine.points;
  }

  // Spec 6.5: 응답 횟수 합계 내림차순, 동점이면 같은 순위(1,2,2,4식). 목록
  // 정렬(동순위 내 위아래)은 "그 횟수에 먼저 도달한" 시각(=이번 주 마지막
  // 제출 시각, 점수는 제출마다 1씩만 늘므로 둘은 항상 같은 값이다) 오름차순.
  // 6.6: 이용제한·탈퇴 회원은 제외. 부정 응답으로 차감된(revokedAt 존재) 점수는
  // 집계에서 뺀다(10.4). 응답 0회 회원은 목록에 없다(6.4). 최대 50명까지만.
  private async getRankedRows(weekStart: Date): Promise<RankedRow[]> {
    const grouped = await this.prisma.leaderboardScore.groupBy({
      by: ['userId'],
      where: { weekStart, revokedAt: null },
      _sum: { points: true },
      _max: { awardedAt: true },
    });

    if (grouped.length === 0) return [];

    const userIds = grouped.map((row) => row.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, status: UserStatus.ACTIVE },
      select: { id: true, nickname: true },
    });
    const nicknameById = new Map(users.map((u) => [u.id, u.nickname ?? '']));

    const sorted = grouped
      .filter((row) => nicknameById.has(row.userId))
      .map((row) => ({
        userId: row.userId,
        nickname: nicknameById.get(row.userId)!,
        points: row._sum.points ?? 0,
        lastActiveAt: row._max.awardedAt!,
      }))
      .filter((row) => row.points > 0)
      .sort(
        (a, b) =>
          b.points - a.points ||
          a.lastActiveAt.getTime() - b.lastActiveAt.getTime(),
      )
      .slice(0, LEADERBOARD_MAX_ENTRIES);

    let rank = 0;
    let prevPoints: number | null = null;
    return sorted.map((row, index) => {
      if (row.points !== prevPoints) {
        rank = index + 1;
        prevPoints = row.points;
      }
      return { ...row, rank };
    });
  }
}
