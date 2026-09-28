import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { LeaderboardRewardsConfigDto } from '../leaderboard/dto/leaderboard-response.dto';
import { AdminGuard } from './guards/admin.guard';
import { AdminAuditService } from './admin-audit.service';
import { AdminInquiriesService } from './admin-inquiries.service';
import { AdminMembersService } from './admin-members.service';
import { AdminRewardsService } from './admin-rewards.service';
import { AdminSummaryService } from './admin-summary.service';
import { AdminSurveysService } from './admin-surveys.service';
import { AdminTeamsService } from './admin-teams.service';
import { AdminActionNoteDto } from './dto/admin-action-note.dto';
import { ExcludeSubmissionDto } from './dto/exclude-submission.dto';
import { ListAdminSurveysQueryDto } from './dto/list-admin-surveys-query.dto';
import { ListAdminUsersQueryDto } from './dto/list-admin-users-query.dto';
import { ListMemberResponsesQueryDto } from './dto/list-member-responses-query.dto';
import { MarkRewardSentDto } from './dto/mark-reward-sent.dto';
import { NicknameForceChangeDto } from './dto/nickname-force-change.dto';
import { RemoveSurveyDto } from './dto/remove-survey.dto';
import { RenameTeamDto } from './dto/rename-team.dto';
import { RestrictUserDto } from './dto/restrict-user.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AdminLogDto } from './dto/admin-log.dto';
import {
  AdminMemberDto,
  AdminNicknameChangedDto,
  AdminStaffChangedDto,
} from './dto/admin-member.dto';
import { AdminResponseDto } from './dto/admin-response.dto';
import {
  AdminRewardWeekDetailDto,
  AdminRewardWeekDto,
  AdminWeeklyLeaderboardDto,
} from './dto/admin-reward.dto';
import { AdminSummaryDto } from './dto/admin-summary.dto';
import {
  AdminSurveyDetailDto,
  AdminSurveyDto,
  AdminSurveyRestoredDto,
} from './dto/admin-survey.dto';
import { AdminTeamDto, AdminTeamRenamedDto } from './dto/admin-team.dto';
import { AdminInquiryDto } from './dto/admin-inquiry.dto';
import { ListAdminInquiriesQueryDto } from './dto/list-admin-inquiries-query.dto';
import { UpdateInquiryStatusDto } from './dto/update-inquiry-status.dto';

type Success = { success: boolean };

