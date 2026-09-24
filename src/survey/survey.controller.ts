import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { SurveyService } from './survey.service';
import { CreateSurveyDraftDto } from './dto/create-survey-draft.dto';
import { UpdateSurveyDraftDto } from './dto/update-survey-draft.dto';
import { ListSurveysQueryDto } from './dto/list-surveys-query.dto';
import { MoveToTeamDto } from './dto/move-to-team.dto';
import { CopySurveyDto } from './dto/copy-survey.dto';

@UseGuards(JwtAuthGuard)
@Controller('surveys')
export class SurveyController {
  constructor(private readonly surveyService: SurveyService) {}

  @Post('drafts')
  createDraft(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSurveyDraftDto,
  ) {
    return this.surveyService.createDraft(user.sub, dto);
  }

  @Get('drafts/:id')
  getDraft(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.surveyService.getDraft(user.sub, id);
  }

  @Patch('drafts/:id')
  updateDraft(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSurveyDraftDto,
  ) {
    return this.surveyService.updateDraft(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('drafts/:id/publish')
  publish(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.surveyService.publish(user.sub, id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('drafts/:id')
  async deleteDraft(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.surveyService.deleteDraft(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('drafts/:id/move-to-team')
  moveToTeam(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: MoveToTeamDto,
  ) {
    return this.surveyService.moveToTeam(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/copy')
  copySurvey(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CopySurveyDto,
  ) {
    return this.surveyService.copySurvey(user.sub, id, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ListSurveysQueryDto) {
    return this.surveyService.listRecruiting(user.sub, query);
  }

  @Get(':id')
  getDetail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.surveyService.getDetail(user.sub, id);
  }
}
