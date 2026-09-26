import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FormMateChangeStatus,
  FormMateMessageRole,
  FormMateProposedChange,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FormMateChangeInvalidException,
  FormMateChangeNotApplicableException,
  SurveyNotDraftException,
  SurveyVersionConflictException,
} from '../../common/exceptions/business.exception';
import { SurveyService } from '../survey.service';
import {
  SurveyResponseDto,
  SurveyWithQuestions,
} from '../dto/survey-response.dto';
import { FormMateGeminiService } from './formmate-gemini.service';
import { SendFormMateMessageDto } from './dto/send-formmate-message.dto';
import { ApplyFormMateChangesDto } from './dto/apply-formmate-changes.dto';
import { SendFormMateMessageResponseDto } from './dto/send-formmate-message-response.dto';
import { FORMMATE_RECENT_MESSAGE_LIMIT } from './formmate.constants';
import {
  changeRequiresAfter,
  isFormMateChangeType,
  isValidQuestionDraft,
} from './formmate-change.validator';
import {
  FormMateChangeType,
  FormMateConversationTurn,
  FormMateQuestionDraft,
} from './formmate.types';

type SurveyQuestionWithOptions = SurveyWithQuestions['questions'][number];

function toQuestionDraft(
  question: SurveyQuestionWithOptions,
): FormMateQuestionDraft {
  return {
    id: question.stableKey,
    type: question.type,
    questionText: question.questionText,
    required: question.required,
    minSelect: question.minSelect ?? undefined,
    maxSelect: question.maxSelect ?? undefined,
    minScaleLabel: question.minScaleLabel ?? undefined,
    maxScaleLabel: question.maxScaleLabel ?? undefined,
    options: [...question.options]
      .sort((a, b) => a.orderNo - b.orderNo)
      .map((option) => ({ label: option.label, isEtc: option.isEtc })),
  };
}

