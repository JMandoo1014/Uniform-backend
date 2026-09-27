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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { SurveyService } from './survey.service';
import { CreateSurveyDraftDto } from './dto/create-survey-draft.dto';
import { UpdateSurveyDraftDto } from './dto/update-survey-draft.dto';
import { ListSurveysQueryDto } from './dto/list-surveys-query.dto';
import { MoveToTeamDto } from './dto/move-to-team.dto';
import { CopySurveyDto } from './dto/copy-survey.dto';
import { PreviewResponseDto } from './dto/preview-response.dto';
import { SurveyResponseDto } from './dto/survey-response.dto';
import { SurveyListItemResponseDto } from './dto/survey-list-item-response.dto';
import { SurveyDetailResponseDto } from './dto/survey-detail-response.dto';
import { FormMateService } from './formmate/formmate.service';
import { SendFormMateMessageDto } from './formmate/dto/send-formmate-message.dto';
import { ApplyFormMateChangesDto } from './formmate/dto/apply-formmate-changes.dto';
import { SendFormMateMessageResponseDto } from './formmate/dto/send-formmate-message-response.dto';

@ApiTags('Survey')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('surveys')
export class SurveyController {
  constructor(
    private readonly surveyService: SurveyService,
    private readonly formMateService: FormMateService,
  ) {}

  @Post('drafts')
  createDraft(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSurveyDraftDto,
  ): Promise<SurveyResponseDto> {
    return this.surveyService.createDraft(user.sub, dto);
  }

  @Get('drafts/:id')
  getDraft(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<SurveyResponseDto> {
    return this.surveyService.getDraft(user.sub, id);
  }

  @Patch('drafts/:id')
  updateDraft(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSurveyDraftDto,
  ): Promise<SurveyResponseDto> {
    return this.surveyService.updateDraft(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('drafts/:id/publish')
  publish(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<SurveyResponseDto> {
    return this.surveyService.publish(user.sub, id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('drafts/:id')
  async deleteDraft(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.surveyService.deleteDraft(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('drafts/:id/move-to-team')
  moveToTeam(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: MoveToTeamDto,
  ): Promise<{ success: true }> {
    return this.surveyService.moveToTeam(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/copy')
  copySurvey(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CopySurveyDto,
  ): Promise<{ newSurveyId: string }> {
    return this.surveyService.copySurvey(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('drafts/:id/preview-response')
  previewResponse(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PreviewResponseDto,
  ): Promise<{ valid: boolean; errors: string[] }> {
    return this.surveyService.previewResponse(user.sub, id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListSurveysQueryDto,
  ): Promise<{
    items: SurveyListItemResponseDto[];
    nextCursor: string | null;
  }> {
    return this.surveyService.listRecruiting(user.sub, query);
  }

  @Get(':id')
  getDetail(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<SurveyDetailResponseDto> {
    return this.surveyService.getDetail(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('drafts/:id/formmate/message')
  sendFormMateMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendFormMateMessageDto,
  ): Promise<SendFormMateMessageResponseDto> {
    return this.formMateService.sendMessage(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('drafts/:id/formmate/apply')
  applyFormMateChanges(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ApplyFormMateChangesDto,
  ): Promise<{ newVersion: number }> {
    return this.formMateService.applyChanges(user.sub, id, dto);
  }
}
