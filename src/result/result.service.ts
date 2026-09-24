import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ResponseSessionStatus,
  SurveyOwnerType,
  SurveyQuestionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toKstDateString } from '../common/utils/kst-date.util';
import { maskSensitiveText } from '../common/utils/mask-sensitive-text.util';
import {
  DailyTrendPointDto,
  QuestionResultDto,
  ResultOptionDto,
  ResultScaleCountDto,
  SurveyResultResponseDto,
} from './dto/survey-result-response.dto';

const SURVEY_WITH_QUESTIONS_INCLUDE = {
  questions: { include: { options: true } },
} satisfies Prisma.SurveyInclude;
type SurveyWithQuestions = Prisma.SurveyGetPayload<{
  include: typeof SURVEY_WITH_QUESTIONS_INCLUDE;
}>;

const SESSIONS_WITH_ANSWERS_INCLUDE = {
  answers: true,
} satisfies Prisma.ResponseSessionInclude;
type SessionWithAnswers = Prisma.ResponseSessionGetPayload<{
  include: typeof SESSIONS_WITH_ANSWERS_INCLUDE;
}>;

interface SingleChoiceAnswer {
  optionId: string;
  etcText?: string;
}

@Injectable()
export class ResultService {
  constructor(private readonly prisma: PrismaService) {}

  // Spec 7.1: 본인 설문은 등록자만, 팀 설문은 현재 팀원 전원. 실시간 공개(모집
  // 중에도 조회 가능)라 상태 제한은 없다 — 권한만 확인한다.
  async getResult(
    userId: string,
    surveyId: string,
  ): Promise<SurveyResultResponseDto> {
    const survey = await this.loadSurveyOrThrow(surveyId);
    await this.assertCanView(survey, userId);

    const sessions = await this.prisma.responseSession.findMany({
      where: { surveyId, status: ResponseSessionStatus.SUBMITTED },
      include: SESSIONS_WITH_ANSWERS_INCLUDE,
    });
    const included = sessions.filter((s) => !s.excludedAt);
    const excludedCount = sessions.length - included.length;

    return new SurveyResultResponseDto({
      responseCount: included.length,
      excludedCount,
      targetCount: survey.targetCount,
      achievementRate: survey.targetCount
        ? included.length / survey.targetCount
        : null,
      deadlineAt: survey.deadlineAt?.toISOString() ?? null,
      purgeAt: survey.purgeAt?.toISOString() ?? null,
      dailyTrend: this.buildDailyTrend(included),
      questions: [...survey.questions]
        .sort((a, b) => a.orderNo - b.orderNo)
        .map((question) => this.buildQuestionResult(question, included)),
    });
  }

  private buildDailyTrend(
    sessions: SessionWithAnswers[],
  ): DailyTrendPointDto[] {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      if (!session.submittedAt) continue;
      const day = toKstDateString(session.submittedAt);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => new DailyTrendPointDto(date, count));
  }

  private buildQuestionResult(
    question: SurveyWithQuestions['questions'][number],
    sessions: SessionWithAnswers[],
  ): QuestionResultDto {
    const rawValues = sessions
      .map(
        (s) =>
          s.answers.find((a) => a.questionId === question.stableKey)?.value,
      )
      .filter((v): v is Prisma.JsonValue => v !== undefined && v !== null);

    const base = {
      questionId: question.stableKey,
      orderNo: question.orderNo,
      questionText: question.questionText,
      type: question.type,
    };

    switch (question.type) {
      case SurveyQuestionType.SINGLE_CHOICE: {
        const answered = rawValues.filter(
          (v) =>
            typeof (v as unknown as SingleChoiceAnswer)?.optionId === 'string',
        ) as unknown as SingleChoiceAnswer[];
        const counts = new Map(question.options.map((o) => [o.id, 0]));
        const etcAnswers: string[] = [];
        for (const value of answered) {
          counts.set(value.optionId, (counts.get(value.optionId) ?? 0) + 1);
          const option = question.options.find((o) => o.id === value.optionId);
          if (option?.isEtc && value.etcText?.trim()) {
            etcAnswers.push(maskSensitiveText(value.etcText.trim()));
          }
        }
        const total = answered.length;
        return new QuestionResultDto({
          ...base,
          responseCount: total,
          unansweredCount: sessions.length - total,
          options: [...question.options]
            .sort((a, b) => a.orderNo - b.orderNo)
            .map(
              (o) =>
                new ResultOptionDto(
                  o.id,
                  o.label,
                  counts.get(o.id) ?? 0,
                  total ? ((counts.get(o.id) ?? 0) / total) * 100 : 0,
                ),
            ),
          etcAnswers: etcAnswers.length ? etcAnswers : undefined,
        });
      }

      case SurveyQuestionType.MULTI_CHOICE: {
        const answered = rawValues.filter(
          (v) => Array.isArray(v) && v.length > 0,
        ) as unknown as string[][];
        const counts = new Map(question.options.map((o) => [o.id, 0]));
        for (const optionIds of answered) {
          for (const optionId of optionIds) {
            counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
          }
        }
        // Spec 7.2: 분모는 "이 문항 응답자 수" — 합이 100%를 넘을 수 있다.
        const total = answered.length;
        return new QuestionResultDto({
          ...base,
          responseCount: total,
          unansweredCount: sessions.length - total,
          options: [...question.options]
            .sort((a, b) => a.orderNo - b.orderNo)
            .map(
              (o) =>
                new ResultOptionDto(
                  o.id,
                  o.label,
                  counts.get(o.id) ?? 0,
                  total ? ((counts.get(o.id) ?? 0) / total) * 100 : 0,
                ),
            ),
        });
      }

      case SurveyQuestionType.SCALE: {
        const values = rawValues.filter((v) => typeof v === 'number');
        const average = values.length
          ? values.reduce((sum, v) => sum + v, 0) / values.length
          : 0;
        return new QuestionResultDto({
          ...base,
          responseCount: values.length,
          unansweredCount: sessions.length - values.length,
          average: Math.round(average * 10) / 10,
          scaleCounts: [1, 2, 3, 4, 5].map(
            (score) =>
              new ResultScaleCountDto(
                score,
                values.filter((v) => v === score).length,
              ),
          ),
          minScaleLabel: question.minScaleLabel,
          maxScaleLabel: question.maxScaleLabel,
        });
      }

      // SHORT_ANSWER / NARRATIVE / ETC(미사용)
      default: {
        // Spec 7.2: 제출 순서가 드러나지 않게 무작위 고정 순서로 — 답변 id가
        // 무작위 UUID라 그 값 자체로 정렬하면 제출 시각과 무관한 고정 순서가 된다.
        const answers = sessions
          .flatMap((s) =>
            s.answers
              .filter((a) => a.questionId === question.stableKey)
              .map((a) => ({ id: a.id, value: a.value })),
          )
          .filter((a) => typeof a.value === 'string' && a.value.trim())
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((a) => maskSensitiveText((a.value as string).trim()));
        return new QuestionResultDto({
          ...base,
          responseCount: answers.length,
          unansweredCount: sessions.length - answers.length,
          answers,
        });
      }
    }
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

  private async assertCanView(
    survey: SurveyWithQuestions,
    userId: string,
  ): Promise<void> {
    if (survey.ownerType === SurveyOwnerType.USER) {
      if (survey.ownerId !== userId) {
        throw new ForbiddenException('이 결과를 확인할 권한이 없습니다.');
      }
      return;
    }
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: survey.ownerId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException('이 결과를 확인할 권한이 없습니다.');
    }
  }
}
