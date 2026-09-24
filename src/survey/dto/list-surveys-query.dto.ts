import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SURVEY_LIST_MAX_LIMIT } from '../survey.constants';

export class ListSurveysQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SURVEY_LIST_MAX_LIMIT)
  limit?: number;
}
