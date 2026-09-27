// Spec 7.1: 주관식 속 전화번호·이메일·학번 형태 문자열은 가린다. 프론트
// (Uniform-frontend/src/utils/maskSensitiveText.js)와 동일한 패턴을 서버에도
// 둔다 — 응답자 보호는 클라이언트가 아니라 서버가 최종 책임져야 한다.
export function maskSensitiveText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '***@***.***')
    .replace(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '010-****-****')
    .replace(
      /\b\d{8,10}\b/g,
      (match) =>
        `${match.slice(0, 2)}${'*'.repeat(match.length - 4)}${match.slice(-2)}`,
    );
}
