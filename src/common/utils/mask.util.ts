// 로그용 이메일 마스킹: 로컬 파트 앞 2글자만 남긴다(abcdef@domain.com →
// ab***@domain.com). 운영 중 어느 계정 건인지 짐작할 수 있을 정도만 남긴다.
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return '***';
  }
  const local = email.slice(0, at);
  const visible = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${visible}***${email.slice(at)}`;
}

// SMTP 오류 메시지처럼 외부에서 온 문자열에 섞인 이메일 주소를 가린다.
export function maskEmailsInText(text: string): string {
  return text.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, (email) =>
    maskEmail(email),
  );
}
