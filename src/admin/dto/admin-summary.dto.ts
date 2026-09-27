export class AdminMetricDto {
  total: number;
  today: number;
  week: number;
}

export class AdminTodoDto {
  type: string;
  label: string;
  // 관리자 콘솔 안에서 이동할 경로.
  to: string;
}

// Spec 10.1: 첫 화면 — 오늘·이번 주 가입자 수, 게시 설문 수, 응답 수.
export class AdminSummaryDto {
  members: AdminMetricDto;
  surveys: AdminMetricDto;
  responses: AdminMetricDto;
  todos: AdminTodoDto[];
}
