import { IsNotEmpty, IsString } from 'class-validator';

// Spec 10.2/10.4: 부정 응답 제외 + 점수 차감 사유.
export class ExcludeSubmissionDto {
  @IsString()
  @IsNotEmpty({ message: '제외 사유를 입력해주세요.' })
  reason: string;
}
