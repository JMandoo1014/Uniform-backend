import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { LEADERBOARD_MAX_PAGES } from '../leaderboard.constants';

export class ListLeaderboardQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LEADERBOARD_MAX_PAGES)
  page?: number;
}
