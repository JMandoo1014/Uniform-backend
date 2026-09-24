import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Survey, SurveyOwnerType, SurveyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SurveyArchiveNotAllowedException,
  SurveyNotOpenException,
} from '../common/exceptions/business.exception';
import { MySurveyResponseDto } from './dto/my-survey-response.dto';
import { MyResponseItemDto } from './dto/my-response-item.dto';
import { MyCouponDto } from './dto/my-coupon.dto';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const SURVEY_WITH_COUNT_INCLUDE = {
  _count: { select: { questions: true } },
} satisfies Prisma.SurveyInclude;
type SurveyWithCount = Prisma.SurveyGetPayload<{
  include: typeof SURVEY_WITH_COUNT_INCLUDE;
}>;

@Injectable()
export class MypageService {
  constructor(private readonly prisma: PrismaService) {}

  // Spec 8.3: 본인 설문 + 소속 팀의 팀 초안·팀 설문. 상태 탭은 선택적 필터.
  async getMySurveys(
    userId: string,
    status?: SurveyStatus,
  ): Promise<MySurveyResponseDto[]> {
    const [me, teamIds] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { nickname: true },
      }),
      this.prisma.teamMember
        .findMany({ where: { userId }, select: { teamId: true } })
        .then((rows) => rows.map((r) => r.teamId)),
    ]);

    const teams = teamIds.length
      ? await this.prisma.team.findMany({
          where: { id: { in: teamIds } },
          select: { id: true, name: true },
        })
      : [];
    const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

    const surveys = await this.prisma.survey.findMany({
      where: {
        status,
        OR: [
          { ownerType: SurveyOwnerType.USER, ownerId: userId },
          { ownerType: SurveyOwnerType.TEAM, ownerId: { in: teamIds } },
        ],
      },
      include: SURVEY_WITH_COUNT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return surveys.map((survey) =>
      this.toMySurveyDto(
        survey,
        survey.ownerType === SurveyOwnerType.USER
          ? (me.nickname ?? '')
          : (teamNameById.get(survey.ownerId) ?? ''),
      ),
    );
  }

  // Spec 8.2: 제출한 설문(제목/제출일/점수) + 작성 중인 세션.
  async getMyResponses(userId: string): Promise<MyResponseItemDto[]> {
    const sessions = await this.prisma.responseSession.findMany({
      where: { userId },
      include: { survey: { select: { title: true } }, score: true },
      orderBy: [{ submittedAt: 'desc' }, { startedAt: 'desc' }],
    });

    return sessions.map(
      (session) =>
        new MyResponseItemDto({
          surveyId: session.surveyId,
          surveyTitle: session.survey.title,
          status: session.status,
          submittedAt: session.submittedAt?.toISOString() ?? null,
          points: session.score?.points ?? null,
        }),
    );
  }

  // Spec 8.3: 직접 마감 — 본인 설문은 등록자, 팀 설문은 팀장만. 모집 중일 때만
  // 가능하고 다시 열 수 없다. 마감 시각 기준으로 30일 후 파기 예정일을 잡는다.
  async closeSurvey(
    userId: string,
    surveyId: string,
  ): Promise<MySurveyResponseDto> {
    const survey = await this.loadSurveyOrThrow(surveyId);
    const ownerName = await this.assertCanManage(survey, userId);

    const now = new Date();
    const purgeAt = new Date(now.getTime() + THIRTY_DAYS_MS);
    const { count } = await this.prisma.survey.updateMany({
      where: { id: surveyId, status: SurveyStatus.RECRUITING },
      data: {
        status: SurveyStatus.CLOSED,
        closedAt: now,
        purgeAt,
        version: { increment: 1 },
      },
    });
    if (count === 0) {
      throw new SurveyNotOpenException();
    }

    return this.toMySurveyDto(
      await this.loadSurveyOrThrow(surveyId),
      ownerName,
    );
  }

  // Spec 8.3: 마감/보관 상태에서만 보관 ↔ 보관 해제(=마감) 토글.
  async archiveSurvey(
    userId: string,
    surveyId: string,
    archived: boolean,
  ): Promise<MySurveyResponseDto> {
    const survey = await this.loadSurveyOrThrow(surveyId);
    const ownerName = await this.assertCanManage(survey, userId);

    const fromStatus = archived ? SurveyStatus.CLOSED : SurveyStatus.ARCHIVED;
    const toStatus = archived ? SurveyStatus.ARCHIVED : SurveyStatus.CLOSED;
    const { count } = await this.prisma.survey.updateMany({
      where: { id: surveyId, status: fromStatus },
      data: { status: toStatus, version: { increment: 1 } },
    });
    if (count === 0) {
      throw new SurveyArchiveNotAllowedException();
    }

    return this.toMySurveyDto(
      await this.loadSurveyOrThrow(surveyId),
      ownerName,
    );
  }

  // Spec 8.2: 받은 보상 내역(주차/순위/발송일).
  async getMyCoupons(userId: string): Promise<MyCouponDto[]> {
    const rewards = await this.prisma.leaderboardReward.findMany({
      where: { userId },
      orderBy: { weekStart: 'desc' },
    });

    return rewards.map(
      (reward) =>
        new MyCouponDto({
          weekStart: reward.weekStart.toISOString(),
          rank: reward.rank,
          couponType: reward.couponType,
          sentAt: reward.sentAt.toISOString(),
        }),
    );
  }

  private async loadSurveyOrThrow(surveyId: string): Promise<SurveyWithCount> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      include: SURVEY_WITH_COUNT_INCLUDE,
    });
    if (!survey) {
      throw new NotFoundException('설문을 찾을 수 없습니다.');
    }
    return survey;
  }

  // 권한 확인과 동시에 ownerName(본인 닉네임/팀 이름)을 돌려준다 — 응답 DTO를
  // 다시 만들 때 같은 조회를 반복하지 않기 위함.
  private async assertCanManage(
    survey: Survey,
    userId: string,
  ): Promise<string> {
    if (survey.ownerType === SurveyOwnerType.USER) {
      if (survey.ownerId !== userId) {
        throw new ForbiddenException('이 설문을 관리할 권한이 없습니다.');
      }
      const me = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { nickname: true },
      });
      return me.nickname ?? '';
    }

    const team = await this.prisma.team.findUnique({
      where: { id: survey.ownerId },
      select: { name: true, leaderId: true },
    });
    if (!team || team.leaderId !== userId) {
      throw new ForbiddenException('이 설문을 관리할 권한이 없습니다.');
    }
    return team.name;
  }

  private toMySurveyDto(
    survey: SurveyWithCount,
    ownerName: string,
  ): MySurveyResponseDto {
    return new MySurveyResponseDto({
      id: survey.id,
      title: survey.title,
      ownerType: survey.ownerType,
      ownerName,
      status: survey.status,
      questionCount: survey._count.questions,
      responseCount: survey.responseCount,
      targetCount: survey.targetCount,
      achievementRate: survey.targetCount
        ? survey.responseCount / survey.targetCount
        : null,
      deadlineAt: survey.deadlineAt?.toISOString() ?? null,
      purgeAt: survey.purgeAt?.toISOString() ?? null,
    });
  }
}
