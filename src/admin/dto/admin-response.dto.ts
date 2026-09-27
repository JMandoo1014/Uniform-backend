export class AdminResponseQuestionDto {
  id: string;
  title: string;
}

// 관리자용 제출 응답 — 답변은 보기 id 대신 사람이 읽는 값(보기 문구·점수·원문)이다.
export class AdminResponseDto {
  id: string;
  surveyId: string;
  surveyTitle: string;
  respondentId: string;
  respondentNickname: string | null;
  submittedAt: string;
  warningSubmitted: boolean;
  excluded: boolean;
  excludedReason: string | null;
  answers: Record<string, string | string[] | number | null>;
  questions: AdminResponseQuestionDto[];

  constructor(init: AdminResponseDto) {
    Object.assign(this, init);
  }
}
