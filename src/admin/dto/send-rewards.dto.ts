import { IsNotEmpty, IsString } from 'class-validator';

// Spec 10.4: 보상 상품은 추후 확정이라 관리자가 직접 입력한다.
export class SendRewardsDto {
  @IsString()
  @IsNotEmpty()
  couponType: string;
}
