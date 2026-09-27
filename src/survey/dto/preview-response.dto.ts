import { IsObject } from 'class-validator';

// Spec 4.1 "게시 전 확인": 실제 제출과 같은 검증만 거치고 집계·점수에는 반영하지 않는다.
export class PreviewResponseDto {
  @IsObject()
  answers: Record<string, unknown>;
}
