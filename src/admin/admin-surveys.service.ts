import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  ResponseSessionStatus,
  Survey,
  SurveyOwnerType,
  SurveyStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SurveyQuestionResponseDto } from '../survey/dto/survey-response.dto';
import { AdminAuditService } from './admin-audit.service';
import { AdminRewardsService } from './admin-rewards.service';
import {
  ADMIN_ACTIONS,
  ADMIN_TARGET_TYPES,
  SURVEY_STATUS_LABELS,
} from './admin.constants';
import { formatAdminAnswer } from './admin-ranking.util';
import { ListAdminSurveysQueryDto } from './dto/list-admin-surveys-query.dto';
import { RemoveSurveyDto } from './dto/remove-survey.dto';
import { AdminActionNoteDto } from './dto/admin-action-note.dto';
import { ExcludeSubmissionDto } from './dto/exclude-submission.dto';
import {
  AdminSurveyDetailDto,
  AdminSurveyDto,
  AdminSurveyRemovalDto,
  AdminSurveyRestoredDto,
} from './dto/admin-survey.dto';
import { AdminResponseDto } from './dto/admin-response.dto';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const SURVEY_WITH_QUESTIONS_INCLUDE = {
  questions: { include: { options: true } },
} satisfies Prisma.SurveyInclude;