@Injectable()
export class FormMateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveyService: SurveyService,
    private readonly geminiService: FormMateGeminiService,
  ) {}

  // Spec 4.2 message: 팀원 전체가 같은 대화 기록을 보므로 DB에 영구 저장한다.
  async sendMessage(
    userId: string,
    surveyId: string,
    dto: SendFormMateMessageDto,
  ): Promise<SendFormMateMessageResponseDto> {
    const survey = await this.surveyService.getAccessibleSurveyOrThrow(
      userId,
      surveyId,
    );
    if (survey.status !== 'DRAFT') {
      throw new SurveyNotDraftException();
    }

    await this.prisma.formMateMessage.create({
      data: {
        surveyId,
        userId,
        role: FormMateMessageRole.USER,
        content: dto.message,
      },
    });

    const recentMessages = await this.prisma.formMateMessage.findMany({
      where: { surveyId },
      orderBy: { createdAt: 'desc' },
      take: FORMMATE_RECENT_MESSAGE_LIMIT,
    });
    const conversation: FormMateConversationTurn[] = recentMessages
      .reverse()
      .map((message) => ({
        role: message.role === FormMateMessageRole.USER ? 'USER' : 'ASSISTANT',
        content: message.content,
      }));

    const systemInstruction = this.buildSystemInstruction(survey);
    const result = await this.geminiService.generateReply(
      systemInstruction,
      conversation,
    );

    const savedChanges = await this.prisma.$transaction(async (tx) => {
      const assistantMessage = await tx.formMateMessage.create({
        data: {
          surveyId,
          userId,
          role: FormMateMessageRole.ASSISTANT,
          content: result.replyText,
        },
      });

      const created: {
        id: string;
        type: string;
        summary: string;
        after: Prisma.JsonValue;
      }[] = [];

      for (const change of result.changes) {
        if (!isFormMateChangeType(change.type)) {
          continue;
        }
        // 스키마로 after를 필수로 걸어도 모델이 null이나 필수 필드가 빠진
        // 문항을 줄 수 있다 — 그대로 저장하면 apply 시점에 문항을 만들 수
        // 없으므로, 적용 불가능한 제안은 아예 저장하지 않는다.
        if (
          changeRequiresAfter(change.type) &&
          !isValidQuestionDraft(change.after)
        ) {
          continue;
        }

        // Spec 4.2: before는 AI가 아니라 서버가 현재 DB 상태에서 직접 계산한다.
        const target = change.targetStableKey
          ? survey.questions.find((q) => q.stableKey === change.targetStableKey)
          : undefined;

        if (change.type !== 'ADD_QUESTION' && !target) {
          // Gemini가 존재하지 않는 targetStableKey를 지어낸 경우 — 적용
          // 불가능한 제안이므로 아예 저장하지 않는다.
          continue;
        }

        const before = target
          ? (toQuestionDraft(target) as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;

        const row = await tx.formMateProposedChange.create({
          data: {
            messageId: assistantMessage.id,
            surveyId,
            type: change.type,
            summary: change.summary,
            targetStableKey: change.targetStableKey ?? null,
            before,
            // DELETE_QUESTION은 after가 없다 — 모델이 뭔가 채워 보내도 버린다.
            after: changeRequiresAfter(change.type)
              ? (change.after as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          },
        });
        created.push({
          id: row.id,
          type: row.type,
          summary: row.summary,
          after: row.after,
        });
      }

      return created;
    });

    return new SendFormMateMessageResponseDto(result.replyText, savedChanges);
  }

  // Spec 4.2 apply: updateDraft와 동일한 접근 권한 기준을 그대로 쓴다.
  async applyChanges(
    userId: string,
    surveyId: string,
    dto: ApplyFormMateChangesDto,
  ): Promise<{ newVersion: number }> {
    const survey = await this.surveyService.getAccessibleSurveyOrThrow(
      userId,
      surveyId,
    );
    if (survey.status !== 'DRAFT') {
      throw new SurveyNotDraftException();
    }

    const changes = await this.prisma.formMateProposedChange.findMany({
      where: { id: { in: dto.changeIds }, surveyId },
    });
    if (changes.length !== dto.changeIds.length) {
      throw new NotFoundException('일부 제안을 찾을 수 없습니다.');
    }

    const revert = dto.revert ?? false;
    const expectedStatus = revert
      ? FormMateChangeStatus.APPLIED
      : FormMateChangeStatus.PENDING;
    for (const change of changes) {
      if (change.status !== expectedStatus) {
        throw new FormMateChangeNotApplicableException();
      }
      // sendMessage에서 거르기 전에 저장된 제안이나 손상된 스냅샷이 병합 단계에
      // 들어가면 replaceSurveyQuestions의 Prisma create가 터져 500이 된다 —
      // 트랜잭션에 들어가기 전에 막아서 400으로 알린다.
      if (!this.isMergeable(change, revert)) {
        throw new FormMateChangeInvalidException();
      }
    }

    // Spec 4.1/4.2: updateDraft와 같은 낙관적 락 패턴 — 문항을 바꾸는 작업이므로
    // 다른 팀원의 apply나 PATCH updateDraft와 동시에 겹치면 lost update가 될 수
    // 있다. 버전이 맞을 때만 증가시키는 조건부 update를 트랜잭션의 첫 문장으로
    // 두고, 나머지 변경(문항 교체·change 상태 갱신)은 그게 성공했을 때만 진행한다.
    const newVersion = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.survey.updateMany({
        where: { id: surveyId, version: dto.version },
        data: { version: { increment: 1 } },
      });
      if (count === 0) {
        return null;
      }

      let questions = [...survey.questions]
        .sort((a, b) => a.orderNo - b.orderNo)
        .map(toQuestionDraft);
      const existingStableKeys = new Set(questions.map((q) => q.id!));

      // ADD_QUESTION을 적용할 때 새로 배정한 stableKey — 나중에 그 change를
      // revert할 때 "어떤 문항을 지울지" 알아야 하므로 targetStableKey 컬럼에
      // 함께 기록해둔다(원래는 ADD_QUESTION 제안 시점엔 target이 없었다).
      const assignedIdOverrides = new Map<string, string>();

      for (const change of changes) {
        const result = this.mergeChangeIntoQuestions(
          questions,
          change.type as FormMateChangeType,
          change.targetStableKey,
          revert
            ? (change.before as unknown as FormMateQuestionDraft | null)
            : (change.after as unknown as FormMateQuestionDraft | null),
          revert,
        );
        questions = result.questions;
        if (result.assignedId) {
          existingStableKeys.add(result.assignedId);
          assignedIdOverrides.set(change.id, result.assignedId);
        }
        // DELETE_QUESTION revert는 지워졌던 문항을 원래 stableKey 그대로 되살린다
        // — 지금 DB에는 없는 id라서, ADD_QUESTION의 assignedId처럼 알려진 id로
        // 등록해두지 않으면 replaceSurveyQuestions가 "존재하지 않는 문항 id"로
        // 거부한다.
        if (result.restoredId) {
          existingStableKeys.add(result.restoredId);
        }
      }

      await this.surveyService.replaceSurveyQuestions(
        tx,
        surveyId,
        questions,
        existingStableKeys,
      );

      for (const change of changes) {
        const assignedId = assignedIdOverrides.get(change.id);
        await tx.formMateProposedChange.update({
          where: { id: change.id },
          data: {
            status: revert
              ? FormMateChangeStatus.REVERTED
              : FormMateChangeStatus.APPLIED,
            appliedAt: revert ? null : new Date(),
            ...(assignedId
              ? {
                  targetStableKey: assignedId,
                  after: {
                    ...(change.after as object),
                    id: assignedId,
                  },
                }
              : {}),
          },
        });
      }

      const updated = await tx.survey.findUniqueOrThrow({
        where: { id: surveyId },
      });
      return updated.version;
    });

    if (newVersion === null) {
      const latest = await this.surveyService.getAccessibleSurveyOrThrow(
        userId,
        surveyId,
      );
      const canManage = await this.surveyService.resolveCanManage(
        latest,
        userId,
      );
      throw new SurveyVersionConflictException(
        new SurveyResponseDto(latest, canManage),
      );
    }

    return { newVersion };
  }

  // mergeChangeIntoQuestions에 넘길 값이 실제로 문항을 만들 수 있는 모양인지.
  // apply는 after, revert는 before(ADD_QUESTION 제외 — 지울 id만 있으면 됨)를 쓴다.
  private isMergeable(
    change: FormMateProposedChange,
    revert: boolean,
  ): boolean {
    if (!isFormMateChangeType(change.type)) {
      return false;
    }
    if (change.type === 'ADD_QUESTION') {
      return revert
        ? !!change.targetStableKey
        : isValidQuestionDraft(change.after);
    }
    if (!change.targetStableKey) {
      return false;
    }
    if (revert) {
      return isValidQuestionDraft(change.before);
    }
    return (
      !changeRequiresAfter(change.type) || isValidQuestionDraft(change.after)
    );
  }

  // Spec 4.2: ADD_QUESTION은 새로 생성될 것이므로 되돌리기가 기존 UPDATE/DELETE와
  // 대칭이 아니다(before가 애초에 없음) — 타입별로 명시적으로 분기한다.
  private mergeChangeIntoQuestions(
    questions: FormMateQuestionDraft[],
    type: FormMateChangeType,
    targetStableKey: string | null,
    content: FormMateQuestionDraft | null,
    revert: boolean,
  ): {
    questions: FormMateQuestionDraft[];
    assignedId?: string;
    restoredId?: string;
  } {
    if (type === 'ADD_QUESTION') {
      if (!revert) {
        const assignedId = randomUUID();
        const newQuestion: FormMateQuestionDraft = {
          ...(content as FormMateQuestionDraft),
          id: assignedId,
        };
        return { questions: [...questions, newQuestion], assignedId };
      }
      // revert: apply 시점에 채워둔 id(override)로 지운다 — 호출자가
      // targetStableKey 자리에 그 값을 넣어서 넘겨준다(applyChanges 참고).
      return {
        questions: questions.filter((q) => q.id !== targetStableKey),
      };
    }

    if (type === 'DELETE_QUESTION') {
      if (!revert) {
        return {
          questions: questions.filter((q) => q.id !== targetStableKey),
        };
      }
      // before 스냅샷의 id를 믿지 않고 targetStableKey로 못박는다(UPDATE와 동일).
      const restoredId = targetStableKey!;
      return {
        questions: [
          ...questions,
          { ...(content as FormMateQuestionDraft), id: restoredId },
        ],
        restoredId,
      };
    }

    // UPDATE_QUESTION / UPDATE_OPTION — id는 항상 targetStableKey로 직접
    // 못박는다. content가 apply 경로에서는 Gemini가 준 after 그대로라 id
    // 필드를 믿을 수 없다(비어 있거나 다른 값일 수 있음) — 그대로 두면
    // stableKey가 바뀌어 별개 문항으로 취급될 위험이 있다.
    return {
      questions: questions.map((q) =>
        q.id === targetStableKey
          ? { ...(content as FormMateQuestionDraft), id: targetStableKey }
          : q,
      ),
    };
  }

  private buildSystemInstruction(survey: SurveyWithQuestions): string {
    const currentQuestions = [...survey.questions]
      .sort((a, b) => a.orderNo - b.orderNo)
      .map(toQuestionDraft);

    return [
      '당신은 대학(원)생 설문조사 플랫폼 Uni-Form의 설문 작성 도우미 FormMate입니다.',
      '사용자가 설문 문항을 만들거나 고치는 것을 대화로 돕습니다.',
      '문항을 추가/수정/삭제하고 싶다는 요청이면 changes 배열에 제안을 담아 응답하고,',
      '단순 질문이나 설명 요청이면 changes를 빈 배열로 둔 채 replyText로만 답하세요.',
      'targetStableKey는 아래 "현재 문항 목록"에 있는 id 값만 사용하세요 — 지어내지 마세요.',
      '',
      '현재 문항 목록(JSON):',
      JSON.stringify(currentQuestions),
    ].join('\n');
  }
}
