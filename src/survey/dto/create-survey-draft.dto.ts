import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Spec 4.1: 새 초안은 제목·설명만으로 우선 만들고, 나머지는 이어서 채운다.
export class CreateSurveyDraftDto {
  @IsString()
  @IsNotEmpty({ message: '제목을 입력해주세요.' })
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}
