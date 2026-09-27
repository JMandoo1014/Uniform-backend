export class SessionAnswerItemDto {
  questionId: string; // SurveyQuestion.stableKey
  value: unknown;

  constructor(questionId: string, value: unknown) {
    this.questionId = questionId;
    this.value = value;
  }
}

// Spec 5.3: 세션 시작/재개 응답. 중단 후 재접속이면 savedAnswers에 기존 임시저장 값이 담긴다.
export class SessionResponseDto {
  sessionId: string;
  savedAnswers: SessionAnswerItemDto[];

  constructor(sessionId: string, savedAnswers: SessionAnswerItemDto[]) {
    this.sessionId = sessionId;
    this.savedAnswers = savedAnswers;
  }
}
