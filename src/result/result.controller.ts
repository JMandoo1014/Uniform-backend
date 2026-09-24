import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { ResultService } from './result.service';

@UseGuards(JwtAuthGuard)
@Controller('surveys/:surveyId/result')
export class ResultController {
  constructor(private readonly resultService: ResultService) {}

  @Get()
  getResult(
    @CurrentUser() user: JwtPayload,
    @Param('surveyId') surveyId: string,
  ) {
    return this.resultService.getResult(user.sub, surveyId);
  }
}
