export class ResultOptionDto {
  optionId: string;
  label: string;
  count: number;
  percentage: number; // 소수점 한 자리로 반올림한 표시값(계산은 반올림 전 값 사용)

  constructor(
    optionId: string,
    label: string,
    count: number,
    percentage: number,
  ) {
    this.optionId = optionId;
    this.label = label;
    this.count = count;
    this.percentage = Math.round(percentage * 10) / 10;
  }
}

export class ResultScaleCountDto {
  score: number;
  count: number;

  constructor(score: number, count: number) {
    this.score = score;
    this.count = count;
  }
}

// Spec 7.2: 문항 유형별로 필요한 필드만 채워진다(단일/복수선택 → options,
// 척도 → average/scaleCounts, 단답/서술 → answers).
export class QuestionResultDto {
  questionId: string; // stableKey
  orderNo: number;
  questionText: string;
  type: string;
  responseCount: number; // 이 문항에 실제로 답한 응답 수(분모)
  unansweredCount: number; // 선택 문항의 미응답 건수

  options?: ResultOptionDto[];
  etcAnswers?: string[];

  average?: number;
  scaleCounts?: ResultScaleCountDto[];
  minScaleLabel?: string | null;
  maxScaleLabel?: string | null;

  answers?: string[]; // 단답/서술 — 무작위 고정 순서, 민감정보 마스킹 적용

  constructor(init: QuestionResultDto) {
    Object.assign(this, init);
  }
}

export class DailyTrendPointDto {
  date: string; // KST YYYY-MM-DD
  count: number;

  constructor(date: string, count: number) {
    this.date = date;
    this.count = count;
  }
}

// Spec 7.2 "요약" 탭 + "문항별 결과" 탭에 필요한 값을 한 번에 담는다.
export class SurveyResultResponseDto {
  responseCount: number; // 집계 대상(운영자가 제외한 응답은 빠짐)
  excludedCount: number; // "제외 N건" 표시(7.1)
  targetCount: number | null;
  achievementRate: number | null; // responseCount / targetCount
  deadlineAt: string | null;
  purgeAt: string | null; // 마감 후에만 값이 있음(7.4)
  dailyTrend: DailyTrendPointDto[];
  questions: QuestionResultDto[];

  constructor(init: SurveyResultResponseDto) {
    Object.assign(this, init);
  }
}