// Spec 10.1: 관리자 권한이 없으면 모든 요청을 거부한다.
@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly summary: AdminSummaryService,
    private readonly members: AdminMembersService,
    private readonly surveys: AdminSurveysService,
    private readonly teams: AdminTeamsService,
    private readonly rewards: AdminRewardsService,
    private readonly audit: AdminAuditService,
    private readonly inquiries: AdminInquiriesService,
  ) {}

  @Get('summary')
  getSummary(): Promise<AdminSummaryDto> {
    return this.summary.getSummary();
  }

  // ---- 회원 ----
  @Get('users')
  listUsers(@Query() query: ListAdminUsersQueryDto): Promise<AdminMemberDto[]> {
    return this.members.listMembers(query);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string): Promise<AdminMemberDto> {
    return this.members.getMember(id);
  }

  @Get('users/:id/responses')
  listUserResponses(
    @Param('id') id: string,
    @Query() query: ListMemberResponsesQueryDto,
  ): Promise<AdminResponseDto[]> {
    return this.members.listMemberResponses(id, query.week);
  }

  @Post('users/:id/restrict')
  restrictUser(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RestrictUserDto,
  ): Promise<Success> {
    return this.members.restrict(admin.sub, id, dto);
  }

  @Post('users/:id/nickname-force-change')
  forceChangeNickname(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: NicknameForceChangeDto,
  ): Promise<AdminNicknameChangedDto> {
    return this.members.forceChangeNickname(admin.sub, id, dto);
  }

  @Post('users/:id/staff')
  toggleStaff(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AdminActionNoteDto,
  ): Promise<AdminStaffChangedDto> {
    return this.members.toggleStaff(admin.sub, id, dto);
  }

  // ---- 설문·응답 ----
  @Get('surveys')
  listSurveys(
    @Query() query: ListAdminSurveysQueryDto,
  ): Promise<AdminSurveyDto[]> {
    return this.surveys.listSurveys(query);
  }

  @Get('surveys/:id')
  getSurvey(@Param('id') id: string): Promise<AdminSurveyDetailDto> {
    return this.surveys.getSurvey(id);
  }

  @Get('surveys/:id/responses')
  listSurveyResponses(@Param('id') id: string): Promise<AdminResponseDto[]> {
    return this.surveys.listSurveyResponses(id);
  }

  @Post('surveys/:id/remove')
  removeSurvey(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RemoveSurveyDto,
  ): Promise<Success> {
    return this.surveys.removeSurvey(admin.sub, id, dto);
  }

  @Post('surveys/:id/restore')
  restoreSurvey(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AdminActionNoteDto,
  ): Promise<AdminSurveyRestoredDto> {
    return this.surveys.restoreSurvey(admin.sub, id, dto);
  }

  @Post('submissions/:id/exclude')
  excludeSubmission(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ExcludeSubmissionDto,
  ): Promise<Success> {
    return this.surveys.excludeSubmission(admin.sub, id, dto);
  }

  @Post('submissions/:id/view')
  recordResponseView(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
  ): Promise<Success> {
    return this.surveys.recordResponseView(admin.sub, id);
  }

  // ---- 팀 ----
  @Get('teams')
  listTeams(): Promise<AdminTeamDto[]> {
    return this.teams.listTeams();
  }

  @Get('teams/:id')
  getTeam(@Param('id') id: string): Promise<AdminTeamDto> {
    return this.teams.getTeam(id);
  }

  @Post('teams/:id/rename')
  renameTeam(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RenameTeamDto,
  ): Promise<AdminTeamRenamedDto> {
    return this.teams.renameTeam(admin.sub, id, dto);
  }

  // ---- 리더보드·보상 ----
  @Get('leaderboard/weeks/:week')
  getWeeklyLeaderboard(
    @Param('week') week: string,
  ): Promise<AdminWeeklyLeaderboardDto> {
    return this.rewards.getWeeklyLeaderboard(week);
  }

  @Patch('leaderboard/announcement')
  updateAnnouncement(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: UpdateAnnouncementDto,
  ): Promise<LeaderboardRewardsConfigDto> {
    return this.rewards.updateNotice(admin.sub, dto);
  }

  @Get('rewards')
  listRewardWeeks(): Promise<AdminRewardWeekDto[]> {
    return this.rewards.listRewardWeeks();
  }

  @Get('rewards/:week')
  getRewardWeek(
    @Param('week') week: string,
  ): Promise<AdminRewardWeekDetailDto> {
    return this.rewards.getRewardWeek(week);
  }

  @Post('rewards/:week/advance')
  advanceRewardWeek(
    @CurrentUser() admin: JwtPayload,
    @Param('week') week: string,
    @Body() dto: AdminActionNoteDto,
  ): Promise<AdminRewardWeekDetailDto> {
    return this.rewards.advance(admin.sub, week, dto);
  }

  @Post('rewards/:week/ranks/:rank/sent')
  markRewardSent(
    @CurrentUser() admin: JwtPayload,
    @Param('week') week: string,
    @Param('rank', ParseIntPipe) rank: number,
    @Body() dto: MarkRewardSentDto,
  ): Promise<AdminRewardWeekDetailDto> {
    return this.rewards.markSent(admin.sub, week, rank, dto);
  }

  // ---- 조치 기록 ----
  @Get('logs')
  listLogs(): Promise<AdminLogDto[]> {
    return this.audit.list();
  }

  // ---- 문의 ----
  @Get('inquiries')
  listInquiries(
    @Query() query: ListAdminInquiriesQueryDto,
  ): Promise<AdminInquiryDto[]> {
    return this.inquiries.listInquiries(query);
  }

  @Get('inquiries/:id')
  getInquiry(@Param('id') id: string): Promise<AdminInquiryDto> {
    return this.inquiries.getInquiry(id);
  }

  @Patch('inquiries/:id/status')
  updateInquiryStatus(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateInquiryStatusDto,
  ): Promise<AdminInquiryDto> {
    return this.inquiries.updateStatus(admin.sub, id, dto);
  }
}
