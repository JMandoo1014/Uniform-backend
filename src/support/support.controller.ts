import { Controller, Get } from '@nestjs/common';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  // 진입 위치(마이페이지/리더보드 하단/이용 제한 안내 화면)에 비로그인
  // 상태로도 접근 가능한 화면이 섞여 있어 로그인 없이 공개한다.
  @Get('info')
  getInfo() {
    return this.supportService.getInfo();
  }
}
