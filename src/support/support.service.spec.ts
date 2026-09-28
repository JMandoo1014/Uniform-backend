import { BadRequestException } from '@nestjs/common';
import { SupportService } from './support.service';

describe('SupportService.createInquiry', () => {
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock };
    inquiry: { create: jest.Mock };
  };
  let mailService: { sendInquiryNotification: jest.Mock };
  let configService: { get: jest.Mock };
  let service: SupportService;

  const NOW = new Date('2026-09-28T00:00:00.000Z');

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn() },
      inquiry: { create: jest.fn() },
    };
    mailService = {
      sendInquiryNotification: jest.fn().mockResolvedValue(undefined),
    };
    configService = { get: jest.fn() };

    service = new SupportService(
      prisma as never,
      mailService as never,
      configService as never,
    );
  });

  it("uses the logged-in user's account email, ignoring any dto.email", async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      email: 'me@account.com',
    });
    prisma.inquiry.create.mockResolvedValue({
      id: 'inq-1',
      status: 'PENDING',
      createdAt: NOW,
    });
    configService.get.mockReturnValue('admin@uniform.example');

    const result = await service.createInquiry('user-1', {
      email: 'spoofed@evil.example',
      subject: '제목',
      message: '내용',
    });

    expect(prisma.inquiry.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        email: 'me@account.com',
        subject: '제목',
        message: '내용',
      },
    });
    expect(result).toEqual({
      id: 'inq-1',
      status: 'PENDING',
      createdAt: NOW.toISOString(),
    });
  });

  it('uses dto.email for an anonymous (logged-out) submission', async () => {
    prisma.inquiry.create.mockResolvedValue({
      id: 'inq-2',
      status: 'PENDING',
      createdAt: NOW,
    });
    configService.get.mockReturnValue(undefined);

    await service.createInquiry(undefined, {
      email: 'guest@example.com',
      subject: '제목',
      message: '내용',
    });

    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.inquiry.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        email: 'guest@example.com',
        subject: '제목',
        message: '내용',
      },
    });
  });

  it('rejects an anonymous submission with no email', async () => {
    await expect(
      service.createInquiry(undefined, {
        subject: '제목',
        message: '내용',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.inquiry.create).not.toHaveBeenCalled();
  });

  it('sends an admin notification when ADMIN_NOTIFICATION_EMAIL is set', async () => {
    prisma.inquiry.create.mockResolvedValue({
      id: 'inq-3',
      status: 'PENDING',
      createdAt: NOW,
    });
    configService.get.mockReturnValue('admin@uniform.example');

    await service.createInquiry(undefined, {
      email: 'guest@example.com',
      subject: '제목',
      message: '내용',
    });

    expect(mailService.sendInquiryNotification).toHaveBeenCalledWith(
      'admin@uniform.example',
      { email: 'guest@example.com', subject: '제목', message: '내용' },
    );
  });

  it('skips the admin notification when ADMIN_NOTIFICATION_EMAIL is unset', async () => {
    prisma.inquiry.create.mockResolvedValue({
      id: 'inq-4',
      status: 'PENDING',
      createdAt: NOW,
    });
    configService.get.mockReturnValue(undefined);

    await service.createInquiry(undefined, {
      email: 'guest@example.com',
      subject: '제목',
      message: '내용',
    });

    expect(mailService.sendInquiryNotification).not.toHaveBeenCalled();
  });
});
