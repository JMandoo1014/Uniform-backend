import {
  EnrollmentStatus,
  Gender,
  GradeLevel,
  MajorField,
} from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional } from 'class-validator';
import { IsValidNickname } from '../../common/validators/nickname.validator';
import { IsValidPassword } from '../../common/validators/password.validator';
import { IsTermsVersion } from '../../common/validators/terms-version.validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsValidPassword()
  password: string;

  @IsValidNickname()
  nickname: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsEnum(GradeLevel)
  grade: GradeLevel;

  @IsEnum(MajorField)
  majorField: MajorField;

  @IsEnum(EnrollmentStatus)
  enrollmentStatus: EnrollmentStatus;

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;

  // 동의한 약관의 시행일. 서버의 현재 버전(TERMS_VERSION)과 달라도 가입은
  // 받는다 — 그 경우 GET /users/me의 needsTermsConsent가 true가 된다.
  @IsTermsVersion()
  agreedTermsVersion: string;
}
