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
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: '비밀번호는 영문과 숫자를 모두 포함해야 합니다.',
  })
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(20)
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
