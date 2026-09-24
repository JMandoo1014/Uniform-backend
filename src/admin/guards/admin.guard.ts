import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../../auth/types/jwt-payload.type';

// Spec 10.1: 관리자 화면은 관리자 권한이 없으면 모든 요청을 거부한다.
// JwtAuthGuard 뒤에 붙여 쓴다 — JWT 자체는 유효해도 User.isAdmin이 아니면 거부.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    const userId = request.user?.sub;
    if (!userId) {
      throw new ForbiddenException('관리자 권한이 없습니다.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });
    if (!user?.isAdmin) {
      throw new ForbiddenException('관리자 권한이 없습니다.');
    }

    return true;
  }
}
