import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FormMateChangeStatus,
  SurveyQuestionType,
  SurveyStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FormMateChangeNotApplicableException,
  SurveyNotDraftException,
} from '../../common/exceptions/business.exception';
import { SurveyService } from '../survey.service';
import { FormMateGeminiService } from './formmate-gemini.service';
import { FormMateService } from './formmate.service';
import { FormMateQuestionDraft } from './formmate.types';

type ReplaceSurveyQuestionsCall = [
  unknown,
  string,
  FormMateQuestionDraft[],
  Set<string>,
];

interface ProposedChangeCreateArgs {
  data: {
    messageId: string;
    surveyId: string;
    type: string;
    summary: string;
    targetQuestionId: string | null;
    before: unknown;
    after: unknown;
  };
}

interface ProposedChangeCreateResult {
  id: string;
  type: string;
  summary: string;
  after: unknown;
}

interface ProposedChangeUpdateArgs {
  where: { id: string };
  data: {
    status: FormMateChangeStatus;
    appliedAt: Date | null;
    targetQuestionId?: string;
    after?: { id: string };
  };
}

interface FormMateMessageCreateArgs {
  data: {
    surveyId: string;
    userId: string;
    role: string;
    content: string;
  };
}

const EXISTING_QUESTION = {
  id: 'db-q-1',
  surveyId: 'survey-1',
  orderNo: 1,
  stableKey: 'q1',
  type: SurveyQuestionType.SHORT_ANSWER,
  questionText: '기존 질문',
  required: true,
  minSelect: null,
  maxSelect: null,
  minScale: null,
  maxScale: null,
  minScaleLabel: null,
  maxScaleLabel: null,
  options: [],
};

function buildDraftSurvey(overrides: Partial<{ status: SurveyStatus }> = {}) {
  return {
    id: 'survey-1',
    status: overrides.status ?? SurveyStatus.DRAFT,
    questions: [EXISTING_QUESTION],
  };
}

