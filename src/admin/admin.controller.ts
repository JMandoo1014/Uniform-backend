import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, SurveyStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { AdminGuard } from './guards/admin.guard';
import { AdminService } from './admin.service';
import { ListAdminUsersQueryDto } from './dto/list-admin-users-query.dto';
import { RestrictUserDto } from './dto/restrict-user.dto';
import { NicknameForceChangeDto } from './dto/nickname-force-change.dto';
import { ListAdminSurveysQueryDto } from './dto/list-admin-surveys-query.dto';
import { RemoveSurveyDto } from './dto/remove-survey.dto';
import { ExcludeSubmissionDto } from './dto/exclude-submission.dto';
import { RunLotteryDto } from './dto/run-lottery.dto';
import { SendRewardsDto } from './dto/send-rewards.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AdminUserListItemDto } from './dto/admin-user-list-item.dto';
import { AdminSurveyListItemDto } from './dto/admin-survey-list-item.dto';
import { AdminSurveyDetailDto } from './dto/admin-survey-detail.dto';
import { AdminWeeklyLeaderboardResponseDto } from './dto/admin-weekly-leaderboard-response.dto';

// Spec 10.1: 관리자 권한이 없으면 모든 요청을 거부한다.
@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers(
    @Query() query: ListAdminUsersQueryDto,
  ): Promise<AdminUserListItemDto[]> {
    return this.adminService.listUsers(query);
  }

  @Post('users/:id/restrict')
  restrictUser(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RestrictUserDto,
  ): Promise<{ success: boolean }> {
    return this.adminService.restrictUser(admin.sub, id, dto);
  }

  @Post('users/:id/nickname-force-change')
  forceChangeNickname(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: NicknameForceChangeDto,
  ): Promise<{ success: boolean }> {
    return this.adminService.forceChangeNickname(admin.sub, id, dto);
  }

  @Get('surveys')
  listSurveys(
    @Query() query: ListAdminSurveysQueryDto,
  ): Promise<AdminSurveyListItemDto[]> {
    return this.adminService.listSurveys(query);
  }

  @Get('surveys/:id')
  getSurveyDetail(@Param('id') id: string): Promise<AdminSurveyDetailDto> {
    return this.adminService.getSurveyDetail(id);
  }

  @Post('surveys/:id/remove')
  removeSurvey(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RemoveSurveyDto,
  ): Promise<{ success: boolean }> {
    return this.adminService.removeSurvey(admin.sub, id, dto);
  }

  @Post('surveys/:id/restore')
  restoreSurvey(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ restoredStatus: SurveyStatus }> {
    return this.adminService.restoreSurvey(admin.sub, id);
  }

  @Post('submissions/:id/exclude')
  excludeSubmission(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ExcludeSubmissionDto,
  ): Promise<{ success: boolean }> {
    return this.adminService.excludeSubmission(admin.sub, id, dto);
  }

  @Get('leaderboard/weeks/:weekStart')
  getWeeklyLeaderboard(
    @Param('weekStart') weekStart: string,
  ): Promise<AdminWeeklyLeaderboardResponseDto> {
    return this.adminService.getWeeklyLeaderboard(weekStart);
  }

  @Post('leaderboard/lottery')
  runLottery(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: RunLotteryDto,
  ): Promise<{ result: Prisma.JsonValue; executedAt: Date }> {
    return this.adminService.runLottery(admin.sub, dto);
  }

  @Post('leaderboard/rewards/:week/send')
  sendRewards(
    @CurrentUser() admin: JwtPayload,
    @Param('week') week: string,
    @Body() dto: SendRewardsDto,
  ): Promise<{ success: boolean }> {
    return this.adminService.sendRewards(admin.sub, week, dto);
  }

  @Patch('leaderboard/announcement')
  updateAnnouncement(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: UpdateAnnouncementDto,
  ): Promise<{ success: boolean }> {
    return this.adminService.updateAnnouncement(admin.sub, dto);
  }
}
