// Spec 10.1: 관리자 조치 기록 한 줄.
export class AdminLogDto {
  id: string;
  createdAt: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string | null;
  reason: string | null;
  memo: string | null;
  beforeValue: string | null;
  afterValue: string | null;

  constructor(init: AdminLogDto) {
    Object.assign(this, init);
  }
}
