import {
  Controller,
  Get,
  Header,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
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

  // Spec 7.3: 문항별 그래프 PNG.
  @Get('questions/:questionId/image')
  @Header('Content-Type', 'image/png')
  async getQuestionImage(
    @CurrentUser() user: JwtPayload,
    @Param('surveyId') surveyId: string,
    @Param('questionId') questionId: string,
  ): Promise<StreamableFile> {
    const png = await this.resultService.getQuestionImage(
      user.sub,
      surveyId,
      questionId,
    );
    return new StreamableFile(png);
  }

  // Spec 7.3: 전체 그래프 PNG를 ZIP으로 묶어 내려받기.
  @Get('export')
  @Header('Content-Type', 'application/zip')
  @Header('Content-Disposition', 'attachment; filename="result-charts.zip"')
  async getAllImages(
    @CurrentUser() user: JwtPayload,
    @Param('surveyId') surveyId: string,
  ): Promise<StreamableFile> {
    const zip = await this.resultService.getAllImagesZip(user.sub, surveyId);
    return new StreamableFile(zip);
  }
}
