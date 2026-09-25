import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

// Spec 4.2: "사용자가 고른 것만 반영" — changeIds에 없는 제안은 무시한다.
// updateDraft와 같은 낙관적 락(version) 패턴 — apply도 문항을 바꾸는 작업이라
// 동시 수정(다른 팀원의 apply나 PATCH updateDraft)과 충돌하면 lost update가
// 생길 수 있어 그대로 적용한다.
export class ApplyFormMateChangesDto {
  @IsArray()
  @ArrayNotEmpty({ message: '적용할 changeIds를 입력해주세요.' })
  @IsString({ each: true })
  changeIds: string[];

  @IsInt()
  version: number;

  @IsOptional()
  @IsBoolean()
  revert?: boolean;
}
