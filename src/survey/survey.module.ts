import { Module } from '@nestjs/common';
import { TeamModule } from '../team/team.module';
import { SurveyController } from './survey.controller';
import { SurveyService } from './survey.service';
import { FormMateService } from './formmate/formmate.service';
import { FormMateGeminiService } from './formmate/formmate-gemini.service';

@Module({
  imports: [TeamModule],
  controllers: [SurveyController],
  providers: [SurveyService, FormMateService, FormMateGeminiService],
  exports: [SurveyService],
})
export class SurveyModule {}
