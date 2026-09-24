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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { SurveyService } from './survey.service';
import { CreateSurveyDraftDto } from './dto/create-survey-draft.dto';
import { UpdateSurveyDraftDto } from './dto/update-survey-draft.dto';

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
}
