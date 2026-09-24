const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Returns today's calendar date in KST as "YYYY-MM-DD", independent of server timezone. */
export function getKstTodayDateString(): string {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  return kstNow.toISOString().slice(0, 10);
}

/** Validates a "YYYY-MM-DD" string represents a real calendar date. */
export function isValidKstDateString(input: string): boolean {
  if (!DATE_ONLY_PATTERN.test(input)) {
    return false;
  }
  const [year, month, day] = input.split('-').map(Number);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  return (
    utcMidnight.getUTCFullYear() === year &&
    utcMidnight.getUTCMonth() === month - 1 &&
    utcMidnight.getUTCDate() === day
  );
}

// Spec 4.5: a deadline of "YYYY-MM-DD" accepts submissions until 23:59:59.999 KST
// that day, so the stored instant is that day's KST end-of-day converted to UTC.
export function kstDateStringToUtcEndOfDay(input: string): Date {
  const [year, month, day] = input.split('-').map(Number);
  const utcMidnightOfKstDay = Date.UTC(year, month - 1, day) - KST_OFFSET_MS;
  return new Date(utcMidnightOfKstDay + 24 * 60 * 60 * 1000 - 1);
}

/** Spec 4.5: deadline must be today (KST) or later. */
export function isKstDateOnOrAfterToday(input: string): boolean {
  return input >= getKstTodayDateString();
}

/** Converts a stored instant back to its KST calendar date, e.g. for re-checking a deadline. */
export function toKstDateString(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
