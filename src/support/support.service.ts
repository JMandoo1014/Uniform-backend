import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  FaqItemDto,
  SupportInfoResponseDto,
} from './dto/support-info-response.dto';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { InquirySubmittedResponseDto } from './dto/inquiry-submitted-response.dto';

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
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  getInfo(): SupportInfoResponseDto {
    return new SupportInfoResponseDto({
      email: SUPPORT_EMAIL,
      inquiryTypes: INQUIRY_TYPES,
      faqList: FAQ_LIST,
    });
  }

  // Spec 9 확장: 로그인 사용자는 계정 이메일로 email을 덮어써서(다른 이메일로
  // 접수하는 걸 막는다), 비로그인 사용자만 dto.email을 실제로 쓴다 — 이용
  // 제한·운영 삭제 안내처럼 로그인 자체가 막힌 화면에서도 문의할 수 있어야
  // 하므로 비로그인 접수를 허용하기로 판단했다(별도 확인 없이 결정, 아래
  // 이유로 보고).
  async createInquiry(
    userId: string | undefined,
    dto: CreateInquiryDto,
  ): Promise<InquirySubmittedResponseDto> {
    let email: string;
    if (userId) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true },
      });
      if (!user.email) {
        throw new BadRequestException('계정에 등록된 이메일이 없습니다.');
      }
      email = user.email;
    } else {
      if (!dto.email) {
        throw new BadRequestException('이메일을 입력해주세요.');
      }
      email = dto.email;
    }

    const inquiry = await this.prisma.inquiry.create({
      data: {
        userId: userId ?? null,
        email,
        subject: dto.subject,
        message: dto.message,
      },
    });

    const adminEmail = this.configService.get<string>(
      'ADMIN_NOTIFICATION_EMAIL',
    );
    if (adminEmail) {
      await this.mailService.sendInquiryNotification(adminEmail, {
        email,
        subject: dto.subject,
        message: dto.message,
      });
    } else {
      this.logger.warn(
        'ADMIN_NOTIFICATION_EMAIL이 설정되지 않아 문의 접수 알림 메일을 보내지 않았습니다.',
      );
    }

    return new InquirySubmittedResponseDto({
      id: inquiry.id,
      status: inquiry.status,
      createdAt: inquiry.createdAt.toISOString(),
    });
  }
}
