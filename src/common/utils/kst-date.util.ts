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

/** Spec 7.3: "기준 시각" stamped on downloaded result images, e.g. "2026-09-25 03:15". */
export function formatKstDateTime(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`;
}

/** Adds (or subtracts, for negative `days`) whole calendar days to a "YYYY-MM-DD" string. */
export function addDaysToKstDateString(input: string, days: number): string {
  const [year, month, day] = input.split('-').map(Number);
  const shifted = new Date(
    Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000,
  );
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** The instant KST 00:00:00.000 begins on the given "YYYY-MM-DD" calendar day. */
export function kstDateStringToUtcStartOfDay(input: string): Date {
  const [year, month, day] = input.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// 주차를 앞쪽으로 늘린 예외 주. 2026-10-04 팀 결정: 베타테스트가 일요일(10/4)에 시작해
// 그날 응답이 하루 만에 리셋되지 않도록, 10/4(일) 하루를 다음 주(10/5 월 ~ 10/11 일)에 붙여
// 8일로 집계한다. 10/12(월)부터는 다시 월~일 7일 규칙. 앞 주(9/28 주)는 그만큼 짧아진다.
// key: 늘어난 주의 월요일("YYYY-MM-DD"), extraDaysBefore: 앞으로 붙인 날 수.
const EXTENDED_WEEKS: { key: string; extraDaysBefore: number }[] = [
  { key: '2026-10-05', extraDaysBefore: 1 },
];

function plainKstMonday(date: Date): Date {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const kstWeekday = kst.getUTCDay(); // 0(Sun)..6(Sat), read via the KST-shift trick above
  const daysSinceMonday = (kstWeekday + 6) % 7;
  const kstMondayWallMs =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) -
    daysSinceMonday * DAY_MS;
  return new Date(kstMondayWallMs - KST_OFFSET_MS);
}

/**
 * Spec 6.2: the leaderboard's weekly bucket key — KST Monday 00:00 of the week containing `date`.
 * 예외 주(EXTENDED_WEEKS)의 앞에 붙인 날은 그 예외 주의 월요일 key로 들어간다.
 */
export function getKstWeekStart(date: Date): Date {
  for (const week of EXTENDED_WEEKS) {
    const keyStart = kstDateStringToUtcStartOfDay(week.key).getTime();
    const rangeStart = keyStart - week.extraDaysBefore * DAY_MS;
    if (date.getTime() >= rangeStart && date.getTime() < keyStart) {
      return new Date(keyStart);
    }
  }
  return plainKstMonday(date);
}

// 주차 key(월요일)가 실제로 시작하는 시각. 보통은 key 그대로, 예외 주는 앞에 붙인 날만큼 앞당겨진다.
function weekRangeStartOf(weekStart: Date): Date {
  const key = toKstDateString(weekStart);
  const extended = EXTENDED_WEEKS.find((week) => week.key === key);
  return extended
    ? new Date(weekStart.getTime() - extended.extraDaysBefore * DAY_MS)
    : weekStart;
}

/**
 * 주차 key → 그 주의 실제 시간 범위 [start, end). end는 다음 주의 실제 시작.
 * 제출 시각으로 "이번 주"를 거를 때·주차 종료 판단·화면 표시용 기간에 쓴다(key + 7일을 직접 쓰지 말 것).
 */
export function getKstWeekRange(weekStart: Date): { start: Date; end: Date } {
  return {
    start: weekRangeStartOf(weekStart),
    end: weekRangeStartOf(new Date(weekStart.getTime() + WEEK_MS)),
  };
}
