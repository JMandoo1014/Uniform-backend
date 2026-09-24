// Spec 8.2: 받은 보상 내역(주차, 순위, 발송일).
export class MyCouponDto {
  weekStart: string;
  rank: number;
  couponType: string;
  sentAt: string;

  constructor(init: MyCouponDto) {
    Object.assign(this, init);
  }
}
