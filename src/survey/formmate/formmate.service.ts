import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FormMateChangeStatus,
  FormMateMessageRole,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FormMateChangeNotApplicableException,
  SurveyNotDraftException,
} from '../../common/exceptions/business.exception';
import { SurveyService } from '../survey.service';
import { SurveyWithQuestions } from '../dto/survey-response.dto';
import { FormMateGeminiService } from './formmate-gemini.service';
import { SendFormMateMessageDto } from './dto/send-formmate-message.dto';
import { ApplyFormMateChangesDto } from './dto/apply-formmate-changes.dto';
import { SendFormMateMessageResponseDto } from './dto/send-formmate-message-response.dto';
import { FORMMATE_RECENT_MESSAGE_LIMIT } from './formmate.constants';
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
        // Spec 4.2: before는 AI가 아니라 서버가 현재 DB 상태에서 직접 계산한다.
        const target = change.targetQuestionId
          ? survey.questions.find(
              (q) => q.stableKey === change.targetQuestionId,
            )
          : undefined;

        if (change.type !== 'ADD_QUESTION' && !target) {
          // Gemini가 존재하지 않는 targetQuestionId를 지어낸 경우 — 적용
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
            targetQuestionId: change.targetQuestionId ?? null,
            before,
            after: (change.after ??
              Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
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
    }

    const newVersion = await this.prisma.$transaction(async (tx) => {
      let questions = [...survey.questions]
        .sort((a, b) => a.orderNo - b.orderNo)
        .map(toQuestionDraft);
      const existingStableKeys = new Set(questions.map((q) => q.id!));

      // ADD_QUESTION을 적용할 때 새로 배정한 stableKey — 나중에 그 change를
      // revert할 때 "어떤 문항을 지울지" 알아야 하므로 targetQuestionId 컬럼에
      // 함께 기록해둔다(원래는 ADD_QUESTION 제안 시점엔 target이 없었다).
      const assignedIdOverrides = new Map<string, string>();

      for (const change of changes) {
        const result = this.mergeChangeIntoQuestions(
          questions,
          change.type as FormMateChangeType,
          change.targetQuestionId,
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
                  targetQuestionId: assignedId,
                  after: {
                    ...(change.after as object),
                    id: assignedId,
                  },
                }
              : {}),
          },
        });
      }

      const updated = await tx.survey.update({
        where: { id: surveyId },
        data: { version: { increment: 1 } },
      });
      return updated.version;
    });

    return { newVersion };
  }

  // Spec 4.2: ADD_QUESTION은 새로 생성될 것이므로 되돌리기가 기존 UPDATE/DELETE와
  // 대칭이 아니다(before가 애초에 없음) — 타입별로 명시적으로 분기한다.
  private mergeChangeIntoQuestions(
    questions: FormMateQuestionDraft[],
    type: FormMateChangeType,
    targetQuestionId: string | null,
    content: FormMateQuestionDraft | null,
    revert: boolean,
  ): { questions: FormMateQuestionDraft[]; assignedId?: string } {
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
      // targetQuestionId 자리에 그 값을 넣어서 넘겨준다(applyChanges 참고).
      return {
        questions: questions.filter((q) => q.id !== targetQuestionId),
      };
    }

    if (type === 'DELETE_QUESTION') {
      if (!revert) {
        return {
          questions: questions.filter((q) => q.id !== targetQuestionId),
        };
      }
      return { questions: [...questions, content as FormMateQuestionDraft] };
    }

    // UPDATE_QUESTION / UPDATE_OPTION — id는 항상 targetQuestionId로 직접
    // 못박는다. content가 apply 경로에서는 Gemini가 준 after 그대로라 id
    // 필드를 믿을 수 없다(비어 있거나 다른 값일 수 있음) — 그대로 두면
    // stableKey가 바뀌어 별개 문항으로 취급될 위험이 있다.
    return {
      questions: questions.map((q) =>
        q.id === targetQuestionId
          ? { ...(content as FormMateQuestionDraft), id: targetQuestionId }
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
      'targetQuestionId는 아래 "현재 문항 목록"에 있는 id 값만 사용하세요 — 지어내지 마세요.',
      '',
      '현재 문항 목록(JSON):',
      JSON.stringify(currentQuestions),
    ].join('\n');
  }
}
