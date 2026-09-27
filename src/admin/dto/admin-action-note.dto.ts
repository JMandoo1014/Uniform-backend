import { IsOptional, IsString, MaxLength } from 'class-validator';

// 관리자 콘솔의 확인 창에서 받는 사유 분류와 메모. 조치 기록에 그대로 남는다.
export class AdminActionNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  memo?: string;
}
