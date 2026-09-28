// 관리자 콘솔 문의 목록/상세 — 목록·상세 둘 다 같은 모양이라 하나로 쓴다.
export class AdminInquiryDto {
  id: string;
  userId: string | null;
  email: string;
  subject: string;
  message: string;
  status: string; // PENDING | ANSWERED
  createdAt: string;

  constructor(init: AdminInquiryDto) {
    Object.assign(this, init);
  }
}
