import { NotFoundException } from '@nestjs/common';
import { InquiryStatus } from '@prisma/client';
import { AdminInquiriesService } from './admin-inquiries.service';
import { AdminAuditService } from './admin-audit.service';

describe('AdminInquiriesService', () => {
  let prisma: {
    inquiry: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    adminActionLog: { create: jest.Mock };
  };
  let service: AdminInquiriesService;

  const NOW = new Date('2026-09-28T00:00:00.000Z');
  const INQUIRY = {
    id: 'inq-1',
    userId: 'user-1',
    email: 'someone@example.com',
    subject: '제목',
    message: '내용',
    status: 'PENDING',
    createdAt: NOW,
  };

  beforeEach(() => {
    prisma = {
      inquiry: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      adminActionLog: { create: jest.fn() },
    };
    service = new AdminInquiriesService(
      prisma as never,
      new AdminAuditService(prisma as never),
    );
  });

  it('lists inquiries filtered by status, newest first', async () => {
    prisma.inquiry.findMany.mockResolvedValue([INQUIRY]);

    const result = await service.listInquiries({
      status: InquiryStatus.PENDING,
    });

    expect(prisma.inquiry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDING' } }),
    );
    expect(result).toEqual([
      {
        id: 'inq-1',
        userId: 'user-1',
        email: 'someone@example.com',
        subject: '제목',
        message: '내용',
        status: 'PENDING',
        createdAt: NOW.toISOString(),
      },
    ]);
  });

  it('404s when the requested inquiry does not exist', async () => {
    prisma.inquiry.findUnique.mockResolvedValue(null);

    await expect(service.getInquiry('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates status and records an audit log entry with before/after values', async () => {
    prisma.inquiry.findUnique.mockResolvedValue(INQUIRY);
    prisma.inquiry.update.mockResolvedValue({ ...INQUIRY, status: 'ANSWERED' });

    const result = await service.updateStatus('admin-1', 'inq-1', {
      status: InquiryStatus.ANSWERED,
    });

    expect(prisma.inquiry.update).toHaveBeenCalledWith({
      where: { id: 'inq-1' },
      data: { status: 'ANSWERED' },
    });
    const [[createArgs]] = prisma.adminActionLog.create.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(createArgs.data).toMatchObject({
      adminId: 'admin-1',
      action: 'INQUIRY_STATUS_CHANGED',
      targetType: 'Inquiry',
      targetId: 'inq-1',
      beforeValue: 'PENDING',
      afterValue: 'ANSWERED',
    });
    expect(result.status).toBe('ANSWERED');
  });
});
