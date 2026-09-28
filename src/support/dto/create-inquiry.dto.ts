import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Spec 9 확장: 로그인 사용자는 email을 서버가 계정 이메일로 덮어쓴다 —
// 비로그인 사용자만 이 값이 실제로 쓰인다(support.service.ts 참고).
export class CreateInquiryDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @IsNotEmpty({ message: '제목을 입력해주세요.' })
  @MaxLength(200)
  subject: string;

  @IsString()
  @IsNotEmpty({ message: '내용을 입력해주세요.' })
  @MaxLength(2000)
  message: string;
}
