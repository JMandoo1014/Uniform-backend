import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SurveyOwnerType,
  SurveyQuestionType,
  SurveyStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  SurveyNotDraftException,
  SurveyVersionConflictException,
} from '../common/exceptions/business.exception';
import { kstDateStringToUtcEndOfDay } from '../common/utils/kst-date.util';
import { CreateSurveyDraftDto } from './dto/create-survey-draft.dto';
import { UpdateSurveyDraftDto } from './dto/update-survey-draft.dto';
import {
  SurveyResponseDto,
  SurveyWithQuestions,
} from './dto/survey-response.dto';
import { SCALE_MAX, SCALE_MIN } from './survey.constants';

const SURVEY_WITH_QUESTIONS_INCLUDE = {
  questions: { include: { options: true } },
} satisfies Prisma.SurveyInclude;

@Injectable()
export class SurveyService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(
    userId: string,
    dto: CreateSurveyDraftDto,
  ): Promise<SurveyResponseDto> {
    const survey = await this.prisma.survey.create({
      data: {
        ownerType: SurveyOwnerType.USER,
        ownerId: userId,
        title: dto.title,
        description: dto.description,
        status: SurveyStatus.DRAFT,
      },
      include: SURVEY_WITH_QUESTIONS_INCLUDE,
    });
    return new SurveyResponseDto(survey);
  }

  async getDraft(userId: string, surveyId: string): Promise<SurveyResponseDto> {
    const survey = await this.findOwnedSurveyOrThrow(userId, surveyId);
    return new SurveyResponseDto(survey);
  }

  // Spec 4.1: 낙관적 락(version) + 문항 전체 교체 방식의 임시저장. 4.3의
  // 글자 수·개수 규칙은 게시 시점에만 검사한다(미완성 저장 허용).
  async updateDraft(
    userId: string,
    surveyId: string,
    dto: UpdateSurveyDraftDto,
  ): Promise<SurveyResponseDto> {
    const current = await this.findOwnedSurveyOrThrow(userId, surveyId);
    if (current.status !== SurveyStatus.DRAFT) {
      throw new SurveyNotDraftException();
    }

    const data: Prisma.SurveyUpdateInput = { version: { increment: 1 } };
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.targetCount !== undefined) data.targetCount = dto.targetCount;
    if (dto.deadlineDate !== undefined) {
      data.deadlineAt =
        dto.deadlineDate === null
          ? null
          : kstDateStringToUtcEndOfDay(dto.deadlineDate);
    }

    const existingStableKeys = new Set(
      current.questions.map((q) => q.stableKey),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.survey.updateMany({
        where: { id: surveyId, version: dto.version },
        data,
      });
      if (count === 0) {
        return null;
      }

      if (dto.questions !== undefined) {
        for (const question of dto.questions) {
          if (question.id && !existingStableKeys.has(question.id)) {
            throw new BadRequestException(
              `존재하지 않는 문항 id입니다: ${question.id}`,
            );
          }
        }

        await tx.surveyQuestion.deleteMany({ where: { surveyId } });

        const isChoiceType = (type: SurveyQuestionType) =>
          type === SurveyQuestionType.SINGLE_CHOICE ||
          type === SurveyQuestionType.MULTI_CHOICE;

        for (const [index, question] of dto.questions.entries()) {
          await tx.surveyQuestion.create({
            data: {
              surveyId,
              orderNo: index + 1,
              stableKey: question.id ?? randomUUID(),
              type: question.type,
              questionText: question.questionText,
              required: question.required ?? true,
              minSelect:
                question.type === SurveyQuestionType.MULTI_CHOICE
                  ? (question.minSelect ?? null)
                  : null,
              maxSelect:
                question.type === SurveyQuestionType.MULTI_CHOICE
                  ? (question.maxSelect ?? null)
                  : null,
              minScale:
                question.type === SurveyQuestionType.SCALE ? SCALE_MIN : null,
              maxScale:
                question.type === SurveyQuestionType.SCALE ? SCALE_MAX : null,
              minScaleLabel:
                question.type === SurveyQuestionType.SCALE
                  ? (question.minScaleLabel ?? null)
                  : null,
              maxScaleLabel:
                question.type === SurveyQuestionType.SCALE
                  ? (question.maxScaleLabel ?? null)
                  : null,
              options:
                isChoiceType(question.type) && question.options
                  ? {
                      create: question.options.map((option, optionIndex) => ({
                        orderNo: optionIndex + 1,
                        label: option.label,
                        isEtc:
                          question.type === SurveyQuestionType.SINGLE_CHOICE
                            ? (option.isEtc ?? false)
                            : false,
                      })),
                    }
                  : undefined,
            },
          });
        }
      }

      return tx.survey.findUniqueOrThrow({
        where: { id: surveyId },
        include: SURVEY_WITH_QUESTIONS_INCLUDE,
      });
    });

    if (!updated) {
      const latest = await this.prisma.survey.findUniqueOrThrow({
        where: { id: surveyId },
        include: SURVEY_WITH_QUESTIONS_INCLUDE,
      });
      throw new SurveyVersionConflictException(new SurveyResponseDto(latest));
    }

    return new SurveyResponseDto(updated);
  }

  private async findOwnedSurveyOrThrow(
    userId: string,
    surveyId: string,
  ): Promise<SurveyWithQuestions> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      include: SURVEY_WITH_QUESTIONS_INCLUDE,
    });
    if (
      !survey ||
      survey.ownerType !== SurveyOwnerType.USER ||
      survey.ownerId !== userId
    ) {
      throw new NotFoundException('설문을 찾을 수 없습니다.');
    }
    return survey;
  }
}
