// Spec 8.2: 내 응답 내역. "작성 중"인 세션도 여기서 같이 보여준다.
export class MyResponseItemDto {
  surveyId: string;
  surveyTitle: string;
  status: string; // IN_PROGRESS | SUBMITTED
  submittedAt: string | null;
  points: number | null;

  constructor(init: MyResponseItemDto) {
    Object.assign(this, init);
  }
}
