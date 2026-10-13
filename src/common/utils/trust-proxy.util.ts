// 앱은 호스트 nginx 뒤(127.0.0.1)에서만 요청을 받는다. nginx가 Cloudflare 실제
// 접속자 IP를 X-Forwarded-For 끝에 붙여 넘기므로, 루프백에서 온 연결의 그 값만
// 믿어 req.ip를 실제 IP로 만든다. true로 두면 클라이언트가 보낸 X-Forwarded-For
// 맨 앞 값을 그대로 믿게 되어 IP를 위조해 요청 횟수 제한을 피할 수 있다.
export const TRUST_PROXY = 'loopback';

export function applyTrustProxy(app: {
  set(setting: string, value: unknown): unknown;
}): void {
  app.set('trust proxy', TRUST_PROXY);
}
