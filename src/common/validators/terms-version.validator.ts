import { ValidateBy } from 'class-validator';

// Spec 2.1: 약관 버전은 시행일(YYYY-MM-DD). 형식만 맞고 없는 날짜(2026-02-30
// 등)도 거부한다.
const TERMS_VERSION_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const TERMS_VERSION_FORMAT_MESSAGE =
  '약관 버전은 YYYY-MM-DD 형식의 날짜여야 합니다.';

export function isValidTermsVersion(value: unknown): boolean {
  if (typeof value !== 'string' || !TERMS_VERSION_REGEX.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function IsTermsVersion() {
  return ValidateBy({
    name: 'isTermsVersion',
    validator: {
      validate: (value) => isValidTermsVersion(value),
      defaultMessage: () => TERMS_VERSION_FORMAT_MESSAGE,
    },
  });
}
