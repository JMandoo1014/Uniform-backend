import { Injectable } from '@nestjs/common';
import {
  FaqItemDto,
  SupportInfoResponseDto,
} from './dto/support-info-response.dto';

// Spec 9장: 운영 이메일. 프론트가 mailto 링크와 주소 복사 버튼을 붙인다.
const SUPPORT_EMAIL = 'ssuuniform2026@gmail.com';

// Spec 9장 "문의 유형 안내".
const INQUIRY_TYPES = [
  '설문·응답 신고',
  '계정·로그인 문제',
  '리더보드·보상 문의',
  '오류 제보',
  '제휴·기타',
];

// Spec 9장 "자주 묻는 질문" — 리더보드 규칙(1건 1점, 주간 초기화, 보상, 동점 추첨).
const FAQ_LIST: FaqItemDto[] = [
  new FaqItemDto(
    '리더보드 점수는 어떻게 쌓이나요?',
    '설문 1건을 제출할 때마다 1점이 쌓여요.',
  ),
  new FaqItemDto(
    '순위는 언제 초기화되나요?',
    '매주 월요일 00:00에 그 주의 순위가 초기화되고 새로 집계가 시작돼요.',
  ),
  new FaqItemDto(
    '보상은 어떻게 받나요?',
    '매주 집계가 끝나면 상위 순위 회원에게 보상이 발송돼요.',
  ),
  new FaqItemDto(
    '동점이면 어떻게 되나요?',
    '보상 순위에 동점자가 보상 인원보다 많으면 무작위 추첨으로 보상 대상을 정하고, 다시 추첨하지 않아요.',
  ),
];

@Injectable()
export class SupportService {
  getInfo(): SupportInfoResponseDto {
    return new SupportInfoResponseDto({
      email: SUPPORT_EMAIL,
      inquiryTypes: INQUIRY_TYPES,
      faqList: FAQ_LIST,
    });
  }
}
