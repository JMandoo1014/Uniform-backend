import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import {
  NicknameAlreadyExistsException,
  NoProfileChangesException,
} from '../common/exceptions/business.exception';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
}
