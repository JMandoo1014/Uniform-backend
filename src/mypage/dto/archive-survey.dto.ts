import { IsBoolean } from 'class-validator';

// Spec 8.3: 마감/보관 상태에서 "보관" 또는 "보관 해제" 토글.
export class ArchiveSurveyDto {
  @IsBoolean()
  archived: boolean;
}
