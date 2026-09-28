// Spec 8.2: 내 응답 내역. "작성 중"인 세션도 여기서 같이 보여준다.
export class MyResponseItemDto {
  surveyId: string;
  surveyTitle: string;
  status: string; // IN_PROGRESS | SUBMITTED
  submittedAt: string | null;
  points: number | null;
  // Spec 10.2/10.4: 관리자가 부정 응답으로 집계에서 제외했는지 — 지금까지는
  // 이걸 알 방법이 응답자에게 전혀 없었다. admin-response.dto.ts의
  // excluded/excludedReason과 같은 이름·정의를 그대로 쓴다.
  excluded: boolean;
  excludedReason: string | null;

  constructor(init: MyResponseItemDto) {
    Object.assign(this, init);
  }
}
