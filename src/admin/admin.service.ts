import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  ResponseSessionStatus,
  SurveyOwnerType,
  SurveyStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NicknameAlreadyExistsException } from '../common/exceptions/business.exception';
import { DEFAULT_LEADERBOARD_CONFIG_ID } from '../leaderboard/leaderboard.constants';
import { kstDateStringToUtcStartOfDay } from '../common/utils/kst-date.util';
import { REWARD_RANK_LIMIT } from './admin.constants';
import { ListAdminUsersQueryDto } from './dto/list-admin-users-query.dto';
import { AdminUserListItemDto } from './dto/admin-user-list-item.dto';
import { RestrictUserDto } from './dto/restrict-user.dto';
import { NicknameForceChangeDto } from './dto/nickname-force-change.dto';
import { ListAdminSurveysQueryDto } from './dto/list-admin-surveys-query.dto';
import { AdminSurveyListItemDto } from './dto/admin-survey-list-item.dto';
import { AdminSurveyDetailDto } from './dto/admin-survey-detail.dto';
import { RemoveSurveyDto } from './dto/remove-survey.dto';
import { ExcludeSubmissionDto } from './dto/exclude-submission.dto';
import {
  AdminLeaderboardRankDto,
  AdminSubmissionDto,
  AdminWeeklyLeaderboardResponseDto,
} from './dto/admin-weekly-leaderboard-response.dto';
import { RunLotteryDto } from './dto/run-lottery.dto';
import { SendRewardsDto } from './dto/send-rewards.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

