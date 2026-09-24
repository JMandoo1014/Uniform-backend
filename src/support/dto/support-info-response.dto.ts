// Spec 9장: 고객센터 안내 — 문의 방법/유형과 FAQ. 거의 정적인 데이터.
export class FaqItemDto {
  question: string;
  answer: string;

  constructor(question: string, answer: string) {
    this.question = question;
    this.answer = answer;
  }
}

export class SupportInfoResponseDto {
  email: string;
  inquiryTypes: string[];
  faqList: FaqItemDto[];

  constructor(init: SupportInfoResponseDto) {
    Object.assign(this, init);
  }
}
