import {
  EnrollmentStatus,
  Gender,
  GradeLevel,
  MajorField,
} from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { IsValidNickname } from '../../common/validators/nickname.validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsValidNickname()
  nickname?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsEnum(GradeLevel)
  grade?: GradeLevel;

  @IsOptional()
  @IsEnum(MajorField)
  majorField?: MajorField;

  @IsOptional()
  @IsEnum(EnrollmentStatus)
  enrollmentStatus?: EnrollmentStatus;
}
