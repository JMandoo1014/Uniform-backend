// 6.5 동점 처리: 응답 횟수가 같으면 같은 순위(1,2,2,4식). lastActiveAt은 목록
// 정렬 타이브레이크(같은 순위 안에서 먼저 도달한 사람이 위)에도 쓰인다.
export class LeaderboardEntryDto {
  rank: number;
  nickname: string;
  points: number;
  lastActiveAt?: string;

  constructor(
    rank: number,
    nickname: string,
    points: number,
    lastActiveAt?: Date,
  ) {
    this.rank = rank;
    this.nickname = nickname;
    this.points = points;
    if (lastActiveAt) this.lastActiveAt = lastActiveAt.toISOString();
  }
}

// Spec 6.4 "내 순위": rank가 null이면 이번 주 응답이 아직 없다는 뜻(화면에서
// "이번 주 첫 응답을 해보세요" 등으로 처리). pointsToNext가 null이면 전체 1위,
// 0이면 바로 위와 공동 순위.
export class MyRankDto {
  rank: number | null;
  points: number;
  pointsToNext: number | null;
  previousWeekRank: number | null;

  constructor(
    rank: number | null,
    points: number,
    pointsToNext: number | null,
    previousWeekRank: number | null,
  ) {
    this.rank = rank;
    this.points = points;
    this.pointsToNext = pointsToNext;
    this.previousWeekRank = previousWeekRank;
  }
}

export class LeaderboardRanksDto {
  page: number;
  totalPages: number;
  items: LeaderboardEntryDto[];

  constructor(page: number, totalPages: number, items: LeaderboardEntryDto[]) {
    this.page = page;
    this.totalPages = totalPages;
    this.items = items;
  }
}

export class LeaderboardResponseDto {
  weekStart: string;
  weekEnd: string;
  participantCount: number;
  top3: LeaderboardEntryDto[];
  ranks: LeaderboardRanksDto;
  myRank: MyRankDto;

  constructor(
    weekStart: Date,
    weekEnd: Date,
    participantCount: number,
    top3: LeaderboardEntryDto[],
    ranks: LeaderboardRanksDto,
    myRank: MyRankDto,
  ) {
    this.weekStart = weekStart.toISOString();
    this.weekEnd = weekEnd.toISOString();
    this.participantCount = participantCount;
    this.top3 = top3;
    this.ranks = ranks;
    this.myRank = myRank;
  }
}

export class LastWeekLeaderboardResponseDto {
  weekStart: string;
  weekEnd: string;
  top3: LeaderboardEntryDto[];

  constructor(weekStart: Date, weekEnd: Date, top3: LeaderboardEntryDto[]) {
    this.weekStart = weekStart.toISOString();
    this.weekEnd = weekEnd.toISOString();
    this.top3 = top3;
  }
}

// Spec 6.3: 보상 상품은 미정이라 관리자가 입력한 문구를 그대로 보여준다.
export class LeaderboardRewardsConfigDto {
  rewardText: string;
  tieRuleText: string;

  constructor(rewardText: string, tieRuleText: string) {
    this.rewardText = rewardText;
    this.tieRuleText = tieRuleText;
  }
}
