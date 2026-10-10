import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from '../../user/user.service';
import { isIssuedBeforePasswordChange } from '../password-change.util';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // 다음 토큰은 서명이 틀리거나 만료된 토큰과 똑같은 401(UnauthorizedException)로
  // 거부한다 — 프론트는 기존처럼 세션 만료로 보고 로그인 화면으로 보낸다.
  // - 회원 행이 없음
  // - 탈퇴한 회원(탈퇴 직후 남은 토큰으로 프로필을 다시 채우는 등의 요청을 막는다)
  // - 비밀번호를 바꾸기 전에 발급된 토큰
  // 이용 제한(RESTRICTED) 회원은 여기서 막지 않는다 — 명세 2.2상 로그인·사유
  // 확인·마이페이지는 쓸 수 있고, 게시·응답·팀은 각 서비스가 403으로 막는다.
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.userService.findTokenCheckState(payload.sub);
    if (
      !user ||
      user.status === UserStatus.WITHDRAWN ||
      isIssuedBeforePasswordChange(payload.iat, user.passwordChangedAt)
    ) {
      throw new UnauthorizedException();
    }
    return payload;
  }
}
