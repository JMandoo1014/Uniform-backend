import { IsBoolean, IsOptional, IsString } from 'class-validator';

// Spec 4.1: 임시저장은 미완성 상태도 허용하므로, 4.3의 글자 수·개수 규칙은
// 여기서 강제하지 않고 게시(publish) 시점에만 검사한다.
export class UpdateSurveyOptionDto {
  @IsString()
  label: string;

  // Spec 4.3 / SurveyOption.isEtc: 단일선택 보기 중 "기타(직접 입력)" 표시.
  @IsOptional()
  @IsBoolean()
  isEtc?: boolean;
}
