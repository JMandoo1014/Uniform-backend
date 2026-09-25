import { Injectable, NotFoundException } from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  ResponseSessionStatus,
  SurveyOwnerType,
  SurveyStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccountNotActiveException,
  AlreadyRespondedException,
  AnswerValidationException,
  OwnSurveyResponseForbiddenException,
  SurveyNotOpenException,
} from '../common/exceptions/business.exception';
import { getKstWeekStart } from '../common/utils/kst-date.util';
import { SurveyWithQuestions } from '../survey/dto/survey-response.dto';
import {
  hasSameScaleWarning,
  validateSubmittedAnswers,
} from './response-answer.validator';
import { SaveAnswersDto } from './dto/save-answers.dto';
import { SubmitResponseDto } from './dto/submit-response.dto';
import {
  SessionAnswerItemDto,
  SessionResponseDto,
} from './dto/session-response.dto';
import { SubmitResultDto } from './dto/submit-result.dto';

const SURVEY_WITH_QUESTIONS_INCLUDE = {
  questions: { include: { options: true } },
} satisfies Prisma.SurveyInclude;

@Injectable()
export class ResponseService {
  constructor(private readonly prisma: PrismaService) {}

  // Spec 5.3 "처음 시작"/"중단 후 재접속": (survey, user)당 세션은 하나뿐이라
  // 이미 진행 중인 세션이 있으면 그걸 그대로 돌려준다.
  async startOrResumeSession(
    userId: string,
    surveyId: string,
  ): Promise<SessionResponseDto> {
    const survey = await this.loadSurveyOrThrow(surveyId);
    await this.assertCanRespond(survey, userId);

    const existing = await this.prisma.responseSession.findUnique({
      where: { surveyId_userId: { surveyId, userId } },
      include: { answers: true },
    });

    if (existing) {
      if (existing.status === ResponseSessionStatus.SUBMITTED) {
        throw new AlreadyRespondedException();
      }
      return new SessionResponseDto(
        existing.id,
        existing.answers.map(
          (a) => new SessionAnswerItemDto(a.questionId, a.value),
        ),
      );
    }

    const session = await this.prisma.responseSession.create({
      data: { surveyId, userId },
    });
    return new SessionResponseDto(session.id, []);
  }

  // Spec 5.3 "답 입력·변경": 제출 전 임시저장. 응답 수·점수에는 반영하지 않는다.
  async saveAnswers(
    userId: string,
    surveyId: string,
    sessionId: string,
    dto: SaveAnswersDto,
  ): Promise<{ success: true }> {
    const survey = await this.loadSurveyOrThrow(surveyId);
    const session = await this.findOwnOpenSessionOrThrow(
      userId,
      surveyId,
      sessionId,
    );
    void session;

    const knownStableKeys = new Set(survey.questions.map((q) => q.stableKey));
    const entries = Object.entries(dto.answers).filter(([stableKey]) =>
      knownStableKeys.has(stableKey),
    );

    await this.prisma.$transaction(
      entries.map(([stableKey, value]) =>
        this.prisma.sessionAnswer.upsert({
          where: { sessionId_questionId: { sessionId, questionId: stableKey } },
          create: {
            sessionId,
            questionId: stableKey,
            value: value as Prisma.InputJsonValue,
          },
          update: { value: value as Prisma.InputJsonValue },
        }),
      ),
    );

    return { success: true };
  }

