import { Injectable, NotFoundException } from '@nestjs/common';
import { InquiryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminInquiryDto } from './dto/admin-inquiry.dto';
import { ListAdminInquiriesQueryDto } from './dto/list-admin-inquiries-query.dto';
import { UpdateInquiryStatusDto } from './dto/update-inquiry-status.dto';

const LIST_LIMIT = 200;

// Spec 9 확장: 관리자가 접수된 문의를 조회·처리 상태 변경.
@Injectable()
export class AdminInquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async listInquiries(
    query: ListAdminInquiriesQueryDto,
  ): Promise<AdminInquiryDto[]> {
    const inquiries = await this.prisma.inquiry.findMany({
      where: { status: query.status },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
    return inquiries.map((inquiry) => this.toDto(inquiry));
  }

  async getInquiry(id: string): Promise<AdminInquiryDto> {
    return this.toDto(await this.findOrThrow(id));
  }

  async updateStatus(
    adminId: string,
    id: string,
    dto: UpdateInquiryStatusDto,
  ): Promise<AdminInquiryDto> {
    const inquiry = await this.findOrThrow(id);

    // 처리 완료 시각은 보유 기간 계산 기준이라, 이미 ANSWERED인 문의를 다시
    // ANSWERED로 바꿔도 처음 시각을 유지한다.
    let answeredAt: Date | null | undefined;
    if (dto.status === InquiryStatus.PENDING) {
      answeredAt = null;
    } else if (inquiry.status !== InquiryStatus.ANSWERED) {
      answeredAt = new Date();
    }

    const updated = await this.prisma.inquiry.update({
      where: { id },
      data: {
        status: dto.status,
        ...(answeredAt !== undefined ? { answeredAt } : {}),
      },
    });

    await this.audit.record({
      adminId,
      action: 'INQUIRY_STATUS_CHANGED',
      targetType: 'Inquiry',
      targetId: id,
      targetName: inquiry.subject,
      beforeValue: inquiry.status,
      afterValue: updated.status,
    });

    return this.toDto(updated);
  }

  private async findOrThrow(id: string) {
    const inquiry = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!inquiry) {
      throw new NotFoundException('문의를 찾을 수 없습니다.');
    }
    return inquiry;
  }

  private toDto(inquiry: {
    id: string;
    userId: string | null;
    email: string;
    subject: string;
    message: string;
    status: string;
    createdAt: Date;
  }): AdminInquiryDto {
    return new AdminInquiryDto({
      id: inquiry.id,
      userId: inquiry.userId,
      email: inquiry.email,
      subject: inquiry.subject,
      message: inquiry.message,
      status: inquiry.status,
      createdAt: inquiry.createdAt.toISOString(),
    });
  }
}
