import { Controller } from '@nestjs/common';
import { SurveyService } from './survey.service';

@Controller('surveys')
export class SurveyController {
  constructor(private readonly surveyService: SurveyService) {}
}
