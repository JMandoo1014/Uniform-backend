// Spec 8.5 / 12.3⑨: 최근 활동 4건 — 새 테이블 없이 알림(8.4절) 데이터를 재사용.
export class RecentActivityItemDto {
  type: string;
  message: string;
  createdAt: string;
  targetUrl: string | null;

  constructor(init: RecentActivityItemDto) {
    Object.assign(this, init);
  }
}
