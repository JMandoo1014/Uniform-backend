// Spec 8.5: 참여 추이 차트의 막대 하나. bucketLabel은 그 구간이 시작하는
// KST 날짜("YYYY-MM-DD")다.
export class TrendBucketDto {
  bucketLabel: string;
  value: number;

  constructor(bucketLabel: string, value: number) {
    this.bucketLabel = bucketLabel;
    this.value = value;
  }
}
