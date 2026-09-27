import { IsBoolean } from 'class-validator';

export class UpdateMarketingOptInDto {
  @IsBoolean()
  marketingOptIn: boolean;
}
