import {
  EnrollmentStatus,
  Gender,
  GradeLevel,
  MajorField,
} from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { IsValidNickname } from '../../common/validators/nickname.validator';
import { IsValidPassword } from '../../common/validators/password.validator';

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

  @IsString()
  agreedTermsVersion: string;
}
