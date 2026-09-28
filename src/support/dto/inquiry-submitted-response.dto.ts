export class InquirySubmittedResponseDto {
  id: string;
  status: string;
  createdAt: string;

  constructor(init: InquirySubmittedResponseDto) {
    Object.assign(this, init);
  }
}
