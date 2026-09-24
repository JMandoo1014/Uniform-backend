import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { ResponseService } from './response.service';
import { SaveAnswersDto } from './dto/save-answers.dto';
import { SubmitResponseDto } from './dto/submit-response.dto';

@UseGuards(JwtAuthGuard)
@Controller('surveys/:surveyId/sessions')
export class ResponseController {
  constructor(private readonly responseService: ResponseService) {}

  @Post()
  start(@CurrentUser() user: JwtPayload, @Param('surveyId') surveyId: string) {
    return this.responseService.startOrResumeSession(user.sub, surveyId);
  }

  @Patch(':sessionId/answers')
  saveAnswers(
    @CurrentUser() user: JwtPayload,
    @Param('surveyId') surveyId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: SaveAnswersDto,
  ) {
    return this.responseService.saveAnswers(user.sub, surveyId, sessionId, dto);
  }

  @Post(':sessionId/submit')
  submit(
    @CurrentUser() user: JwtPayload,
    @Param('surveyId') surveyId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: SubmitResponseDto,
  ) {
    return this.responseService.submit(user.sub, surveyId, sessionId, dto);
  }
}
