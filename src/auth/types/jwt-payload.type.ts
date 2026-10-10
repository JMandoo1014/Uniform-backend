export interface JwtPayload {
  sub: string;
  email: string;
  // jsonwebtoken이 서명할 때 넣는 발급·만료 시각(초). 검증된 토큰에는 항상 있다.
  iat?: number;
  exp?: number;
}
