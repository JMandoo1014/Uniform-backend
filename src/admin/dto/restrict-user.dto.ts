import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

// Spec 10.3: 이용 제한·해제를 같은 엔드포인트에서 처리한다. lift=true면 해제
// 요청(reason은 해제 사유가 됨), 아니면 제한 요청(durationDays 없으면 기간 미정).
export class RestrictUserDto {
  @IsString()
  reason: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsOptional()
  @IsBoolean()
  lift?: boolean;
}
