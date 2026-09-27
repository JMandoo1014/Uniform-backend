import { Prisma } from '@prisma/client';

// Spec 4.2: 클라이언트에는 id/type/summary/after만 노출한다. before는 되돌리기용
// 서버 내부 스냅샷이라 굳이 보낼 필요가 없다.
export class FormMateProposedChangeResponseDto {
  id: string;
  type: string;
  summary: string;
  after: Prisma.JsonValue;

  constructor(change: {
    id: string;
    type: string;
    summary: string;
    after: Prisma.JsonValue;
  }) {
    this.id = change.id;
    this.type = change.type;
    this.summary = change.summary;
    this.after = change.after;
  }
}
