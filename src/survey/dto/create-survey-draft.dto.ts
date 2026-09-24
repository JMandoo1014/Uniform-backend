import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

// Spec 4.1: 새 초안은 제목·설명만으로 우선 만들고, 나머지는 이어서 채운다.
// Spec 3.2: 작성 공간으로 "내 설문" 또는 소속 팀을 고른다(ownerType 생략 시 개인).
export class CreateSurveyDraftDto {
  @IsOptional()
  @IsIn(['user', 'team'])
  ownerType?: 'user' | 'team';

  @ValidateIf((dto: CreateSurveyDraftDto) => dto.ownerType === 'team')
  @IsString()
  @IsNotEmpty({ message: '팀 초안은 teamId가 필요합니다.' })
  teamId?: string;

  @IsString()
  @IsNotEmpty({ message: '제목을 입력해주세요.' })
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}
