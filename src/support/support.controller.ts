import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { SupportService } from './support.service';
import { SupportInfoResponseDto } from './dto/support-info-response.dto';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { InquirySubmittedResponseDto } from './dto/inquiry-submitted-response.dto';

@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  // 진입 위치(마이페이지/리더보드 하단/이용 제한 안내 화면)에 비로그인
  // 상태로도 접근 가능한 화면이 섞여 있어 로그인 없이 공개한다.
  @Get('info')
  getInfo(): SupportInfoResponseDto {
    return this.supportService.getInfo();
  }

  // 이용 제한·운영 삭제 안내 화면처럼 로그인 자체가 막힌 상태에서도 문의할
  // 수 있어야 해서 비로그인 접수를 허용한다 — OptionalJwtAuthGuard로 토큰이
  // 있으면 신원을 확인하고, 없어도 401 없이 통과시킨다.
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @Post('inquiries')
  createInquiry(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: CreateInquiryDto,
  ): Promise<InquirySubmittedResponseDto> {
    return this.supportService.createInquiry(user?.sub, dto);
  }
}
