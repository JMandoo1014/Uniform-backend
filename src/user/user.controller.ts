import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { UserService } from './user.service';
import { UserResponseDto } from './dto/user-response.dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() jwtUser: JwtPayload) {
    const user = await this.userService.findById(jwtUser.sub);
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    return new UserResponseDto(user);
  }
}
