import { Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
}
