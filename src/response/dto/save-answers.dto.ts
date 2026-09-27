import { IsObject } from 'class-validator';

// Spec 5.3: 임시저장. answers는 문항 stableKey(설문 응답 시 클라이언트에 노출되는
// 문항 id, survey-response.dto.ts 참고)를 key로 하는 맵이다. 값 형태는 문항
// 유형에 따라 다르다 — response-answer.validator.ts 참고.
export class SaveAnswersDto {
  @IsObject()
  answers: Record<string, unknown>;
}
