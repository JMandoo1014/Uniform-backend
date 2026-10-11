import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  SameAsCurrentPasswordException,
} from '../common/exceptions/business.exception';
import {
  DAY_MS,
  WITHDRAWN_EMAIL_BLOCK_DAYS,
} from '../common/constants/retention.constant';
import { hmacEmail, legacySha256Email } from '../common/utils/email-hash.util';
import { isValidTermsVersion } from '../common/validators/terms-version.validator';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

// Spec 7.4: 마감 시각으로부터 30일 뒤 응답 원문 파기.
const SURVEY_PURGE_AFTER_MS = 30 * DAY_MS;

// 비밀번호를 바꿀 때 함께 써야 하는 컬럼 묶음. passwordChangedAt보다 먼저(초
// 단위) 발급된 access·refresh 토큰은 JwtStrategy·AuthService.refresh에서
// 거부되므로, 비밀번호를 바꾸는 곳은 모두 이 함수로 같은 UPDATE에 넣는다.
export function passwordChangeData(
  passwordHash: string,
  changedAt: Date,
): Pick<Prisma.UserUpdateInput, 'passwordHash' | 'passwordChangedAt'> {
  return { passwordHash, passwordChangedAt: changedAt };
}

@Injectable()
export class UserService {
  // 둘 다 없으면 가입·탈퇴·약관 동의가 동작할 수 없으므로 부팅 시점에 바로
  // 실패시킨다.
  private readonly withdrawnEmailSecret: string;
  private readonly currentTermsVersion: string;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.withdrawnEmailSecret = configService.getOrThrow<string>(
      'WITHDRAWN_EMAIL_HMAC_SECRET',
    );
    const termsVersion = configService.getOrThrow<string>('TERMS_VERSION');
    if (!isValidTermsVersion(termsVersion)) {
      throw new Error(
        `TERMS_VERSION must be the current terms effective date in YYYY-MM-DD form (got "${termsVersion}")`,
      );
    }
    this.currentTermsVersion = termsVersion;
  }

  // Spec 2.1: 현재 시행 중인 약관 버전(시행일).
  getCurrentTermsVersion(): string {
    return this.currentTermsVersion;
  }

  hashWithdrawnEmail(email: string): string {
    return hmacEmail(email, this.withdrawnEmailSecret);
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByNickname(nickname: string) {
    return this.prisma.user.findUnique({ where: { nickname } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  // 토큰 검증용 — 매 인증 요청마다 불리므로 필요한 컬럼만 읽는다.
  findTokenCheckState(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { passwordChangedAt: true, status: true },
    });
  }

  // 이용 제한 안내 화면용 — 아직 해제되지 않은 가장 최근 제한.
  async findActiveRestriction(
    userId: string,
  ): Promise<{ reason: string; endsAt: string | null } | null> {
    const restriction = await this.prisma.userRestriction.findFirst({
      where: { userId, liftedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    return restriction
      ? {
          reason: restriction.reason,
          endsAt: restriction.endsAt?.toISOString() ?? null,
        }
      : null;
  }

  findByVerificationToken(token: string) {
    return this.prisma.user.findUnique({
      where: { emailVerificationToken: token },
    });
  }

  findByPasswordResetToken(token: string) {
    return this.prisma.user.findUnique({
      where: { passwordResetToken: token },
    });
  }

  create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }

  // Reused by signup's initial send, POST /auth/resend-verification, and
  // POST /auth/pending-email-change (which also swaps the email itself).
  async setEmailVerificationToken(
    userId: string,
    token: string,
    expiresAt: Date,
    newEmail?: string,
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(newEmail !== undefined ? { email: newEmail } : {}),
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

  // 재설정 토큰을 소모하면서 비밀번호를 바꾼다. 토큰·만료 조건을 WHERE에 넣은
  // UPDATE 한 문장이라 비밀번호 변경과 토큰 무효화가 함께 일어나고, 같은 토큰으로
  // 동시에 들어온 요청은 행 잠금 뒤 조건을 다시 보므로 하나만 count 1을 얻는다.
  // 재설정 토큰은 회원당 한 칸(passwordResetToken)이라 재요청하면 이전 토큰은
  // 덮어써져 이미 무효고, 여기서 비우면 그 회원에게 남는 재설정 토큰은 없다.
  async consumePasswordResetToken(
    userId: string,
    token: string,
    passwordHash: string,
    now: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: userId,
        passwordResetToken: token,
        passwordResetTokenExpiresAt: { gt: now },
      },
      data: {
        ...passwordChangeData(passwordHash, now),
        passwordResetToken: null,
        passwordResetTokenExpiresAt: null,
      },
    });
    return count === 1;
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
  // 마이페이지 비밀번호 변경. 현재 비밀번호 확인 → 같은 비밀번호 거부 → 새 해시와
  // passwordChangedAt을 한 UPDATE로 기록한다. 이 시각보다 먼저 발급된 토큰(다른
  // 기기 포함)은 401이 되므로, 호출한 쪽(UserController)이 이 뒤에 새 토큰을
  // 발급해 요청한 기기의 로그인을 유지한다.
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    const matches =
      user.passwordHash !== null &&
      (await bcrypt.compare(currentPassword, user.passwordHash));
    if (!matches) {
      throw new CurrentPasswordMismatchException();
    }
    if (await bcrypt.compare(newPassword, user.passwordHash!)) {
      throw new SameAsCurrentPasswordException();
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    return this.prisma.user.update({
      where: { id: userId },
      data: passwordChangeData(passwordHash, new Date()),
    });
  }

  // Spec 8.1: 마케팅 수신 설정 변경 시각을 기록한다.
  async updateMarketingOptIn(userId: string, marketingOptIn: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { marketingOptIn, marketingOptInChangedAt: new Date() },
    });
  }

  // Spec 2.1: 약관이 바뀐 뒤 다시 동의받는다. 어떤 버전에 동의했는지는
  // 클라이언트가 보낸 값이 아니라 서버의 현재 버전으로 기록한다.
  async agreeToCurrentTerms(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    if (user.status === UserStatus.WITHDRAWN) {
      throw new AccountWithdrawnException();
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        agreedTermsVersion: this.currentTermsVersion,
        termsAgreedAt: new Date(),
      },
    });
  }

  // HMAC 도입 전 행(솔트 없는 SHA-256)도 함께 대조한다 — 그 행들은 탈퇴 30일
  // 뒤 정리 배치가 지우므로, 그 이후엔 HMAC 행만 남는다.
  async isEmailBlockedByRecentWithdrawal(email: string): Promise<boolean> {
    const record = await this.prisma.withdrawnEmail.findFirst({
      where: {
        emailHash: {
          in: [this.hashWithdrawnEmail(email), legacySha256Email(email)],
        },
        withdrawnAt: {
          gt: new Date(Date.now() - WITHDRAWN_EMAIL_BLOCK_DAYS * DAY_MS),
        },
      },
    });
    return record !== null;
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

    const emailHash = this.hashWithdrawnEmail(user.email);
    const now = new Date();
    const purgeAt = new Date(now.getTime() + SURVEY_PURGE_AFTER_MS);

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

      // 응답·리더보드·설문은 회원 id로 남기고, 계정을 다시 쓸 수 있게 하거나
      // 사람을 알아볼 수 있는 값만 지운다.
      await tx.user.update({
        where: { id: userId },
        data: {
          status: UserStatus.WITHDRAWN,
          email: null,
          passwordHash: null,
          nickname: null,
          gender: null,
          grade: null,
          majorField: null,
          enrollmentStatus: null,
          emailVerificationToken: null,
          emailVerificationTokenExpiresAt: null,
          passwordResetToken: null,
          passwordResetTokenExpiresAt: null,
        },
      });

      // 변경 전후 닉네임·프로필 원문이 남아 있으므로 함께 지운다.
      await tx.userProfileHistory.deleteMany({ where: { userId } });

      // TODO: refresh 토큰 서버 저장·폐기 작업이 들어오면 여기서 이 회원의
      // RefreshToken을 전부 revoke한다. 지금은 stateless라 저장된 토큰이 없고,
      // AuthService.refresh가 ACTIVE가 아닌 계정을 거부하는 것으로 막는다.

      await tx.userStatusHistory.create({
        data: { userId, status: UserStatus.WITHDRAWN, reason: '회원 탈퇴' },
      });

      // 30일 뒤 같은 이메일로 재가입했다가 다시 탈퇴하면 이전 해시 행이 남아
      // 있으므로 create는 unique 충돌이 난다 — 탈퇴 시각만 갱신한다.
      await tx.withdrawnEmail.upsert({
        where: { emailHash },
        create: { emailHash, withdrawnAt: now },
        update: { withdrawnAt: now },
      });
    });
  }
}