const SURVEY_WITH_QUESTIONS_INCLUDE = {
  questions: { include: { options: true } },
} satisfies Prisma.SurveyInclude;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface RankedRow {
  userId: string;
  nickname: string;
  points: number;
  rank: number;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // Spec 10.3: 닉네임·이메일 검색, 가입일/상태/게시 설문 수/응답 수/경고 후
  // 제출 수/소속 팀. 비밀번호는 포함하지 않는다.
  async listUsers(
    query: ListAdminUsersQueryDto,
  ): Promise<AdminUserListItemDto[]> {
    const users = await this.prisma.user.findMany({
      where: {
        nickname: query.nickname
          ? { contains: query.nickname, mode: 'insensitive' }
          : undefined,
        email: query.email
          ? { contains: query.email, mode: 'insensitive' }
          : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = users.map((u) => u.id);
    const [surveyGroups, sessionGroups, warningGroups, memberships] =
      await Promise.all([
        this.prisma.survey.groupBy({
          by: ['ownerId'],
          where: {
            ownerType: SurveyOwnerType.USER,
            ownerId: { in: userIds },
            publishedAt: { not: null },
          },
          _count: { _all: true },
        }),
        this.prisma.responseSession.groupBy({
          by: ['userId'],
          where: {
            userId: { in: userIds },
            status: ResponseSessionStatus.SUBMITTED,
          },
          _count: { _all: true },
        }),
        this.prisma.responseSession.groupBy({
          by: ['userId'],
          where: {
            userId: { in: userIds },
            status: ResponseSessionStatus.SUBMITTED,
            sameScaleWarningAcknowledged: true,
          },
          _count: { _all: true },
        }),
        this.prisma.teamMember.findMany({
          where: { userId: { in: userIds } },
          include: { team: { select: { name: true } } },
        }),
      ]);

    const surveyCountById = new Map(
      surveyGroups.map((g) => [g.ownerId, g._count._all]),
    );
    const responseCountById = new Map(
      sessionGroups.map((g) => [g.userId, g._count._all]),
    );
    const warningCountById = new Map(
      warningGroups.map((g) => [g.userId, g._count._all]),
    );
    const teamNamesById = new Map<string, string[]>();
    for (const m of memberships) {
      const list = teamNamesById.get(m.userId) ?? [];
      list.push(m.team.name);
      teamNamesById.set(m.userId, list);
    }

    return users.map(
      (u) =>
        new AdminUserListItemDto({
          id: u.id,
          nickname: u.nickname,
          email: u.email,
          createdAt: u.createdAt.toISOString(),
          status: u.status,
          surveyCount: surveyCountById.get(u.id) ?? 0,
          responseCount: responseCountById.get(u.id) ?? 0,
          warningCount: warningCountById.get(u.id) ?? 0,
          teamNames: teamNamesById.get(u.id) ?? [],
        }),
    );
  }

  // Spec 10.3: 이용 제한·해제. 같은 엔드포인트에서 lift 플래그로 방향을 나눈다
  // (명세서 계약엔 reason/durationDays만 있어 해제 신호가 없었음 — 사용자 확인 후
  // lift 필드를 추가로 구현, 명세서 확장 기록).
  async restrictUser(adminId: string, userId: string, dto: RestrictUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('회원을 찾을 수 없습니다.');
    }

    if (dto.lift) {
      const active = await this.prisma.userRestriction.findFirst({
        where: { userId, liftedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (!active) {
        throw new BadRequestException('해제할 이용 제한이 없습니다.');
      }

      await this.prisma.$transaction([
        this.prisma.userRestriction.update({
          where: { id: active.id },
          data: { liftedAt: new Date(), liftedReason: dto.reason },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { status: UserStatus.ACTIVE },
        }),
        this.prisma.notification.create({
          data: {
            userId,
            type: NotificationType.ACCOUNT_RESTRICTED,
            message: '이용 제한이 해제되었습니다.',
            targetUrl: '/mypage',
          },
        }),
      ]);
      return { success: true };
    }

    if (user.status === UserStatus.RESTRICTED) {
      throw new ConflictException('이미 이용 제한 중인 회원입니다.');
    }

    const now = new Date();
    const endsAt = dto.durationDays
      ? new Date(now.getTime() + dto.durationDays * 24 * 60 * 60 * 1000)
      : null;

    await this.prisma.$transaction([
      this.prisma.userRestriction.create({
        data: {
          userId,
          reason: dto.reason,
          durationDays: dto.durationDays ?? null,
          startedAt: now,
          endsAt,
          createdByAdminId: adminId,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { status: UserStatus.RESTRICTED },
      }),
      this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.ACCOUNT_RESTRICTED,
          message: `이용이 제한되었습니다. 사유: ${dto.reason}`,
          targetUrl: '/mypage',
        },
      }),
    ]);
    return { success: true };
  }

  // Spec 10.3: 부적절한 닉네임을 임의 닉네임으로 바꾸고 알린다.
  async forceChangeNickname(
    adminId: string,
    userId: string,
    dto: NicknameForceChangeDto,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('회원을 찾을 수 없습니다.');
    }

    const taken = await this.prisma.user.findUnique({
      where: { nickname: dto.newNickname },
    });
    if (taken && taken.id !== userId) {
      throw new NicknameAlreadyExistsException();
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { nickname: dto.newNickname },
      }),
      this.prisma.userProfileHistory.create({
        data: {
          userId,
          field: 'nickname',
          oldValue: user.nickname,
          newValue: dto.newNickname,
        },
      }),
      this.prisma.adminActionLog.create({
        data: {
          adminId,
          action: 'NICKNAME_FORCE_CHANGE',
          targetType: 'User',
          targetId: userId,
          memo: `${user.nickname ?? '(없음)'} -> ${dto.newNickname}`,
        },
      }),
      this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.NICKNAME_FORCED,
          message: `닉네임이 "${dto.newNickname}"(으)로 변경되었습니다.`,
          targetUrl: '/mypage',
        },
      }),
    ]);
    return { success: true };
  }

  // Spec 10.2: 모든 상태의 설문을 제목·게시자 닉네임·팀 이름으로 찾는다.
  async listSurveys(
    query: ListAdminSurveysQueryDto,
  ): Promise<AdminSurveyListItemDto[]> {
    const keyword = query.keyword?.trim();
    let keywordOr: Prisma.SurveyWhereInput[] | undefined;

    if (keyword) {
      const [matchedUsers, matchedTeams] = await Promise.all([
        this.prisma.user.findMany({
          where: { nickname: { contains: keyword, mode: 'insensitive' } },
          select: { id: true },
        }),
        this.prisma.team.findMany({
          where: { name: { contains: keyword, mode: 'insensitive' } },
          select: { id: true },
        }),
      ]);
      keywordOr = [
        { title: { contains: keyword, mode: 'insensitive' } },
        {
          ownerType: SurveyOwnerType.USER,
          ownerId: { in: matchedUsers.map((u) => u.id) },
        },
        {
          ownerType: SurveyOwnerType.TEAM,
          ownerId: { in: matchedTeams.map((t) => t.id) },
        },
      ];
    }

    const surveys = await this.prisma.survey.findMany({
      where: {
        status: query.status,
        ...(keywordOr ? { OR: keywordOr } : {}),
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const ownerNameById = await this.resolveOwnerNames(surveys);

    return surveys.map(
      (s) =>
        new AdminSurveyListItemDto({
          id: s.id,
          title: s.title,
          ownerName: ownerNameById.get(`${s.ownerType}:${s.ownerId}`) ?? '',
          status: s.status,
          publishedAt: s.publishedAt?.toISOString() ?? null,
        }),
    );
  }

  // Spec 10.2: "설문 내용(제목·설명·문항·보기)을 열어볼 수 있다" — 일반 조회
  // API와 달리 상태·소유 관계 제한 없이 전부 볼 수 있어야 해 별도로 추가.
  async getSurveyDetail(surveyId: string): Promise<AdminSurveyDetailDto> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      include: SURVEY_WITH_QUESTIONS_INCLUDE,
    });
    if (!survey) {
      throw new NotFoundException('설문을 찾을 수 없습니다.');
    }
    const ownerNameById = await this.resolveOwnerNames([survey]);
    return new AdminSurveyDetailDto(
      survey,
      ownerNameById.get(`${survey.ownerType}:${survey.ownerId}`) ?? '',
    );
  }

  // Spec 4.4/10.2: 운영 삭제. 사유 분류·메모 필수, 등록자(팀 설문은 팀원 전체)에게 알린다.
  async removeSurvey(adminId: string, surveyId: string, dto: RemoveSurveyDto) {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
    });
    if (!survey) {
      throw new NotFoundException('설문을 찾을 수 없습니다.');
    }
    if (survey.status === SurveyStatus.REMOVED) {
      throw new ConflictException('이미 운영 삭제된 설문입니다.');
    }

    const recipientIds = await this.resolveNotificationRecipients(survey);

    await this.prisma.$transaction([
      this.prisma.survey.update({
        where: { id: surveyId },
        data: { status: SurveyStatus.REMOVED, version: { increment: 1 } },
      }),
      this.prisma.adminActionLog.create({
        data: {
          adminId,
          action: 'SURVEY_REMOVE',
          targetType: 'Survey',
          targetId: surveyId,
          reason: dto.reasonCategory,
          memo: dto.memo,
        },
      }),
      this.prisma.notification.createMany({
        data: recipientIds.map((userId) => ({
          userId,
          type: NotificationType.SURVEY_REMOVED,
          message: `"${survey.title}" 설문이 운영 정책 위반(${dto.reasonCategory})으로 삭제되었습니다.`,
          targetUrl: '/support',
        })),
      }),
    ]);
    return { success: true };
  }

  // Spec 10.2: 잘못된 운영 삭제를 되돌린다. 마감 시각 경과 여부로 모집중/마감 분기.
  async restoreSurvey(adminId: string, surveyId: string) {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
    });
    if (!survey) {
      throw new NotFoundException('설문을 찾을 수 없습니다.');
    }
    if (survey.status !== SurveyStatus.REMOVED) {
      throw new ConflictException(
        '운영 삭제 상태의 설문만 복구할 수 있습니다.',
      );
    }

    const now = new Date();
    const deadlinePassed = !!survey.deadlineAt && survey.deadlineAt <= now;
    const restoredStatus = deadlinePassed
      ? SurveyStatus.CLOSED
      : SurveyStatus.RECRUITING;

    const data: Prisma.SurveyUpdateInput = {
      status: restoredStatus,
      version: { increment: 1 },
    };
    if (deadlinePassed && !survey.closedAt) {
      data.closedAt = now;
      data.purgeAt = new Date(now.getTime() + THIRTY_DAYS_MS);
    }

    await this.prisma.$transaction([
      this.prisma.survey.update({ where: { id: surveyId }, data }),
      this.prisma.adminActionLog.create({
        data: {
          adminId,
          action: 'SURVEY_RESTORE',
          targetType: 'Survey',
          targetId: surveyId,
        },
      }),
    ]);
    return { restoredStatus };
  }

  // Spec 10.2/10.4: 부정 응답을 결과 집계에서 빼고 점수도 차감한다.
  async excludeSubmission(
    adminId: string,
    sessionId: string,
    dto: ExcludeSubmissionDto,
  ) {
    const session = await this.prisma.responseSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.status !== ResponseSessionStatus.SUBMITTED) {
      throw new NotFoundException('제출된 응답을 찾을 수 없습니다.');
    }
    if (session.excludedAt) {
      throw new ConflictException('이미 제외된 응답입니다.');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.responseSession.update({
        where: { id: sessionId },
        data: {
          excludedAt: now,
          excludedReason: dto.reason,
          excludedByAdminId: adminId,
        },
      });
      await tx.leaderboardScore.updateMany({
        where: { submissionId: sessionId, revokedAt: null },
        data: {
          revokedAt: now,
          revokedReason: dto.reason,
          revokedByAdminId: adminId,
        },
      });
      await tx.survey.update({
        where: { id: session.surveyId },
        data: { responseCount: { decrement: 1 } },
      });
    });
    return { success: true };
  }

  // Spec 10.4: 이번 주/지난 주들의 전체 순위 + 회원별 그 주 제출 목록.
  async getWeeklyLeaderboard(
    weekStartStr: string,
  ): Promise<AdminWeeklyLeaderboardResponseDto> {
    const weekStart = kstDateStringToUtcStartOfDay(weekStartStr);
    const ranked = await this.getRankedRows(weekStart, false);

    const userIds = ranked.map((r) => r.userId);
    const sessions = userIds.length
      ? await this.prisma.responseSession.findMany({
          where: {
            userId: { in: userIds },
            status: ResponseSessionStatus.SUBMITTED,
            submittedAt: {
              gte: weekStart,
              lt: new Date(weekStart.getTime() + WEEK_MS),
            },
          },
          include: {
            survey: { select: { title: true } },
            answers: true,
          },
        })
      : [];

    const submissionsByUser: Record<string, AdminSubmissionDto[]> = {};
    for (const session of sessions) {
      const list = submissionsByUser[session.userId] ?? [];
      list.push(
        new AdminSubmissionDto({
          sessionId: session.id,
          surveyId: session.surveyId,
          surveyTitle: session.survey.title,
          submittedAt: session.submittedAt!.toISOString(),
          sameScaleWarningAcknowledged: session.sameScaleWarningAcknowledged,
          excluded: !!session.excludedAt,
          answers: Object.fromEntries(
            session.answers.map((a) => [a.questionId, a.value]),
          ),
        }),
      );
      submissionsByUser[session.userId] = list;
    }

    return new AdminWeeklyLeaderboardResponseDto({
      weekStart: weekStart.toISOString(),
      ranks: ranked.map(
        (r) =>
          new AdminLeaderboardRankDto({
            rank: r.rank,
            userId: r.userId,
            nickname: r.nickname,
            points: r.points,
          }),
      ),
      submissionsByUser,
    });
  }

  // Spec 6.5/10.4: 보상 순위(1~3위)의 동점자를 무작위 추첨. 같은 주에 다시 실행할 수 없다.
  async runLottery(adminId: string, dto: RunLotteryDto) {
    const weekStart = kstDateStringToUtcStartOfDay(dto.week);

    const existing = await this.prisma.leaderboardLottery.findUnique({
      where: { weekStart },
    });
    if (existing) {
      throw new ConflictException('이미 추첨을 진행한 주차입니다.');
    }

    const ranked = await this.getRankedRows(weekStart, true);
    const { contestedGroup, remainingSlots } =
      this.resolveRewardWinners(ranked);

    if (contestedGroup.length === 0) {
      throw new BadRequestException('추첨이 필요한 동점자가 없습니다.');
    }

    const shuffled = [...contestedGroup].sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, remainingSlots);

    const result = {
      contestedUserIds: contestedGroup.map((r) => r.userId),
      winnerUserIds: winners.map((r) => r.userId),
    };

    const lottery = await this.prisma.leaderboardLottery.create({
      data: {
        weekStart,
        result,
        executedByAdminId: adminId,
      },
    });
    return { result: lottery.result, executedAt: lottery.executedAt };
  }

  // Spec 10.4: 주차별 보상 대상에게 보상 내용을 기록하고 발송 완료로 표시한다.
  async sendRewards(adminId: string, weekStr: string, dto: SendRewardsDto) {
    const weekStart = kstDateStringToUtcStartOfDay(weekStr);
    const ranked = await this.getRankedRows(weekStart, true);
    const { clearWinners, contestedGroup } = this.resolveRewardWinners(ranked);

    let finalWinners = clearWinners;
    if (contestedGroup.length > 0) {
      const lottery = await this.prisma.leaderboardLottery.findUnique({
        where: { weekStart },
      });
      if (!lottery) {
        throw new BadRequestException(
          '동점자가 있어 먼저 추첨을 진행해야 합니다.',
        );
      }
      const result = lottery.result as {
        winnerUserIds: string[];
      };
      const winnerSet = new Set(result.winnerUserIds);
      finalWinners = [
        ...clearWinners,
        ...contestedGroup.filter((r) => winnerSet.has(r.userId)),
      ];
    }

    const already = await this.prisma.leaderboardReward.findMany({
      where: {
        weekStart,
        userId: { in: finalWinners.map((w) => w.userId) },
      },
      select: { userId: true },
    });
    const alreadySent = new Set(already.map((r) => r.userId));
    const toSend = finalWinners.filter((w) => !alreadySent.has(w.userId));

    if (toSend.length > 0) {
      await this.prisma.$transaction([
        this.prisma.leaderboardReward.createMany({
          data: toSend.map((w) => ({
            userId: w.userId,
            weekStart,
            rank: w.rank,
            couponType: dto.couponType,
            sentByAdminId: adminId,
          })),
        }),
        this.prisma.notification.createMany({
          data: toSend.map((w) => ({
            userId: w.userId,
            type: NotificationType.REWARD_SENT,
            message: `이번 주 리더보드 ${w.rank}위 보상(${dto.couponType})이 발송되었습니다.`,
            targetUrl: '/mypage',
          })),
        }),
      ]);
    }
    return { success: true };
  }

  // Spec 10.4: 리더보드 상단의 보상 내용·동점 규칙 공지 문구.
  async updateAnnouncement(adminId: string, dto: UpdateAnnouncementDto) {
    await this.prisma.leaderboardConfig.upsert({
      where: { id: DEFAULT_LEADERBOARD_CONFIG_ID },
      create: {
        id: DEFAULT_LEADERBOARD_CONFIG_ID,
        rewardText: dto.rewardText,
        tieRuleText: dto.tieRuleText,
        updatedByAdminId: adminId,
      },
      update: {
        rewardText: dto.rewardText,
        tieRuleText: dto.tieRuleText,
        updatedByAdminId: adminId,
      },
    });
    return { success: true };
  }

  // 동점 그룹을 경쟁 순위(1,2,2,4식)로 매기고, "명확한 당첨"과 "추첨이 필요한
  // 경계 동점 그룹"을 나눈다. 예: 1위 1명·2위 1명·3위 동점 2명(보상 1명 남음)
  // → clearWinners=[1위,2위], contestedGroup=[3위 동점 2명], remainingSlots=1.
  private resolveRewardWinners(ranked: RankedRow[]): {
    clearWinners: RankedRow[];
    contestedGroup: RankedRow[];
    remainingSlots: number;
  } {
    const withinLimit = ranked.filter((r) => r.rank <= REWARD_RANK_LIMIT);
    if (withinLimit.length <= REWARD_RANK_LIMIT) {
      return {
        clearWinners: withinLimit,
        contestedGroup: [],
        remainingSlots: 0,
      };
    }

    // Group by rank value (each group shares one competition-rank number).
    const groups: RankedRow[][] = [];
    for (const row of withinLimit) {
      const last = groups.at(-1);
      if (last && last[0].rank === row.rank) {
        last.push(row);
      } else {
        groups.push([row]);
      }
    }

    const clearWinners: RankedRow[] = [];
    let remaining = REWARD_RANK_LIMIT;
    for (const group of groups) {
      if (group.length <= remaining) {
        clearWinners.push(...group);
        remaining -= group.length;
      } else {
        return {
          clearWinners,
          contestedGroup: group,
          remainingSlots: remaining,
        };
      }
    }
    return { clearWinners, contestedGroup: [], remainingSlots: 0 };
  }

  // rewardEligibleOnly=true면 현재 ACTIVE 회원만(보상 발송 대상), false면 전체
  // (관리자 조회용 — 이용 제한 회원도 그 주의 기록을 볼 수 있어야 한다).
  private async getRankedRows(
    weekStart: Date,
    rewardEligibleOnly: boolean,
  ): Promise<RankedRow[]> {
    const grouped = await this.prisma.leaderboardScore.groupBy({
      by: ['userId'],
      where: { weekStart, revokedAt: null },
      _sum: { points: true },
      _max: { awardedAt: true },
    });
    if (grouped.length === 0) return [];

    const userIds = grouped.map((g) => g.userId);
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        ...(rewardEligibleOnly ? { status: UserStatus.ACTIVE } : {}),
      },
      select: { id: true, nickname: true },
    });
    const nicknameById = new Map(users.map((u) => [u.id, u.nickname ?? '']));

    const sorted = grouped
      .filter((g) => nicknameById.has(g.userId))
      .map((g) => ({
        userId: g.userId,
        nickname: nicknameById.get(g.userId)!,
        points: g._sum.points ?? 0,
        lastActiveAt: g._max.awardedAt!,
      }))
      .filter((r) => r.points > 0)
      .sort(
        (a, b) =>
          b.points - a.points ||
          a.lastActiveAt.getTime() - b.lastActiveAt.getTime(),
      );

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

  private async resolveOwnerNames(
    surveys: { ownerType: SurveyOwnerType; ownerId: string }[],
  ): Promise<Map<string, string>> {
    const userIds = surveys
      .filter((s) => s.ownerType === SurveyOwnerType.USER)
      .map((s) => s.ownerId);
    const teamIds = surveys
      .filter((s) => s.ownerType === SurveyOwnerType.TEAM)
      .map((s) => s.ownerId);

    const [users, teams] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, nickname: true },
          })
        : [],
      teamIds.length
        ? this.prisma.team.findMany({
            where: { id: { in: teamIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const map = new Map<string, string>();
    for (const u of users) {
      map.set(`${SurveyOwnerType.USER}:${u.id}`, u.nickname ?? '');
    }
    for (const t of teams) {
      map.set(`${SurveyOwnerType.TEAM}:${t.id}`, t.name);
    }
    return map;
  }

  // Spec 8.4: 운영 삭제 알림은 본인 설문이면 등록자에게, 팀 설문이면 팀원 전체에게.
  private async resolveNotificationRecipients(survey: {
    ownerType: SurveyOwnerType;
    ownerId: string;
  }): Promise<string[]> {
    if (survey.ownerType === SurveyOwnerType.USER) {
      return [survey.ownerId];
    }
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: survey.ownerId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }
}
