import { IsIn, IsNotEmpty, IsString, ValidateIf } from 'class-validator';

// Spec 4.1: 본인 설문 또는 소속 팀 설문을 복사해 같은/다른 작성 공간에 새 초안을 만든다.
export class CopySurveyDto {
  @IsIn(['user', 'team'])
  targetOwnerType: 'user' | 'team';

  @ValidateIf((dto: CopySurveyDto) => dto.targetOwnerType === 'team')
  @IsString()
  @IsNotEmpty({ message: '팀으로 복사하려면 teamId가 필요합니다.' })
  teamId?: string;
}
