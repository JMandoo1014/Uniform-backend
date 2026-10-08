import { User } from '@prisma/client';

// 이용 제한 중(status RESTRICTED)인 회원의 현재 제한 — 이용 제한 안내 화면용.
export class UserRestrictionInfoDto {
  reason: string;
  endsAt: string | null;
}

export class UserResponseDto {
  id: string;
  email: User['email'];
  nickname: User['nickname'];
  gender: User['gender'];
  grade: User['grade'];
  majorField: User['majorField'];
  enrollmentStatus: User['enrollmentStatus'];
  marketingOptIn: boolean;
  marketingOptInChangedAt: User['marketingOptInChangedAt'];
  status: User['status'];
  agreedTermsVersion: User['agreedTermsVersion'];
  termsAgreedAt: Date;
  // Spec 2.1: 서버의 현재 약관 버전과, 그 버전에 아직 동의하지 않았는지.
  // true면 프론트가 재동의 화면을 띄우고 POST /users/me/terms-consent를 호출한다.
  currentTermsVersion: string;
  needsTermsConsent: boolean;
  createdAt: Date;
  // 관리자 콘솔 진입(관리자)·운영팀 표시용.
  isAdmin: boolean;
  isStaff: boolean;
  restriction: UserRestrictionInfoDto | null;

  constructor(
    user: User,
    currentTermsVersion: string,
    restriction: UserRestrictionInfoDto | null = null,
  ) {
    this.id = user.id;
    this.email = user.email;
    this.nickname = user.nickname;
    this.gender = user.gender;
    this.grade = user.grade;
    this.majorField = user.majorField;
    this.enrollmentStatus = user.enrollmentStatus;
    this.marketingOptIn = user.marketingOptIn;
    this.marketingOptInChangedAt = user.marketingOptInChangedAt;
    this.status = user.status;
    this.agreedTermsVersion = user.agreedTermsVersion;
    this.termsAgreedAt = user.termsAgreedAt;
    this.currentTermsVersion = currentTermsVersion;
    this.needsTermsConsent = user.agreedTermsVersion !== currentTermsVersion;
    this.createdAt = user.createdAt;
    this.isAdmin = user.isAdmin;
    this.isStaff = user.isStaff;
    this.restriction = restriction;
  }
}
