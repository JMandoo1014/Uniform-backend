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

// Spec 10.1: 관리자 권한이 없으면 모든 요청을 거부한다.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers(@Query() query: ListAdminUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Post('users/:id/restrict')
  restrictUser(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RestrictUserDto,
  ) {
    return this.adminService.restrictUser(admin.sub, id, dto);
  }

  @Post('users/:id/nickname-force-change')
  forceChangeNickname(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: NicknameForceChangeDto,
  ) {
    return this.adminService.forceChangeNickname(admin.sub, id, dto);
  }

  @Get('surveys')
  listSurveys(@Query() query: ListAdminSurveysQueryDto) {
    return this.adminService.listSurveys(query);
  }

  @Get('surveys/:id')
  getSurveyDetail(@Param('id') id: string) {
    return this.adminService.getSurveyDetail(id);
  }

  @Post('surveys/:id/remove')
  removeSurvey(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RemoveSurveyDto,
  ) {
    return this.adminService.removeSurvey(admin.sub, id, dto);
  }

  @Post('surveys/:id/restore')
  restoreSurvey(@CurrentUser() admin: JwtPayload, @Param('id') id: string) {
    return this.adminService.restoreSurvey(admin.sub, id);
  }

  @Post('submissions/:id/exclude')
  excludeSubmission(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ExcludeSubmissionDto,
  ) {
    return this.adminService.excludeSubmission(admin.sub, id, dto);
  }

  @Get('leaderboard/weeks/:weekStart')
  getWeeklyLeaderboard(@Param('weekStart') weekStart: string) {
    return this.adminService.getWeeklyLeaderboard(weekStart);
  }

  @Post('leaderboard/lottery')
  runLottery(@CurrentUser() admin: JwtPayload, @Body() dto: RunLotteryDto) {
    return this.adminService.runLottery(admin.sub, dto);
  }

  @Post('leaderboard/rewards/:week/send')
  sendRewards(
    @CurrentUser() admin: JwtPayload,
    @Param('week') week: string,
    @Body() dto: SendRewardsDto,
  ) {
    return this.adminService.sendRewards(admin.sub, week, dto);
  }

  @Patch('leaderboard/announcement')
  updateAnnouncement(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.adminService.updateAnnouncement(admin.sub, dto);
  }
}
