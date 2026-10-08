import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User, UserStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { UserService } from './user.service';
import { UserResponseDto } from './dto/user-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateMarketingOptInDto } from './dto/update-marketing-opt-in.dto';

@ApiTags('User')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  async getMe(@CurrentUser() jwtUser: JwtPayload): Promise<UserResponseDto> {
    const user = await this.userService.findById(jwtUser.sub);
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    return this.toMe(user);
  }

  // Spec 2.1: 바뀐 약관에 다시 동의. 본문은 받지 않고(보내도 무시) 서버의 현재
  // 약관 버전과 지금 시각으로 기록한다. 재동의 전에도 호출할 수 있어야 하므로
  // 별도 제한 없이 로그인만 요구한다.
  @HttpCode(HttpStatus.OK)
  @Post('me/terms-consent')
  async agreeToTerms(
    @CurrentUser() jwtUser: JwtPayload,
  ): Promise<UserResponseDto> {
    const user = await this.userService.agreeToCurrentTerms(jwtUser.sub);
    return this.toMe(user);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() jwtUser: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    const user = await this.userService.updateProfile(jwtUser.sub, dto);
    return this.toMe(user);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch('me/password')
  async changePassword(
    @CurrentUser() jwtUser: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.userService.changePassword(
      jwtUser.sub,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Patch('me/marketing-opt-in')
  async updateMarketingOptIn(
    @CurrentUser() jwtUser: JwtPayload,
    @Body() dto: UpdateMarketingOptInDto,
  ): Promise<UserResponseDto> {
    const user = await this.userService.updateMarketingOptIn(
      jwtUser.sub,
      dto.marketingOptIn,
    );
    return this.toMe(user);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('me')
  async withdraw(@CurrentUser() jwtUser: JwtPayload): Promise<void> {
    await this.userService.withdraw(jwtUser.sub);
  }

  private async toMe(user: User): Promise<UserResponseDto> {
    const restriction =
      user.status === UserStatus.RESTRICTED
        ? await this.userService.findActiveRestriction(user.id)
        : null;
    return new UserResponseDto(
      user,
      this.userService.getCurrentTermsVersion(),
      restriction,
    );
  }
}
