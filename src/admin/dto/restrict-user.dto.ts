import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// Spec 10.3: 이용 제한·해제를 같은 엔드포인트에서 처리한다. lift=true면 해제
// 요청(reason은 해제 사유가 됨), 아니면 제한 요청(durationDays 없으면 무기한).
export class RestrictUserDto {
  @IsString()
  @IsNotEmpty({ message: '사유를 입력해주세요.' })
  @MaxLength(100)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  memo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;

  @IsOptional()
  @IsBoolean()
  lift?: boolean;
}