describe('FormMateService', () => {
  let service: FormMateService;
  let prisma: {
    formMateMessage: {
      create: jest.Mock<Promise<{ id: string }>, [FormMateMessageCreateArgs]>;
      findMany: jest.Mock;
    };
    formMateProposedChange: {
      create: jest.Mock<
        Promise<ProposedChangeCreateResult>,
        [ProposedChangeCreateArgs]
      >;
      findMany: jest.Mock;
      update: jest.Mock<Promise<unknown>, [ProposedChangeUpdateArgs]>;
    };
    survey: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let surveyService: {
    getAccessibleSurveyOrThrow: jest.Mock;
    replaceSurveyQuestions: jest.Mock<
      Promise<void>,
      ReplaceSurveyQuestionsCall
    >;
  };
  let geminiService: { generateReply: jest.Mock };

  beforeEach(async () => {
    prisma = {
      formMateMessage: {
        create: jest.fn<Promise<{ id: string }>, [FormMateMessageCreateArgs]>(),
        findMany: jest.fn(),
      },
      formMateProposedChange: {
        create: jest.fn<
          Promise<ProposedChangeCreateResult>,
          [ProposedChangeCreateArgs]
        >(),
        findMany: jest.fn(),
        update: jest.fn<Promise<unknown>, [ProposedChangeUpdateArgs]>(),
      },
      survey: { update: jest.fn() },
      // Runs the transaction callback against a tx stub built from the same
      // mocks — good enough for these unit tests since none of them assert
      // on transactional isolation, only on what gets called with what.
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({
          formMateMessage: prisma.formMateMessage,
          formMateProposedChange: prisma.formMateProposedChange,
          survey: prisma.survey,
        }),
      ),
    };
    surveyService = {
      getAccessibleSurveyOrThrow: jest.fn(),
      replaceSurveyQuestions: jest.fn<
        Promise<void>,
        ReplaceSurveyQuestionsCall
      >(),
    };
    geminiService = { generateReply: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormMateService,
        { provide: PrismaService, useValue: prisma },
        { provide: SurveyService, useValue: surveyService },
        { provide: FormMateGeminiService, useValue: geminiService },
      ],
    }).compile();

    service = module.get<FormMateService>(FormMateService);
  });

  describe('sendMessage', () => {
    it('rejects when the survey is not a draft', async () => {
      surveyService.getAccessibleSurveyOrThrow.mockResolvedValue(
        buildDraftSurvey({ status: SurveyStatus.RECRUITING }),
      );

      await expect(
        service.sendMessage('user-1', 'survey-1', { message: '안녕' }),
      ).rejects.toBeInstanceOf(SurveyNotDraftException);
      expect(prisma.formMateMessage.create).not.toHaveBeenCalled();
    });

    it('saves the user message, calls Gemini with recent context, and stores a server-computed before snapshot', async () => {
      const survey = buildDraftSurvey();
      surveyService.getAccessibleSurveyOrThrow.mockResolvedValue(survey);
      prisma.formMateMessage.create.mockResolvedValueOnce({ id: 'msg-user' });
      prisma.formMateMessage.findMany.mockResolvedValue([
        { role: 'USER', content: '안녕' },
      ]);
      geminiService.generateReply.mockResolvedValue({
        replyText: '문항을 하나 고쳤어요.',
        changes: [
          {
            type: 'UPDATE_QUESTION',
            summary: '질문 문구 수정',
            targetQuestionId: 'q1',
            after: {
              id: 'q1',
              type: 'SHORT_ANSWER',
              questionText: '고친 질문',
              required: true,
            },
          },
        ],
      });
      prisma.formMateMessage.create.mockResolvedValueOnce({
        id: 'msg-assistant',
      });
      prisma.formMateProposedChange.create.mockResolvedValue({
        id: 'change-1',
        type: 'UPDATE_QUESTION',
        summary: '질문 문구 수정',
        after: { id: 'q1', questionText: '고친 질문' },
      });

      const result = await service.sendMessage('user-1', 'survey-1', {
        message: '질문 좀 고쳐줘',
      });

      expect(prisma.formMateMessage.create.mock.calls[0][0]).toMatchObject({
        data: {
          surveyId: 'survey-1',
          userId: 'user-1',
          role: 'USER',
          content: '질문 좀 고쳐줘',
        },
      });
      expect(geminiService.generateReply).toHaveBeenCalledTimes(1);

      const createCall = prisma.formMateProposedChange.create.mock.calls[0][0];
      // before는 AI가 준 값이 아니라 서버가 현재 문항(EXISTING_QUESTION)에서
      // 직접 계산한 스냅샷이어야 한다.
      expect(createCall.data.before).toMatchObject({
        id: 'q1',
        questionText: '기존 질문',
      });
      expect(createCall.data.targetQuestionId).toBe('q1');

      expect(result.aiReply).toBe('문항을 하나 고쳤어요.');
      expect(result.proposedChanges).toEqual([
        {
          id: 'change-1',
          type: 'UPDATE_QUESTION',
          summary: '질문 문구 수정',
          after: { id: 'q1', questionText: '고친 질문' },
        },
      ]);
    });

    it('drops a proposed change whose targetQuestionId does not exist on the survey', async () => {
      surveyService.getAccessibleSurveyOrThrow.mockResolvedValue(
        buildDraftSurvey(),
      );
      prisma.formMateMessage.create.mockResolvedValueOnce({ id: 'msg-user' });
      prisma.formMateMessage.findMany.mockResolvedValue([]);
      geminiService.generateReply.mockResolvedValue({
        replyText: '이렇게 바꿔볼까요?',
        changes: [
          {
            type: 'UPDATE_QUESTION',
            summary: '존재하지 않는 문항 수정 시도',
            targetQuestionId: 'no-such-question',
            after: { questionText: 'x' },
          },
        ],
      });
      prisma.formMateMessage.create.mockResolvedValueOnce({
        id: 'msg-assistant',
      });

      const result = await service.sendMessage('user-1', 'survey-1', {
        message: '아무 문항이나 고쳐줘',
      });

      expect(prisma.formMateProposedChange.create).not.toHaveBeenCalled();
      expect(result.proposedChanges).toEqual([]);
    });
  });

  describe('applyChanges', () => {
    it('rejects applying a change that is not PENDING', async () => {
      surveyService.getAccessibleSurveyOrThrow.mockResolvedValue(
        buildDraftSurvey(),
      );
      prisma.formMateProposedChange.findMany.mockResolvedValue([
        { id: 'change-1', status: FormMateChangeStatus.APPLIED },
      ]);

      await expect(
        service.applyChanges('user-1', 'survey-1', {
          changeIds: ['change-1'],
        }),
      ).rejects.toBeInstanceOf(FormMateChangeNotApplicableException);
      expect(surveyService.replaceSurveyQuestions).not.toHaveBeenCalled();
    });

    it('rejects reverting a change that is not APPLIED', async () => {
      surveyService.getAccessibleSurveyOrThrow.mockResolvedValue(
        buildDraftSurvey(),
      );
      prisma.formMateProposedChange.findMany.mockResolvedValue([
        { id: 'change-1', status: FormMateChangeStatus.PENDING },
      ]);

      await expect(
        service.applyChanges('user-1', 'survey-1', {
          changeIds: ['change-1'],
          revert: true,
        }),
      ).rejects.toBeInstanceOf(FormMateChangeNotApplicableException);
    });

    it('404s when a requested changeId does not belong to the survey', async () => {
      surveyService.getAccessibleSurveyOrThrow.mockResolvedValue(
        buildDraftSurvey(),
      );
      prisma.formMateProposedChange.findMany.mockResolvedValue([]);

      await expect(
        service.applyChanges('user-1', 'survey-1', {
          changeIds: ['missing-change'],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('applies an UPDATE_QUESTION change, replaces questions with the merged list, and bumps version', async () => {
      surveyService.getAccessibleSurveyOrThrow.mockResolvedValue(
        buildDraftSurvey(),
      );
      prisma.formMateProposedChange.findMany.mockResolvedValue([
        {
          id: 'change-1',
          status: FormMateChangeStatus.PENDING,
          type: 'UPDATE_QUESTION',
          targetQuestionId: 'q1',
          before: { id: 'q1', questionText: '기존 질문' },
          after: { id: 'q1', type: 'SHORT_ANSWER', questionText: '고친 질문' },
        },
      ]);
      prisma.survey.update.mockResolvedValue({ version: 3 });

      const result = await service.applyChanges('user-1', 'survey-1', {
        changeIds: ['change-1'],
      });

      expect(surveyService.replaceSurveyQuestions).toHaveBeenCalledTimes(1);
      const [, , mergedQuestions] =
        surveyService.replaceSurveyQuestions.mock.calls[0];
      expect(mergedQuestions).toEqual([
        expect.objectContaining({ id: 'q1', questionText: '고친 질문' }),
      ]);

      const applyUpdateCall =
        prisma.formMateProposedChange.update.mock.calls[0][0];
      expect(applyUpdateCall.where).toEqual({ id: 'change-1' });
      expect(applyUpdateCall.data.status).toBe(FormMateChangeStatus.APPLIED);
      expect(applyUpdateCall.data.appliedAt).toBeInstanceOf(Date);
      expect(prisma.survey.update).toHaveBeenCalledWith({
        where: { id: 'survey-1' },
        data: { version: { increment: 1 } },
      });
      expect(result).toEqual({ newVersion: 3 });
    });

    it('assigns a fresh stableKey when applying ADD_QUESTION and records it for a later revert', async () => {
      surveyService.getAccessibleSurveyOrThrow.mockResolvedValue(
        buildDraftSurvey(),
      );
      prisma.formMateProposedChange.findMany.mockResolvedValue([
        {
          id: 'change-2',
          status: FormMateChangeStatus.PENDING,
          type: 'ADD_QUESTION',
          targetQuestionId: null,
          before: null,
          after: { type: 'SHORT_ANSWER', questionText: '새 질문' },
        },
      ]);
      prisma.survey.update.mockResolvedValue({ version: 1 });

      await service.applyChanges('user-1', 'survey-1', {
        changeIds: ['change-2'],
      });

      const [, , mergedQuestions] =
        surveyService.replaceSurveyQuestions.mock.calls[0];
      expect(mergedQuestions).toHaveLength(2);
      const added = mergedQuestions.find((q) => q.questionText === '새 질문');
      expect(added?.id).toEqual(expect.any(String));

      const updateCall = prisma.formMateProposedChange.update.mock.calls[0][0];
      // apply 시점에 배정한 id가 targetQuestionId/after 양쪽에 기록돼야
      // 나중에 revert할 때 "어떤 문항을 지울지" 알 수 있다.
      expect(updateCall.data.targetQuestionId).toBe(added?.id);
      expect(updateCall.data.after?.id).toBe(added?.id);
    });

    it('reverting DELETE_QUESTION re-inserts the before snapshot', async () => {
      // q1 was actually removed from the DB when this change was applied, so
      // a fresh fetch of the survey no longer includes it.
      surveyService.getAccessibleSurveyOrThrow.mockResolvedValue({
        ...buildDraftSurvey(),
        questions: [],
      });
      prisma.formMateProposedChange.findMany.mockResolvedValue([
        {
          id: 'change-3',
          status: FormMateChangeStatus.APPLIED,
          type: 'DELETE_QUESTION',
          targetQuestionId: 'q1',
          before: {
            id: 'q1',
            type: 'SHORT_ANSWER',
            questionText: '기존 질문',
          },
          after: null,
        },
      ]);
      prisma.survey.update.mockResolvedValue({ version: 5 });

      await service.applyChanges('user-1', 'survey-1', {
        changeIds: ['change-3'],
        revert: true,
      });

      const [, , mergedQuestions] =
        surveyService.replaceSurveyQuestions.mock.calls[0];
      expect(mergedQuestions).toEqual([
        expect.objectContaining({ id: 'q1', questionText: '기존 질문' }),
      ]);
      expect(prisma.formMateProposedChange.update).toHaveBeenCalledWith({
        where: { id: 'change-3' },
        data: { status: FormMateChangeStatus.REVERTED, appliedAt: null },
      });
    });
  });
});
