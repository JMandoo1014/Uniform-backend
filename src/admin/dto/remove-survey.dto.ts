import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { SURVEY_REMOVAL_REASON_CATEGORIES } from '../admin.constants';

// Spec 10.2: "사유 분류와 메모를 필수로 입력한다" — 둘 다 필수.
export class RemoveSurveyDto {
  @IsIn(SURVEY_REMOVAL_REASON_CATEGORIES)
  reasonCategory: string;

  @IsString()
  @IsNotEmpty({ message: '삭제 사유 메모를 입력해주세요.' })
  memo: string;
}
