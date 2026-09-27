import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminLogDto } from './dto/admin-log.dto';

export interface AdminLogEntry {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName?: string | null;
  reason?: string | null;
  memo?: string | null;
  beforeValue?: string | null;
  afterValue?: string | null;
}

const LOG_LIST_LIMIT = 500;

// Spec 10.1: 모든 관리자 조치를 조치자·시각·대상·사유와 함께 남기고 지우지 않는다.
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  // 조치와 같은 트랜잭션 안에서 쓰도록 트랜잭션 클라이언트를 받을 수 있다.
  record(
    entry: AdminLogEntry,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.adminActionLog.create({
      data: {
        adminId: entry.adminId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        targetName: entry.targetName ?? null,
        reason: entry.reason ?? null,
        memo: entry.memo ?? null,
        beforeValue: entry.beforeValue ?? null,
        afterValue: entry.afterValue ?? null,
      },
    });
  }

  async list(): Promise<AdminLogDto[]> {
    const logs = await this.prisma.adminActionLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: LOG_LIST_LIMIT,
      include: { admin: { select: { nickname: true } } },
    });
    return logs.map(
      (log) =>
        new AdminLogDto({
          id: log.id,
          createdAt: log.createdAt.toISOString(),
          actorId: log.adminId,
          actorName: log.admin.nickname ?? '',
          action: log.action,
          targetType: log.targetType,
          targetId: log.targetId,
          targetName: log.targetName,
          reason: log.reason,
          memo: log.memo,
          beforeValue: log.beforeValue,
          afterValue: log.afterValue,
        }),
    );
  }
}
