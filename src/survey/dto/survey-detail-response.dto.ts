import { SurveyOwnerType } from '@prisma/client';
import {
  SurveyQuestionResponseDto,
  SurveyWithQuestions,
} from './survey-response.dto';

// Spec 5.1~5.3: 응답자 관점 설문 상세. 응답 진행 상태(진행 중 세션 등)는
// Response 도메인 몫이라 이번 범위에서는 다루지 않는다.
export class SurveyDetailResponseDto {
  id: string;
  title: string;
  description: string | null;
  ownerType: SurveyWithQuestions['ownerType'];
  // Spec 3.3: 팀 설문은 팀 이름으로 표시한다 — USER는 등록자 닉네임.
  ownerNickname: string | null;
  // I4: 이름 기준 그룹핑(같은 이름 팀이 여럿이면 깨짐) 대신 쓸 수 있는 실제
  // 팀 id. TEAM이면 ownerId 그대로, USER면 null.
  teamId: string | null;
  status: SurveyWithQuestions['status'];
  category: string | null;
  estimatedMinutes: number | null;
  // 2026-09-27부터 노출(원래 계산 공식이 없어 제외했던 것 — mypage 응답의
  // responseCount와 같은 패턴, Survey.responseCount를 그대로 읽는다).
  responseCount: number;
  targetCount: number | null;
  deadlineAt: string | null;
  publishedAt: string | null;
  isOwner: boolean;
  // 팀 설문 관리 권한 판단용 — USER는 isOwner와 같고, TEAM은 해산 여부와
  // 무관하게 "현재 leaderId === viewerId"만 본다(팀 해산 후에도 해산 당시
  // 팀장에게 관리 권한이 남는 spec 3.4 규칙과 맞물린다). 프론트가 이 필드
  // 하나로 "관리 버튼을 보여줄지"를 판단할 수 있도록 추가한다.
  canManage: boolean;
  // I5: survey.service.ts deleteDraft의 실제 삭제 권한 로직(DRAFT 상태 +
  // (USER는 본인, TEAM은 만든 사람 또는 팀장))을 그대로 계산해 내려준다 —
  // 프론트가 이 조건을 자체 추론하다 실제 백엔드 판단과 어긋나는 걸 막는다.
  canDelete: boolean;
  questions: SurveyQuestionResponseDto[];

  constructor(
    survey: SurveyWithQuestions,
    ownerNickname: string | null,
    viewerId: string,
    canManage: boolean,
    canDelete: boolean,
  ) {
    this.id = survey.id;
    this.title = survey.title;
    this.description = survey.description;
    this.ownerType = survey.ownerType;
    this.ownerNickname = ownerNickname;
    this.teamId =
      survey.ownerType === SurveyOwnerType.TEAM ? survey.ownerId : null;
    this.status = survey.status;
    this.category = survey.category;
    this.estimatedMinutes = survey.estimatedMinutes;
    this.responseCount = survey.responseCount;
    this.targetCount = survey.targetCount;
    this.deadlineAt = survey.deadlineAt?.toISOString() ?? null;
    this.publishedAt = survey.publishedAt?.toISOString() ?? null;
    this.isOwner = survey.ownerId === viewerId;
    this.canManage = canManage;
    this.canDelete = canDelete;
    this.questions = survey.questions
      .sort((a, b) => a.orderNo - b.orderNo)
      .map((question) => new SurveyQuestionResponseDto(question));
  }
}
