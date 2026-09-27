import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  ResponseSessionStatus,
  User,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NicknameAlreadyExistsException } from '../common/exceptions/business.exception';
import {
  formatKstDateTime,
  getKstWeekStart,
} from '../common/utils/kst-date.util';
import { AdminAuditService } from './admin-audit.service';
import { AdminRewardsService, memberRole } from './admin-rewards.service';
import { AdminSurveysService } from './admin-surveys.service';
import {
  ADMIN_ACTIONS,
  ADMIN_TARGET_TYPES,
  USER_STATUS_LABELS,
} from './admin.constants';
import { WEEK_MS, generateNumberedName } from './admin-ranking.util';
import { ListAdminUsersQueryDto } from './dto/list-admin-users-query.dto';
import { RestrictUserDto } from './dto/restrict-user.dto';
import { NicknameForceChangeDto } from './dto/nickname-force-change.dto';
import { AdminActionNoteDto } from './dto/admin-action-note.dto';
import {
  AdminMemberDto,
  AdminNicknameChangedDto,
  AdminRestrictionDto,
  AdminStaffChangedDto,
} from './dto/admin-member.dto';
import { AdminResponseDto } from './dto/admin-response.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const NICKNAME_PREFIX = '회원';
const NICKNAME_ATTEMPTS = 20;

