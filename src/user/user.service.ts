import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  SurveyOwnerType,
  SurveyStatus,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { BCRYPT_SALT_ROUNDS } from '../common/constants/password.constant';
import {
  AccountWithdrawnException,
  CurrentPasswordMismatchException,
  NicknameAlreadyExistsException,
  NoProfileChangesException,
} from '../common/exceptions/business.exception';
import { hashEmail } from '../common/utils/email-hash.util';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByNickname(nickname: string) {
    return this.prisma.user.findUnique({ where: { nickname } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByVerificationToken(token: string) {
    return this.prisma.user.findUnique({
      where: { emailVerificationToken: token },
    });
  }

  create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }

  // Reused by signup's initial send and POST /auth/resend-verification.
  async setEmailVerificationToken(
    userId: string,
    token: string,
    expiresAt: Date,
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerificationToken: token,
        emailVerificationTokenExpiresAt: expiresAt,
      },
    });
  }

  async setPasswordResetToken(userId: string, token: string, expiresAt: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetToken: token,
        passwordResetTokenExpiresAt: expiresAt,
      },
    });
  }

  async updateStatus(userId: string, status: UserStatus, reason?: string) {
    return this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { status },
      }),
      this.prisma.userStatusHistory.create({
        data: { userId, status, reason },
      }),
    ]);
  }

  async activateByVerificationToken(userId: string) {
    return this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: UserStatus.ACTIVE,
          emailVerificationToken: null,
          emailVerificationTokenExpiresAt: null,
        },
      }),
      this.prisma.userStatusHistory.create({
        data: {
          userId,
          status: UserStatus.ACTIVE,
          reason: '이메일 인증 완료',
        },
      }),
    ]);
  }

  // Spec 2.3: 닉네임/프로필은 언제든 변경 가능. 바뀐 닉네임도 중복 검사를 하며,
  // 변경 전후 값과 시각을 기록한다.
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const hasAnyField = Object.values(dto).some((value) => value !== undefined);
    if (!hasAnyField) {
      throw new NoProfileChangesException();
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    if (dto.nickname !== undefined && dto.nickname !== user.nickname) {
      const duplicate = await this.prisma.user.findFirst({
        where: {
          nickname: { equals: dto.nickname, mode: 'insensitive' },
          NOT: { id: userId },
        },
      });
      if (duplicate) {
        throw new NicknameAlreadyExistsException();
      }
    }

    const data: Prisma.UserUpdateInput = {};
    const historyEntries: Prisma.UserProfileHistoryCreateManyInput[] = [];

    const trackChange = (
      field: string,
      oldValue: string | null,
      newValue: string | null | undefined,
    ): boolean => {
      if (newValue === undefined || newValue === oldValue) {
        return false;
      }
      historyEntries.push({
        userId,
        field,
        oldValue: oldValue == null ? null : String(oldValue),
        newValue: newValue == null ? null : String(newValue),
      });
      return true;
    };

    if (trackChange('nickname', user.nickname, dto.nickname)) {
      data.nickname = dto.nickname;
    }
    if (trackChange('gender', user.gender, dto.gender)) {
      data.gender = dto.gender;
    }
    if (trackChange('grade', user.grade, dto.grade)) {
      data.grade = dto.grade;
    }
    if (trackChange('majorField', user.majorField, dto.majorField)) {
      data.majorField = dto.majorField;
    }
    if (
      trackChange(
        'enrollmentStatus',
        user.enrollmentStatus,
        dto.enrollmentStatus,
      )
    ) {
      data.enrollmentStatus = dto.enrollmentStatus;
    }

    if (Object.keys(data).length === 0) {
      // Submitted values are identical to the current profile; nothing to persist.
      return user;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data });
      await tx.userProfileHistory.createMany({ data: historyEntries });
      return updated;
    });
  }

  // Spec 2.4: 마이페이지에서 현재 비밀번호를 확인한 뒤 바꾼다.
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new CurrentPasswordMismatchException();
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  // Spec 8.1: 마케팅 수신 설정 변경 시각을 기록한다.
  async updateMarketingOptIn(userId: string, marketingOptIn: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { marketingOptIn, marketingOptInChangedAt: new Date() },
    });
  }

  async isEmailBlockedByRecentWithdrawal(email: string): Promise<boolean> {
    const record = await this.prisma.withdrawnEmail.findUnique({
      where: { emailHash: hashEmail(email) },
    });
    if (!record) {
      return false;
    }
    return Date.now() - record.withdrawnAt.getTime() < THIRTY_DAYS_MS;
  }

  // Spec 2.5 / 3.4: 탈퇴 처리 — 팀장이면 후임자에게 자동 위임하거나 해산,
  // 본인 명의 설문은 마감/삭제, 닉네임·프로필 삭제, 탈퇴 이메일 해시 보관.
  async withdraw(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    if (user.status === UserStatus.WITHDRAWN || !user.email) {
      throw new AccountWithdrawnException();
    }

    const emailHash = hashEmail(user.email);
    const now = new Date();
    const purgeAt = new Date(now.getTime() + THIRTY_DAYS_MS);

    await this.prisma.$transaction(async (tx) => {
      const ledTeams = await tx.team.findMany({
        where: { leaderId: userId, disbandedAt: null },
      });

      for (const team of ledTeams) {
        const nextLeader = await tx.teamMember.findFirst({
          where: { teamId: team.id, userId: { not: userId } },
          orderBy: { joinedAt: 'asc' },
        });

        if (nextLeader) {
          await tx.team.update({
            where: { id: team.id },
            data: { leaderId: nextLeader.userId },
          });
        } else {
          // No members left to inherit leadership: disband. The team's own
          // draft would normally move to the (now-withdrawing) leader's
          // personal drafts, which are deleted anyway, so it is deleted
          // directly. Recruiting surveys are left untouched and close on
          // their original deadline per the general disband rule (3.4).
          await tx.team.update({
            where: { id: team.id },
            data: { disbandedAt: now },
          });
          await tx.survey.deleteMany({
            where: {
              ownerType: SurveyOwnerType.TEAM,
              ownerId: team.id,
              status: SurveyStatus.DRAFT,
            },
          });
        }
      }

      await tx.teamMember.deleteMany({ where: { userId } });

      await tx.survey.updateMany({
        where: {
          ownerType: SurveyOwnerType.USER,
          ownerId: userId,
          status: SurveyStatus.RECRUITING,
        },
        data: {
          status: SurveyStatus.CLOSED,
          closedAt: now,
          purgeAt,
          version: { increment: 1 },
        },
      });

      await tx.survey.deleteMany({
        where: {
          ownerType: SurveyOwnerType.USER,
          ownerId: userId,
          status: SurveyStatus.DRAFT,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          status: UserStatus.WITHDRAWN,
          email: null,
          nickname: null,
          gender: null,
          grade: null,
          majorField: null,
          enrollmentStatus: null,
        },
      });

      await tx.userStatusHistory.create({
        data: { userId, status: UserStatus.WITHDRAWN, reason: '회원 탈퇴' },
      });

      await tx.withdrawnEmail.create({ data: { emailHash } });
    });
  }
}
