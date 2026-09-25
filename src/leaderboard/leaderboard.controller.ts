import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { LeaderboardService } from './leaderboard.service';
import { ListLeaderboardQueryDto } from './dto/list-leaderboard-query.dto';
import {
  LeaderboardResponseDto,
  LastWeekLeaderboardResponseDto,
  LeaderboardRewardsConfigDto,
} from './dto/leaderboard-response.dto';

@ApiTags('Leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  // 개인화 정보(myRank)가 필요해 로그인 필수.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  getCurrentWeek(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListLeaderboardQueryDto,
  ): Promise<LeaderboardResponseDto> {
    return this.leaderboardService.getCurrentWeek(user.sub, query.page);
  }

  // 랜딩 미리보기(6.4)에서도 쓰여 로그인 없이 공개.
  @Get('last-week')
  getLastWeek(): Promise<LastWeekLeaderboardResponseDto> {
    return this.leaderboardService.getLastWeek();
  }

  @Get('rewards/config')
  getRewardsConfig(): Promise<LeaderboardRewardsConfigDto> {
    return this.leaderboardService.getRewardsConfig();
  }
}
