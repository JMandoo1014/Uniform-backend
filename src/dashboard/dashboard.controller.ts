import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { DashboardService } from './dashboard.service';
import { WeeklyTrendQueryDto } from './dto/weekly-trend-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  getSummary(@CurrentUser() user: JwtPayload) {
    return this.dashboardService.getSummary(user.sub);
  }

  @Get('weekly-trend')
  getWeeklyTrend(
    @CurrentUser() user: JwtPayload,
    @Query() query: WeeklyTrendQueryDto,
  ) {
    return this.dashboardService.getWeeklyTrend(user.sub, query);
  }

  @Get('recent-activity')
  getRecentActivity(@CurrentUser() user: JwtPayload) {
    return this.dashboardService.getRecentActivity(user.sub);
  }
}