  // Spec 5.4: 제출 핵심 트랜잭션 — 저장·응답 수 증가·리더보드 점수 지급을
  // 한 묶음으로 처리한다. 반복 클릭·재요청에는 저장된 결과를 그대로 돌려주고
  // 점수를 중복으로 주지 않는다(멱등).
  async submit(
    userId: string,
    surveyId: string,
    sessionId: string,
    dto: SubmitResponseDto,
  ): Promise<SubmitResultDto> {
    const survey = await this.loadSurveyOrThrow(surveyId);
    const session = await this.findOwnSessionOrThrow(
      userId,
      surveyId,
      sessionId,
    );

    if (session.status === ResponseSessionStatus.SUBMITTED) {
      const score = await this.prisma.leaderboardScore.findUnique({
        where: { submissionId: session.id },
      });
      const weeklyRank = score
        ? await this.getWeeklyRank(userId, score.weekStart)
        : null;
      return new SubmitResultDto(score?.points ?? 0, weeklyRank);
    }

    // 5.5: 마감 시각 이후 도착한 제출은 거부. 자격도 다시 확인한다.
    await this.assertCanRespond(survey, userId);

    const errors = validateSubmittedAnswers(survey, dto.answers);
    if (errors.length > 0) {
      throw new AnswerValidationException(errors);
    }
    const sameScaleWarning = hasSameScaleWarning(survey, dto.answers);
    const now = new Date();
    const weekStart = getKstWeekStart(now);

    const result = await this.prisma.$transaction(async (tx) => {
      // 동시 제출 레이스 가드: IN_PROGRESS일 때만 SUBMITTED로 전이시키고,
      // 0건이면 다른 요청이 먼저 처리한 것이므로 재조회해 같은 결과를 돌려준다.
      const { count } = await tx.responseSession.updateMany({
        where: { id: sessionId, status: ResponseSessionStatus.IN_PROGRESS },
        data: {
          status: ResponseSessionStatus.SUBMITTED,
          submittedAt: now,
          sameScaleWarningAcknowledged: sameScaleWarning,
        },
      });
      if (count === 0) {
        return null;
      }

      await Promise.all(
        Object.entries(dto.answers).map(([stableKey, value]) =>
          tx.sessionAnswer.upsert({
            where: {
              sessionId_questionId: { sessionId, questionId: stableKey },
            },
            create: {
              sessionId,
              questionId: stableKey,
              value: value as Prisma.InputJsonValue,
            },
            update: { value: value as Prisma.InputJsonValue },
          }),
        ),
      );

      await tx.survey.update({
        where: { id: surveyId },
        data: { responseCount: { increment: 1 } },
      });

      const score = await tx.leaderboardScore.create({
        data: { userId, submissionId: sessionId, weekStart, points: 1 },
      });

      // Spec 8.5 / 12.3⑨: Dashboard "최근 활동" 피드가 재사용하는 알림 기록 —
      // 제출자 본인 앞으로 한 건 남긴다. 결과 페이지(/surveys/:id/result)는
      // 설문 등록자·팀원만 볼 수 있어(result.service.ts assertCanView) 응답자
      // 본인은 403이 난다 — 본인 응답 내역을 보는 마이페이지로 보낸다.
      await tx.notification.create({
        data: {
          userId,
          type: NotificationType.RESPONSE_SUBMITTED,
          message: `"${survey.title}" 설문에 응답을 제출했습니다.`,
          targetUrl: '/mypage/responses',
        },
      });

      return score;
    });

    if (!result) {
      // 레이스에서 진 요청: 이미 다른 요청이 제출을 완료했으므로 그 결과를 그대로 반환.
      const score = await this.prisma.leaderboardScore.findUnique({
        where: { submissionId: sessionId },
      });
      const weeklyRank = score
        ? await this.getWeeklyRank(userId, score.weekStart)
        : null;
      return new SubmitResultDto(score?.points ?? 0, weeklyRank);
    }

    const weeklyRank = await this.getWeeklyRank(userId, result.weekStart);
    return new SubmitResultDto(result.points, weeklyRank);
  }

  // Spec 6.4/6.5: 이번 주 순위. 동점은 공동 순위(동순위 skip 없이 1,2,2,4식).
  // 부정 응답으로 차감된(revokedAt 존재) 점수는 집계에서 뺀다(10.4).
  private async getWeeklyRank(
    userId: string,
    weekStart: Date,
  ): Promise<number | null> {
    const rows = await this.prisma.leaderboardScore.groupBy({
      by: ['userId'],
      where: { weekStart, revokedAt: null },
      _sum: { points: true },
    });

    const myTotal = rows.find((r) => r.userId === userId)?._sum.points ?? 0;
    if (myTotal <= 0) return null;

    const higherCount = rows.filter(
      (r) => (r._sum.points ?? 0) > myTotal,
    ).length;
    return higherCount + 1;
  }

  private async loadSurveyOrThrow(
    surveyId: string,
  ): Promise<SurveyWithQuestions> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      include: SURVEY_WITH_QUESTIONS_INCLUDE,
    });
    if (!survey) {
      throw new NotFoundException('설문을 찾을 수 없습니다.');
    }
    return survey;
  }

  // Spec 5.1: 활성 회원만, 본인 설문/자기 팀의 팀 설문은 제외, 모집 중이고
  // 마감 전인 설문만 응답 가능. 서버가 매번 다시 확인한다(직접 접속 대응).
  private async assertCanRespond(
    survey: SurveyWithQuestions,
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true },
    });
    if (user.status !== UserStatus.ACTIVE) {
      throw new AccountNotActiveException();
    }

    if (
      survey.status !== SurveyStatus.RECRUITING ||
      (survey.deadlineAt && survey.deadlineAt.getTime() < Date.now())
    ) {
      throw new SurveyNotOpenException();
    }

    if (survey.ownerType === SurveyOwnerType.USER) {
      if (survey.ownerId === userId) {
        throw new OwnSurveyResponseForbiddenException();
      }
    } else {
      const membership = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: survey.ownerId, userId } },
      });
      if (membership) {
        throw new OwnSurveyResponseForbiddenException();
      }
    }
  }

  private async findOwnOpenSessionOrThrow(
    userId: string,
    surveyId: string,
    sessionId: string,
  ) {
    const session = await this.findOwnSessionOrThrow(
      userId,
      surveyId,
      sessionId,
    );
    if (session.status !== ResponseSessionStatus.IN_PROGRESS) {
      throw new AlreadyRespondedException();
    }
    return session;
  }

  private async findOwnSessionOrThrow(
    userId: string,
    surveyId: string,
    sessionId: string,
  ) {
    const session = await this.prisma.responseSession.findUnique({
      where: { id: sessionId },
    });
    if (
      !session ||
      session.surveyId !== surveyId ||
      session.userId !== userId
    ) {
      throw new NotFoundException('응답 세션을 찾을 수 없습니다.');
    }
    return session;
  }
}
