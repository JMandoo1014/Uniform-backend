import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
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

  // 비밀번호를 바꾸기 전에 발급된 access 토큰은 거부한다. 여기서 던지면 서명이
  // 틀리거나 만료된 토큰과 똑같은 401(UnauthorizedException)이 된다 — 프론트는
  // 기존처럼 세션 만료로 보고 로그인 화면으로 보낸다. 회원이 없어도 판단할 수
  // 없으므로 같은 401이다.
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.userService.findPasswordChangedAt(payload.sub);
    if (
      !user ||
      isIssuedBeforePasswordChange(payload.iat, user.passwordChangedAt)
    ) {
      throw new UnauthorizedException();
    }
    return payload;
  }
}