@Injectable()
export class AdminMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly rewards: AdminRewardsService,
    private readonly surveys: AdminSurveysService,
    private readonly mail: MailService,
  ) {}

  // Spec 10.3: 닉네임·이메일로 찾는다.
  async listMembers(query: ListAdminUsersQueryDto): Promise<AdminMemberDto[]> {
    const users = await this.prisma.user.findMany({
      where: {
        nickname: query.nickname
          ? { contains: query.nickname, mode: 'insensitive' }
          : undefined,
        email: query.email
          ? { contains: query.email, mode: 'insensitive' }
          : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.toMemberDtos(users);
  }

  async getMember(userId: string): Promise<AdminMemberDto> {
    const user = await this.findUserOrThrow(userId);
    const [dto] = await this.toMemberDtos([user]);
    return dto;
  }

  // 회원이 제출한 응답. week("YYYY-MM-DD", 그 주 아무 날)를 주면 그 주차만.
  async listMemberResponses(
    userId: string,
    week?: string,
  ): Promise<AdminResponseDto[]> {
    await this.findUserOrThrow(userId);
    const where: Prisma.ResponseSessionWhereInput = { userId };
    if (week) {
      const weekStart = this.rewards.parseWeekOrThrow(week);
      where.submittedAt = {
        gte: weekStart,
        lt: new Date(weekStart.getTime() + WEEK_MS),
      };
    }
    return this.surveys.listResponses(where);
  }

  // Spec 10.3: 이용 제한·해제. lift=true면 해제.
  async restrict(
    adminId: string,
    userId: string,
    dto: RestrictUserDto,
  ): Promise<{ success: boolean }> {
    const user = await this.findUserOrThrow(userId);
    if (dto.lift) {
      return this.lift(adminId, user, dto);
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ConflictException(
        user.status === UserStatus.RESTRICTED
          ? '이미 이용 제한 중인 회원입니다.'
          : '활성 회원만 이용을 제한할 수 있습니다.',
      );
    }

    const now = new Date();
    const endsAt = dto.durationDays
      ? new Date(now.getTime() + dto.durationDays * DAY_MS)
      : null;
    const period = endsAt ? `${formatKstDateTime(endsAt)}까지` : '무기한';
    const message = `이용이 제한되었습니다. 사유: ${dto.reason} · 기간: ${period}`;

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, status: UserStatus.ACTIVE },
        data: { status: UserStatus.RESTRICTED },
      });
      if (count === 0) {
        throw new ConflictException(
          '회원 상태가 바뀌었습니다. 새로고침 후 다시 시도해주세요.',
        );
      }
      await tx.userRestriction.create({
        data: {
          userId,
          reason: dto.reason,
          durationDays: dto.durationDays ?? null,
          startedAt: now,
          endsAt,
          createdByAdminId: adminId,
        },
      });
      await tx.notification.create({
        data: {
          userId,
          type: NotificationType.ACCOUNT_RESTRICTED,
          message,
          targetUrl: '/restricted',
        },
      });
      await this.audit.record(
        {
          adminId,
          action: ADMIN_ACTIONS.MEMBER_RESTRICT,
          targetType: ADMIN_TARGET_TYPES.MEMBER,
          targetId: userId,
          targetName: user.nickname,
          reason: dto.reason,
          memo: dto.memo,
          beforeValue: USER_STATUS_LABELS.ACTIVE,
          afterValue: `${USER_STATUS_LABELS.RESTRICTED} (${period})`,
        },
        tx,
      );
    });
    if (user.email) {
      void this.mail.sendNotice(user.email, '계정 이용 제한 안내', message);
    }
    return { success: true };
  }

  private async lift(
    adminId: string,
    user: User,
    dto: RestrictUserDto,
  ): Promise<{ success: boolean }> {
    const active = await this.prisma.userRestriction.findFirst({
      where: { userId: user.id, liftedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!active || user.status !== UserStatus.RESTRICTED) {
      throw new BadRequestException('해제할 이용 제한이 없습니다.');
    }
    const message = '계정 이용 제한이 해제되었습니다.';
    await this.prisma.$transaction(async (tx) => {
      await tx.userRestriction.update({
        where: { id: active.id },
        data: { liftedAt: new Date(), liftedReason: dto.reason },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { status: UserStatus.ACTIVE },
      });
      await tx.notification.create({
        data: {
          userId: user.id,
          type: NotificationType.ACCOUNT_RESTRICTED,
          message,
          targetUrl: '/mypage',
        },
      });
      await this.audit.record(
        {
          adminId,
          action: ADMIN_ACTIONS.MEMBER_UNRESTRICT,
          targetType: ADMIN_TARGET_TYPES.MEMBER,
          targetId: user.id,
          targetName: user.nickname,
          reason: dto.reason,
          memo: dto.memo,
          beforeValue: USER_STATUS_LABELS.RESTRICTED,
          afterValue: USER_STATUS_LABELS.ACTIVE,
        },
        tx,
      );
    });
    if (user.email) {
      void this.mail.sendNotice(
        user.email,
        '계정 이용 제한 해제 안내',
        message,
      );
    }
    return { success: true };
  }

  // Spec 10.3: 부적절한 닉네임을 임의 닉네임으로 바꾸고 알린다.
  async forceChangeNickname(
    adminId: string,
    userId: string,
    dto: NicknameForceChangeDto,
  ): Promise<AdminNicknameChangedDto> {
    const user = await this.findUserOrThrow(userId);
    const nickname = dto.newNickname ?? (await this.generateUniqueNickname());
    if (dto.newNickname) {
      const taken = await this.prisma.user.findUnique({
        where: { nickname: dto.newNickname },
      });
      if (taken && taken.id !== userId) {
        throw new NicknameAlreadyExistsException();
      }
    }
    const message = `운영 정책에 따라 닉네임이 "${nickname}"(으)로 변경되었습니다.`;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { nickname } });
        await tx.userProfileHistory.create({
          data: {
            userId,
            field: 'nickname',
            oldValue: user.nickname,
            newValue: nickname,
          },
        });
        await tx.notification.create({
          data: {
            userId,
            type: NotificationType.NICKNAME_FORCED,
            message,
            targetUrl: '/settings',
          },
        });
        await this.audit.record(
          {
            adminId,
            action: ADMIN_ACTIONS.MEMBER_RENAME,
            targetType: ADMIN_TARGET_TYPES.MEMBER,
            targetId: userId,
            targetName: user.nickname,
            reason: dto.reason,
            memo: dto.memo,
            beforeValue: user.nickname,
            afterValue: nickname,
          },
          tx,
        );
      });
    } catch (error) {
      // 닉네임 unique 경합(동시에 같은 번호가 나온 경우).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new NicknameAlreadyExistsException();
      }
      throw error;
    }
    if (user.email) {
      void this.mail.sendNotice(user.email, '닉네임 변경 안내', message);
    }
    return { nickname };
  }

  // Spec 6.3/11: 운영팀 구성원 지정·해제 — 리더보드에서 숨겨지고 보상 대상에서 빠진다.
  async toggleStaff(
    adminId: string,
    userId: string,
    note: AdminActionNoteDto,
  ): Promise<AdminStaffChangedDto> {
    const user = await this.findUserOrThrow(userId);
    if (user.status !== UserStatus.ACTIVE) {
      throw new ConflictException('활성 회원만 운영팀으로 지정할 수 있습니다.');
    }
    const isStaff = !user.isStaff;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { isStaff } });
      await this.audit.record(
        {
          adminId,
          action: ADMIN_ACTIONS.MEMBER_STAFF,
          targetType: ADMIN_TARGET_TYPES.MEMBER,
          targetId: userId,
          targetName: user.nickname,
          reason: note.reason,
          memo: note.memo,
          beforeValue: user.isStaff ? '운영팀' : '일반 회원',
          afterValue: isStaff ? '운영팀' : '일반 회원',
        },
        tx,
      );
    });
    return { isStaff };
  }

  private async generateUniqueNickname(): Promise<string> {
    for (let i = 0; i < NICKNAME_ATTEMPTS; i += 1) {
      const candidate = generateNumberedName(NICKNAME_PREFIX);
      const taken = await this.prisma.user.findUnique({
        where: { nickname: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    throw new ConflictException(
      '새 닉네임을 만들지 못했습니다. 다시 시도해주세요.',
    );
  }

  private async findUserOrThrow(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('회원을 찾을 수 없습니다.');
    }
    return user;
  }

  private async toMemberDtos(users: User[]): Promise<AdminMemberDto[]> {
    if (users.length === 0) return [];
    const ids = users.map((u) => u.id);
    const weekStart = getKstWeekStart(new Date());
    const submitted = {
      userId: { in: ids },
      status: ResponseSessionStatus.SUBMITTED,
    };

    const [
      surveyGroups,
      responseGroups,
      warningTotals,
      warningWeeks,
      memberships,
      restrictions,
      ranking,
    ] = await Promise.all([
      this.prisma.survey.groupBy({
        by: ['creatorId'],
        where: { creatorId: { in: ids }, publishedAt: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.responseSession.groupBy({
        by: ['userId'],
        where: submitted,
        _count: { _all: true },
      }),
      this.prisma.responseSession.groupBy({
        by: ['userId'],
        where: { ...submitted, sameScaleWarningAcknowledged: true },
        _count: { _all: true },
      }),
      this.prisma.responseSession.groupBy({
        by: ['userId'],
        where: {
          ...submitted,
          sameScaleWarningAcknowledged: true,
          submittedAt: { gte: weekStart },
        },
        _count: { _all: true },
      }),
      this.prisma.teamMember.findMany({
        where: { userId: { in: ids }, team: { disbandedAt: null } },
        include: { team: { select: { name: true } } },
      }),
      this.prisma.userRestriction.findMany({
        where: { userId: { in: ids }, liftedAt: null },
        orderBy: { startedAt: 'desc' },
      }),
      this.rewards.getWeeklyRanking(weekStart),
    ]);

    const count = <K extends string>(
      groups: ({ _count: { _all: number } } & Record<K, string>)[],
      key: K,
    ) => new Map(groups.map((g) => [g[key], g._count._all]));
    const surveyCounts = count(surveyGroups, 'creatorId');
    const responseCounts = count(responseGroups, 'userId');
    const warningTotalCounts = count(warningTotals, 'userId');
    const warningWeekCounts = count(warningWeeks, 'userId');
    const rankById = new Map(ranking.map((r) => [r.userId, r]));
    const teamNamesById = new Map<string, string[]>();
    for (const m of memberships) {
      teamNamesById.set(m.userId, [
        ...(teamNamesById.get(m.userId) ?? []),
        m.team.name,
      ]);
    }
    const restrictionById = new Map<string, AdminRestrictionDto>();
    for (const r of restrictions) {
      if (restrictionById.has(r.userId)) continue;
      restrictionById.set(r.userId, {
        reason: r.reason,
        startedAt: r.startedAt.toISOString(),
        endsAt: r.endsAt?.toISOString() ?? null,
      });
    }

    return users.map((u) => {
      const ranked = rankById.get(u.id);
      return new AdminMemberDto({
        id: u.id,
        nickname: u.nickname,
        email: u.email,
        status: u.status,
        role: memberRole(u),
        createdAt: u.createdAt.toISOString(),
        gender: u.gender,
        grade: u.grade,
        majorField: u.majorField,
        enrollmentStatus: u.enrollmentStatus,
        surveyCount: surveyCounts.get(u.id) ?? 0,
        responseCount: responseCounts.get(u.id) ?? 0,
        warningTotal: warningTotalCounts.get(u.id) ?? 0,
        warningWeek: warningWeekCounts.get(u.id) ?? 0,
        weeklyCount: ranked?.points ?? 0,
        weeklyRank: ranked?.rank ?? null,
        teamNames: teamNamesById.get(u.id) ?? [],
        restriction:
          u.status === UserStatus.RESTRICTED
            ? (restrictionById.get(u.id) ?? null)
            : null,
      });
    });
  }
}
