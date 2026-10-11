// 비밀번호를 바꾼 뒤에도 그 전에 발급된 토큰이 쓰이지 않게 한다. JWT의 iat는
// 초 단위라, 변경 시각도 초로 내려서 비교한다 — 변경과 같은 초에 새로 로그인한
// 토큰(iat == 변경 초)은 통과한다. 그 대신 변경 직전 같은 초 안에 발급된 토큰도
// 통과하는 1초 미만의 틈이 남는다(초 단위 iat의 한계).
export function isIssuedBeforePasswordChange(
  iatSeconds: number | undefined,
  passwordChangedAt: Date | null,
): boolean {
  if (!passwordChangedAt) {
    return false;
  }
  // iat가 없으면 언제 발급됐는지 알 수 없으므로, 비밀번호를 바꾼 회원이면 거부한다.
  if (typeof iatSeconds !== 'number') {
    return true;
  }
  return iatSeconds < Math.floor(passwordChangedAt.getTime() / 1000);
}