@Injectable()
export class AdminSurveysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly rewards: AdminRewardsService,
    private readonly mail: MailService,
  ) {}

  // Spec 10.2: 모든 상태의 설문을 제목·게시자 닉네임·팀 이름으로 찾는다.
  async listSurveys(
    query: ListAdminSurveysQueryDto,
  ): Promise<AdminSurveyDto[]> {
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
        { id: keyword },
        { title: { contains: keyword, mode: 'insensitive' } },
        { creatorId: { in: matchedUsers.map((u) => u.id) } },
        {
          ownerType: SurveyOwnerType.TEAM,
          ownerId: { in: matchedTeams.map((t) => t.id) },
        },
      ];
    }

    const surveys = await this.prisma.survey.findMany({
      where: { status: query.status, ...(keywordOr ? { OR: keywordOr } : {}) },
      orderBy: [{ createdAt: 'desc' }],
    });
    return this.toSurveyDtos(surveys);
  }

  async getSurvey(surveyId: string): Promise<AdminSurveyDetailDto> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      include: SURVEY_WITH_QUESTIONS_INCLUDE,
    });
    if (!survey) {
      throw new NotFoundException('설문을 찾을 수 없습니다.');
    }
    const [base] = await this.toSurveyDtos([survey]);
    return new AdminSurveyDetailDto({
      ...base,
      questions: [...survey.questions]
        .sort((a, b) => a.orderNo - b.orderNo)
        .map((q) => new SurveyQuestionResponseDto(q)),
    });
  }

  async listSurveyResponses(surveyId: string): Promise<AdminResponseDto[]> {
    const exists = await this.prisma.survey.count({ where: { id: surveyId } });
    if (!exists) {
      throw new NotFoundException('설문을 찾을 수 없습니다.');
    }
    return this.listResponses({ surveyId });
  }

  // 제출된 응답을 관리자용으로 — 답변은 보기 문구 등 사람이 읽는 값으로 바꾼다.
  async listResponses(
    where: Prisma.ResponseSessionWhereInput,
  ): Promise<AdminResponseDto[]> {
    const sessions = await this.prisma.responseSession.findMany({
      where: { ...where, status: ResponseSessionStatus.SUBMITTED },
      orderBy: { submittedAt: 'desc' },
      include: {
        answers: true,
        user: { select: { nickname: true } },
        survey: {
          select: {
            title: true,
            questions: {
              orderBy: { orderNo: 'asc' },
              include: { options: true },
            },
          },
        },
      },
    });

    return sessions.map((session) => {
      const questions = session.survey.questions;
      const byKey = new Map(questions.map((q) => [q.stableKey, q]));
      return new AdminResponseDto({
        id: session.id,
        surveyId: session.surveyId,
        surveyTitle: session.survey.title,
        respondentId: session.userId,
        respondentNickname: session.user.nickname,
        submittedAt: session.submittedAt!.toISOString(),
        warningSubmitted: session.sameScaleWarningAcknowledged,
        excluded: !!session.excludedAt,
        excludedReason: session.excludedReason,
        answers: Object.fromEntries(
          session.answers.map((a) => [
            a.questionId,
            formatAdminAnswer(byKey.get(a.questionId), a.value),
          ]),
        ),
        questions: questions.map((q) => ({
          id: q.stableKey,
          title: q.questionText,
        })),
      });
    });
  }

  // Spec 4.4/10.2: 운영 삭제. 사유 분류·메모 필수, 등록자(팀 설문은 팀원 전체)에게 알린다.
  async removeSurvey(
    adminId: string,
    surveyId: string,
    dto: RemoveSurveyDto,
  ): Promise<{ success: boolean }> {
    const survey = await this.findSurveyOrThrow(surveyId);
    if (survey.status === SurveyStatus.REMOVED) {
      throw new ConflictException('이미 운영 삭제된 설문입니다.');
    }
    const recipients = await this.resolveRecipients(survey);
    const message = `"${survey.title}" 설문이 운영 정책 위반(${dto.reasonCategory})으로 삭제되었습니다. 자세한 내용은 고객센터로 문의해주세요.`;

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.survey.updateMany({
        where: { id: surveyId, status: survey.status },
        data: { status: SurveyStatus.REMOVED, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new ConflictException(
          '설문 상태가 바뀌었습니다. 새로고침 후 다시 시도해주세요.',
        );
      }
      await this.audit.record(
        {
          adminId,
          action: ADMIN_ACTIONS.SURVEY_REMOVE,
          targetType: ADMIN_TARGET_TYPES.SURVEY,
          targetId: surveyId,
          targetName: survey.title,
          reason: dto.reasonCategory,
          memo: dto.memo,
          beforeValue: SURVEY_STATUS_LABELS[survey.status],
          afterValue: SURVEY_STATUS_LABELS.REMOVED,
        },
        tx,
      );
      await tx.notification.createMany({
        data: recipients.map((r) => ({
          userId: r.id,
          type: NotificationType.SURVEY_REMOVED,
          message,
          targetUrl: '/support',
        })),
      });
    });

    void Promise.all(
      recipients
        .filter((r) => r.email)
        .map((r) =>
          this.mail.sendNotice(r.email!, '설문 운영 삭제 안내', message),
        ),
    );
    return { success: true };
  }

  // Spec 10.2: 잘못 삭제한 설문을 되돌린다. 마감 시각 경과 여부로 모집 중/마감.
  async restoreSurvey(
    adminId: string,
    surveyId: string,
    note: AdminActionNoteDto,
  ): Promise<AdminSurveyRestoredDto> {
    const survey = await this.findSurveyOrThrow(surveyId);
    if (survey.status !== SurveyStatus.REMOVED) {
      throw new ConflictException(
        '운영 삭제 상태의 설문만 복구할 수 있습니다.',
      );
    }
    const now = new Date();
    if (survey.purgeAt && survey.purgeAt <= now) {
      throw new ConflictException('원문이 파기된 설문은 복구할 수 없습니다.');
    }
    const deadlinePassed = !!survey.deadlineAt && survey.deadlineAt <= now;
    const restoredStatus = deadlinePassed
      ? SurveyStatus.CLOSED
      : SurveyStatus.RECRUITING;
    const data: Prisma.SurveyUpdateManyMutationInput = {
      status: restoredStatus,
      version: { increment: 1 },
    };
    if (deadlinePassed && !survey.closedAt) {
      data.closedAt = now;
      data.purgeAt = new Date(now.getTime() + THIRTY_DAYS_MS);
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.survey.updateMany({
        where: { id: surveyId, status: SurveyStatus.REMOVED },
        data,
      });
      if (count === 0) {
        throw new ConflictException(
          '설문 상태가 바뀌었습니다. 새로고침 후 다시 시도해주세요.',
        );
      }
      await this.audit.record(
        {
          adminId,
          action: ADMIN_ACTIONS.SURVEY_RESTORE,
          targetType: ADMIN_TARGET_TYPES.SURVEY,
          targetId: surveyId,
          targetName: survey.title,
          reason: note.reason,
          memo: note.memo,
          beforeValue: SURVEY_STATUS_LABELS.REMOVED,
          afterValue: SURVEY_STATUS_LABELS[restoredStatus],
        },
        tx,
      );
    });
    return { restoredStatus };
  }

  // Spec 10.2/10.4: 부정 응답을 결과 집계에서 빼고 그 응답의 점수도 차감한다.
  async excludeSubmission(
    adminId: string,
    sessionId: string,
    dto: ExcludeSubmissionDto,
  ): Promise<{ success: boolean }> {
    const session = await this.findSubmittedSessionOrThrow(sessionId);
    if (session.excludedAt) {
      throw new ConflictException('이미 집계에서 제외된 응답입니다.');
    }
    const score = await this.prisma.leaderboardScore.findUnique({
      where: { submissionId: sessionId },
    });
    if (score) {
      await this.rewards.assertWeekAdjustable(score.weekStart);
    }

    const now = new Date();
    // Spec 10.2/10.4 확장: 지금까지 응답자 본인은 자기 응답이 제외됐는지 알
    // 방법이 없었다 — restrict()가 이미 쓰는 "앱 알림 + 이메일" 패턴을 그대로
    // 재사용한다.
    const message = `"${session.survey.title}" 설문 응답이 집계에서 제외되었습니다. 사유: ${dto.reason}`;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.responseSession.updateMany({
        where: { id: sessionId, excludedAt: null },
        data: {
          excludedAt: now,
          excludedReason: dto.reason,
          excludedByAdminId: adminId,
        },
      });
      if (count === 0) {
        throw new ConflictException('이미 집계에서 제외된 응답입니다.');
      }
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
      await tx.notification.create({
        data: {
          userId: session.userId,
          type: NotificationType.RESPONSE_EXCLUDED,
          message,
          targetUrl: '/mypage/responses',
        },
      });
      await this.audit.record(
        {
          adminId,
          action: ADMIN_ACTIONS.RESPONSE_EXCLUDE,
          targetType: ADMIN_TARGET_TYPES.RESPONSE,
          targetId: sessionId,
          targetName: this.responseName(session),
          reason: dto.reason,
          memo: dto.memo,
          beforeValue: '정상',
          afterValue: '집계 제외',
        },
        tx,
      );
    });
    if (session.user.email) {
      void this.mail.sendNotice(session.user.email, '응답 제외 안내', message);
    }
    return { success: true };
  }

  // 관리자가 응답 원문을 연 기록 — 개인 답변 열람도 조치 기록에 남긴다.
  async recordResponseView(
    adminId: string,
    sessionId: string,
  ): Promise<{ success: boolean }> {
    const session = await this.findSubmittedSessionOrThrow(sessionId);
    await this.audit.record({
      adminId,
      action: ADMIN_ACTIONS.RESPONSE_VIEW,
      targetType: ADMIN_TARGET_TYPES.RESPONSE,
      targetId: sessionId,
      targetName: this.responseName(session),
      reason: '운영 확인',
      memo: '응답 원문 열람',
    });
    return { success: true };
  }

  private responseName(session: {
    survey: { title: string };
    user: { nickname: string | null };
  }): string {
    return `${session.survey.title} · ${session.user.nickname ?? '회원'}`;
  }

  private async findSubmittedSessionOrThrow(sessionId: string) {
    const session = await this.prisma.responseSession.findUnique({
      where: { id: sessionId },
      include: {
        survey: { select: { title: true } },
        user: { select: { nickname: true, email: true } },
      },
    });
    if (!session || session.status !== ResponseSessionStatus.SUBMITTED) {
      throw new NotFoundException('제출된 응답을 찾을 수 없습니다.');
    }
    return session;
  }

  private async findSurveyOrThrow(surveyId: string): Promise<Survey> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
    });
    if (!survey) {
      throw new NotFoundException('설문을 찾을 수 없습니다.');
    }
    return survey;
  }

  // Spec 8.4: 운영 삭제 알림 대상 — 본인 설문이면 등록자, 팀 설문이면 팀원 전체.
  private async resolveRecipients(
    survey: Survey,
  ): Promise<{ id: string; email: string | null }[]> {
    if (survey.ownerType === SurveyOwnerType.USER) {
      return this.prisma.user.findMany({
        where: { id: survey.ownerId },
        select: { id: true, email: true },
      });
    }
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: survey.ownerId },
      select: { user: { select: { id: true, email: true } } },
    });
    return members.map((m) => m.user);
  }

  private async toSurveyDtos(surveys: Survey[]): Promise<AdminSurveyDto[]> {
    if (surveys.length === 0) return [];
    const ids = surveys.map((s) => s.id);
    const userIds = [
      ...new Set([
        ...surveys.map((s) => s.creatorId),
        ...surveys
          .filter((s) => s.ownerType === SurveyOwnerType.USER)
          .map((s) => s.ownerId),
      ]),
    ];
    const teamIds = surveys
      .filter((s) => s.ownerType === SurveyOwnerType.TEAM)
      .map((s) => s.ownerId);
    const removedIds = surveys
      .filter((s) => s.status === SurveyStatus.REMOVED)
      .map((s) => s.id);

    const [users, teams, excluded, warnings, removalLogs] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, nickname: true },
      }),
      this.prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, name: true },
      }),
      this.prisma.responseSession.groupBy({
        by: ['surveyId'],
        where: {
          surveyId: { in: ids },
          status: ResponseSessionStatus.SUBMITTED,
          excludedAt: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.responseSession.groupBy({
        by: ['surveyId'],
        where: {
          surveyId: { in: ids },
          status: ResponseSessionStatus.SUBMITTED,
          sameScaleWarningAcknowledged: true,
        },
        _count: { _all: true },
      }),
      this.prisma.adminActionLog.findMany({
        where: {
          action: ADMIN_ACTIONS.SURVEY_REMOVE,
          targetId: { in: removedIds },
        },
        orderBy: { createdAt: 'desc' },
        include: { admin: { select: { nickname: true } } },
      }),
    ]);

    const nicknameById = new Map(users.map((u) => [u.id, u.nickname]));
    const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
    const excludedById = new Map(
      excluded.map((g) => [g.surveyId, g._count._all]),
    );
    const warningsById = new Map(
      warnings.map((g) => [g.surveyId, g._count._all]),
    );
    const removalById = new Map<string, AdminSurveyRemovalDto>();
    for (const log of removalLogs) {
      if (removalById.has(log.targetId)) continue;
      removalById.set(log.targetId, {
        reasonCategory: log.reason,
        memo: log.memo,
        adminNickname: log.admin.nickname,
        removedAt: log.createdAt.toISOString(),
      });
    }
    const now = new Date();

    return surveys.map(
      (s) =>
        new AdminSurveyDto({
          id: s.id,
          title: s.title,
          description: s.description,
          status: s.status,
          ownerType: s.ownerType,
          ownerName:
            (s.ownerType === SurveyOwnerType.TEAM
              ? teamNameById.get(s.ownerId)
              : nicknameById.get(s.ownerId)) ?? '',
          teamId: s.ownerType === SurveyOwnerType.TEAM ? s.ownerId : null,
          creatorId: s.creatorId,
          creatorNickname: nicknameById.get(s.creatorId) ?? null,
          category: s.category,
          estimatedMinutes: s.estimatedMinutes,
          targetCount: s.targetCount,
          responseCount: s.responseCount,
          excludedCount: excludedById.get(s.id) ?? 0,
          warningCount: warningsById.get(s.id) ?? 0,
          createdAt: s.createdAt.toISOString(),
          publishedAt: s.publishedAt?.toISOString() ?? null,
          deadlineAt: s.deadlineAt?.toISOString() ?? null,
          closedAt: s.closedAt?.toISOString() ?? null,
          purgeAt: s.purgeAt?.toISOString() ?? null,
          purged: !!s.purgeAt && s.purgeAt <= now,
          removal:
            s.status === SurveyStatus.REMOVED
              ? (removalById.get(s.id) ?? null)
              : null,
        }),
    );
  }
}
