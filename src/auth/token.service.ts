import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { TokenResponseDto } from './dto/token-response.dto';
import { JwtPayload } from './types/jwt-payload.type';

// access·refresh 토큰 발급. 로그인(AuthService)과 비밀번호 변경(UserController)이
// 같이 쓴다 — UserModule이 AuthModule을 import하면 순환이 생겨서 따로 뺐다.
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  signAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync(
      { sub: payload.sub, email: payload.email },
      {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_EXPIRES_IN',
          '15m',
        ) as JwtSignOptions['expiresIn'],
      },
    );
  }

  async issueTokens(payload: JwtPayload): Promise<TokenResponseDto> {
    const claims = { sub: payload.sub, email: payload.email };
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(claims),
      this.jwtService.signAsync(claims, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
          '7d',
        ) as JwtSignOptions['expiresIn'],
      }),
    ]);
    return { accessToken, refreshToken };
  }
}
