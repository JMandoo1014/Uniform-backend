import { SurveyOwnerType, SurveyStatus } from '@prisma/client';
import { SurveyQuestionResponseDto } from '../../survey/dto/survey-response.dto';

export class AdminSurveyRemovalDto {
  reasonCategory: string | null;
  memo: string | null;
  adminNickname: string | null;
  removedAt: string;
}

// Spec 10.2: 관리자용 설문 — 모든 상태 포함.
export class AdminSurveyDto {
  id: string;
  title: string;
  description: string | null;
  status: SurveyStatus;
  ownerType: SurveyOwnerType;
  ownerName: string;
  teamId: string | null;
  creatorId: string;
  creatorNickname: string | null;
  category: string | null;
  estimatedMinutes: number | null;
  targetCount: number | null;
  // 집계에 들어가는 응답 수(제외된 응답은 뺀 값).
  responseCount: number;
  excludedCount: number;
  warningCount: number;
  createdAt: string;
  publishedAt: string | null;
  deadlineAt: string | null;
  closedAt: string | null;
  purgeAt: string | null;
  // Spec 7.4: 파기 예정일이 지났으면 원문이 파기된 것으로 보고 복구를 막는다.
  purged: boolean;
  removal: AdminSurveyRemovalDto | null;

  constructor(init: AdminSurveyDto) {
    Object.assign(this, init);
  }
}

export class AdminSurveyDetailDto extends AdminSurveyDto {
  questions: SurveyQuestionResponseDto[];

  constructor(init: AdminSurveyDetailDto) {
    super(init);
    this.questions = init.questions;
  }
}

export class AdminSurveyRestoredDto {
  restoredStatus: SurveyStatus;
}
