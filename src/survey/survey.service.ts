import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  SurveyOwnerType,
  SurveyQuestionType,
  SurveyStatus,
  UserStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccountNotActiveException,
  SurveyNotDraftException,
  SurveyVersionConflictException,
} from '../common/exceptions/business.exception';
import { kstDateStringToUtcEndOfDay } from '../common/utils/kst-date.util';
import { CreateSurveyDraftDto } from './dto/create-survey-draft.dto';
import { UpdateSurveyDraftDto } from './dto/update-survey-draft.dto';
import { ListSurveysQueryDto } from './dto/list-surveys-query.dto';
import {
  SurveyResponseDto,
  SurveyWithQuestions,
} from './dto/survey-response.dto';
import { SurveyListItemResponseDto } from './dto/survey-list-item-response.dto';
import { SurveyDetailResponseDto } from './dto/survey-detail-response.dto';
import { validatePublishableSurvey } from './survey-publish.validator';
import { decodeSurveyCursor, encodeSurveyCursor } from './survey-cursor.util';
import {
  SCALE_MAX,
  SCALE_MIN,
  SURVEY_LIST_DEFAULT_LIMIT,
} from './survey.constants';

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

  async deleteDraft(userId: string, surveyId: string): Promise<void> {
    const survey = await this.findOwnedSurveyOrThrow(userId, surveyId);
    if (survey.status !== SurveyStatus.DRAFT) {
      throw new SurveyNotDraftException();
    }
    await this.prisma.survey.delete({ where: { id: surveyId } });
  }

  // Spec 4.5: 게시는 4.3 규칙을 전부 검사한 뒤 상태를 RECRUITING으로 바꾼다.
  // "같은 게시 요청이 반복되어도 설문은 하나만 만든다" — DRAFT 조건부
  // update로 원자적으로 처리하고, 이미 게시된 상태면 그 결과를 그대로 반환한다.
  async publish(userId: string, surveyId: string): Promise<SurveyResponseDto> {
    // Spec 4.5 step 1: 게시 가능 여부의 첫 조건인 "계정이 활성인지" 확인.
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!account || account.status !== UserStatus.ACTIVE) {
      throw new AccountNotActiveException();
    }

    const survey = await this.findOwnedSurveyOrThrow(userId, surveyId);

    if (survey.status === SurveyStatus.RECRUITING) {
      return new SurveyResponseDto(survey);
    }
    if (survey.status !== SurveyStatus.DRAFT) {
      throw new SurveyNotDraftException();
    }

    const errors = validatePublishableSurvey(survey);
    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    const { count } = await this.prisma.survey.updateMany({
      where: { id: surveyId, status: SurveyStatus.DRAFT },
      data: {
        status: SurveyStatus.RECRUITING,
        publishedAt: new Date(),
        version: { increment: 1 },
      },
    });

    const published = await this.prisma.survey.findUniqueOrThrow({
      where: { id: surveyId },
      include: SURVEY_WITH_QUESTIONS_INCLUDE,
    });

    if (count === 0 && published.status !== SurveyStatus.RECRUITING) {
      throw new SurveyNotDraftException();
    }

    if (count > 0) {
      // Spec 8.5 / 12.3⑨: Dashboard "최근 활동" 피드가 재사용하는 알림 기록 —
      // 게시자 본인 앞으로 한 건 남긴다. (기찬 도메인 요청으로 추가, 2026-09-25)
      await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.SURVEY_PUBLISHED,
          message: `"${published.title}" 설문을 게시했습니다.`,
          targetUrl: `/surveys/${surveyId}`,
        },
      });
    }

    return new SurveyResponseDto(published);
  }

  // Spec 5.2: 모집 중인 설문만 게시 시각 최신순(동률이면 id 내림차순)으로.
  async listRecruiting(
    viewerId: string,
    query: ListSurveysQueryDto,
  ): Promise<{
    items: SurveyListItemResponseDto[];
    nextCursor: string | null;
  }> {
    const limit = query.limit ?? SURVEY_LIST_DEFAULT_LIMIT;
    const where: Prisma.SurveyWhereInput = {
      status: SurveyStatus.RECRUITING,
      ownerType: SurveyOwnerType.USER,
    };

    if (query.cursor) {
      const cursor = decodeSurveyCursor(query.cursor);
      where.OR = [
        { publishedAt: { lt: cursor.publishedAt } },
        { publishedAt: cursor.publishedAt, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.survey.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { _count: { select: { questions: true } } },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const ownerIds = [...new Set(page.map((survey) => survey.ownerId))];
    const owners = ownerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, nickname: true },
        })
      : [];
    const nicknameByOwnerId = new Map(
      owners.map((owner) => [owner.id, owner.nickname]),
    );

    const items = page.map(
      (survey) =>
        new SurveyListItemResponseDto(
          survey,
          nicknameByOwnerId.get(survey.ownerId) ?? null,
          viewerId,
        ),
    );

    const last = page.at(-1);
    const nextCursor =
      hasMore && last?.publishedAt
        ? encodeSurveyCursor({ publishedAt: last.publishedAt, id: last.id })
        : null;

    return { items, nextCursor };
  }

  // Spec 5.1: 임시저장은 작성자만, 운영 삭제는 누구에게도 보이지 않는다.
  async getDetail(
    viewerId: string,
    surveyId: string,
  ): Promise<SurveyDetailResponseDto> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      include: SURVEY_WITH_QUESTIONS_INCLUDE,
    });

    if (
      !survey ||
      survey.ownerType !== SurveyOwnerType.USER ||
      survey.status === SurveyStatus.REMOVED ||
      (survey.status === SurveyStatus.DRAFT && survey.ownerId !== viewerId)
    ) {
      throw new NotFoundException('설문을 찾을 수 없습니다.');
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: survey.ownerId },
      select: { nickname: true },
    });

    return new SurveyDetailResponseDto(
      survey,
      owner?.nickname ?? null,
      viewerId,
    );
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
