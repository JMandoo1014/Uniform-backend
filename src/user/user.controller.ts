import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { UserService } from './user.service';
import { UserResponseDto } from './dto/user-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  async getMe(@CurrentUser() jwtUser: JwtPayload) {
    const user = await this.userService.findById(jwtUser.sub);
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    return new UserResponseDto(user);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() jwtUser: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    const user = await this.userService.updateProfile(jwtUser.sub, dto);
    return new UserResponseDto(user);
  }
}
