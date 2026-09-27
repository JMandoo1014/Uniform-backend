import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class SubmitResponseDto {
  @IsObject()
  answers: Record<string, unknown>;

  // API 계약 호환을 위해 받기는 하지만, 서버는 이 값을 신뢰하지 않고 최종
  // answers에서 직접 다시 계산한다(5.4/10.4 — 관리자가 보는 값이 클라이언트
  // 조작에 영향받지 않도록). ResponseService.submit 참고.
  @IsOptional()
  @IsBoolean()
  sameScaleWarningAcknowledged?: boolean;
}
