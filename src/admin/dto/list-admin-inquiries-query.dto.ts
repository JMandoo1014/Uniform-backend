import { InquiryStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListAdminInquiriesQueryDto {
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;
}
