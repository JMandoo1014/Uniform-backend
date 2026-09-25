import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Schema, Type } from '@google/genai';
import { FormMateGenerationFailedException } from '../../common/exceptions/business.exception';
import {
  CREATABLE_SURVEY_QUESTION_TYPES,
  SCALE_MAX,
  SCALE_MIN,
} from '../survey.constants';
import {
  FormMateConversationTurn,
  FormMateGenerateResult,
} from './formmate.types';
import { FORMMATE_MAX_OUTPUT_TOKENS } from './formmate.constants';

// Spec 4.2: 문항 하나의 "될 내용". 예전에는 객체 전체를 nullable로 두고
// DELETE_QUESTION일 때만 null을 쓰게 했는데, 가벼운 모델이 ADD/UPDATE에서도
// null을 골라 적용 불가능한 제안이 저장됐다 — 그래서 nullable을 없애고, after가
// 필요 없는 DELETE_QUESTION은 아래 anyOf에서 after 자체가 없는 별도 모양으로 뺐다.
const QUESTION_AFTER_SCHEMA: Schema = {
  type: Type.OBJECT,
  description: '바뀐 뒤 문항의 전체 상태(바뀐 필드만이 아니라 항상 전체).',
  properties: {
    id: {
      type: Type.STRING,
      nullable: true,
      description:
        '수정/삭제 대상인 기존 문항의 id(stableKey). 새로 추가하는 문항이면 생략.',
    },
    type: {
      type: Type.STRING,
      enum: [...CREATABLE_SURVEY_QUESTION_TYPES],
    },
    questionText: { type: Type.STRING },
    required: { type: Type.BOOLEAN, nullable: true },
    minSelect: {
      type: Type.INTEGER,
      nullable: true,
      description: 'MULTI_CHOICE 전용.',
    },
    maxSelect: {
      type: Type.INTEGER,
      nullable: true,
      description: 'MULTI_CHOICE 전용.',
    },
    minScaleLabel: {
      type: Type.STRING,
      nullable: true,
      description: `SCALE 전용 — ${SCALE_MIN}점 설명.`,
    },
    maxScaleLabel: {
      type: Type.STRING,
      nullable: true,
      description: `SCALE 전용 — ${SCALE_MAX}점 설명.`,
    },
    options: {
      type: Type.ARRAY,
      nullable: true,
      description: 'SINGLE_CHOICE/MULTI_CHOICE 전용 보기 목록.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          isEtc: { type: Type.BOOLEAN, nullable: true },
        },
        required: ['label'],
      },
    },
  },
  // apply는 after로 문항을 통째로 교체하므로 바뀐 필드만 보내면 나머지(보기
  // 목록·척도 설명 등)가 지워진다. 설명만으로는 모델이 바뀐 필드만 보내는
  // 경우가 있어서, 해당 없는 필드도 null로라도 반드시 채우게 전부 required로 둔다.
  required: [
    'type',
    'questionText',
    'required',
    'minSelect',
    'maxSelect',
    'minScaleLabel',
    'maxScaleLabel',
    'options',
  ],
};

const CHANGE_SUMMARY_SCHEMA: Schema = {
  type: Type.STRING,
  description: '사람이 한눈에 읽을 한 줄 설명 (예: "3번 문항 보기 추가").',
};

const TARGET_STABLE_KEY_SCHEMA: Schema = {
  type: Type.STRING,
  description:
    '대상 문항의 id(stableKey). 대화 컨텍스트로 전달된 현재 문항 목록의 id만 쓸 것.',
};

// 변경 타입마다 필수 필드가 다르다 — 조건부 required를 anyOf 세 갈래로 표현한다.
// (서버는 그래도 모델이 어길 수 있다고 보고 sendMessage에서 한 번 더 검증한다.)
const FORMMATE_CHANGE_SCHEMA: Schema = {
  anyOf: [
    {
      type: Type.OBJECT,
      description: '새 문항 추가.',
      properties: {
        type: { type: Type.STRING, enum: ['ADD_QUESTION'] },
        summary: CHANGE_SUMMARY_SCHEMA,
        after: QUESTION_AFTER_SCHEMA,
      },
      required: ['type', 'summary', 'after'],
    },
    {
      type: Type.OBJECT,
      description: '기존 문항 수정(문구·설정·보기).',
      properties: {
        type: {
          type: Type.STRING,
          enum: ['UPDATE_QUESTION', 'UPDATE_OPTION'],
        },
        summary: CHANGE_SUMMARY_SCHEMA,
        targetStableKey: TARGET_STABLE_KEY_SCHEMA,
        after: QUESTION_AFTER_SCHEMA,
      },
      required: ['type', 'summary', 'targetStableKey', 'after'],
    },
    {
      type: Type.OBJECT,
      description: '기존 문항 삭제.',
      properties: {
        type: { type: Type.STRING, enum: ['DELETE_QUESTION'] },
        summary: CHANGE_SUMMARY_SCHEMA,
        targetStableKey: TARGET_STABLE_KEY_SCHEMA,
      },
      required: ['type', 'summary', 'targetStableKey'],
    },
  ],
};

const FORMMATE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    replyText: {
      type: Type.STRING,
      description: '사용자에게 그대로 보여줄 대화형 답변.',
    },
    changes: {
      type: Type.ARRAY,
      description: '이번 답변에서 제안하는 설문 변경 목록. 없으면 빈 배열.',
      items: FORMMATE_CHANGE_SCHEMA,
    },
  },
  required: ['replyText', 'changes'],
};

const DEFAULT_MODEL = 'gemini-3.8-flash';

@Injectable()
export class FormMateGeminiService {
  private client?: GoogleGenAI;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.model =
      this.configService.get<string>('GEMINI_MODEL') ?? DEFAULT_MODEL;
  }

  // GEMINI_API_KEY가 없으면 이 서비스를 실제로 쓸 때만 실패하게 한다 — 이
  // 서비스는 SurveyModule의 provider라, 생성자에서 즉시 클라이언트를 만들면
  // 키 하나가 없다는 이유로 FormMate를 안 쓰는 나머지 백엔드 전체가 부팅에
  // 실패한다(로컬 개발 환경·테스트 포함).
  private getClient(): GoogleGenAI {
    this.client ??= new GoogleGenAI({
      apiKey: this.configService.getOrThrow<string>('GEMINI_API_KEY'),
    });
    return this.client;
  }

  // Spec 4.2: 자유 텍스트 파싱이 아니라 responseSchema로 구조화 JSON을 강제해서
  // 파싱 신뢰성을 확보한다. 그래도 토큰 제한으로 응답이 잘리거나 모델이
  // 스키마를 못 지키는 경우가 있을 수 있어 JSON.parse는 방어적으로 감싼다.
  async generateReply(
    systemInstruction: string,
    conversation: FormMateConversationTurn[],
  ): Promise<FormMateGenerateResult> {
    const contents = conversation.map((turn) => ({
      role: turn.role === 'USER' ? 'user' : 'model',
      parts: [{ text: turn.content }],
    }));

    const response = await this.getClient().models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: FORMMATE_RESPONSE_SCHEMA,
        maxOutputTokens: FORMMATE_MAX_OUTPUT_TOKENS,
      },
    });

    const text = response.text;
    if (!text) {
      throw new FormMateGenerationFailedException();
    }

    try {
      return JSON.parse(text) as FormMateGenerateResult;
    } catch {
      throw new FormMateGenerationFailedException();
    }
  }
}
