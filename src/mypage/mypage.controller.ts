import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { MypageService } from './mypage.service';
import { ListMySurveysQueryDto } from './dto/list-my-surveys-query.dto';
import { ArchiveSurveyDto } from './dto/archive-survey.dto';
import { MySurveyResponseDto } from './dto/my-survey-response.dto';
import { MyResponseItemDto } from './dto/my-response-item.dto';
import { MyCouponDto } from './dto/my-coupon.dto';

@ApiTags('MyPage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('mypage')
export class MypageController {
  constructor(private readonly mypageService: MypageService) {}

  @Get('surveys')
  getMySurveys(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListMySurveysQueryDto,
  ): Promise<MySurveyResponseDto[]> {
    return this.mypageService.getMySurveys(user.sub, query.status);
  }

  @Get('responses')
  getMyResponses(
    @CurrentUser() user: JwtPayload,
  ): Promise<MyResponseItemDto[]> {
    return this.mypageService.getMyResponses(user.sub);
  }

  @Post('surveys/:id/close')
  closeSurvey(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<MySurveyResponseDto> {
    return this.mypageService.closeSurvey(user.sub, id);
  }

  @Post('surveys/:id/archive')
  archiveSurvey(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ArchiveSurveyDto,
  ): Promise<MySurveyResponseDto> {
    return this.mypageService.archiveSurvey(user.sub, id, dto.archived);
  }

  @Get('coupons')
  getMyCoupons(@CurrentUser() user: JwtPayload): Promise<MyCouponDto[]> {
    return this.mypageService.getMyCoupons(user.sub);
  }
}
