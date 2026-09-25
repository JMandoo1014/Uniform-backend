import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

// Spec 4.2: "사용자가 고른 것만 반영" — changeIds에 없는 제안은 무시한다.
export class ApplyFormMateChangesDto {
  @IsArray()
  @ArrayNotEmpty({ message: '적용할 changeIds를 입력해주세요.' })
  @IsString({ each: true })
  changeIds: string[];

  @IsOptional()
  @IsBoolean()
  revert?: boolean;
}
