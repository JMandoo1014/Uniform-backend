import {
  getKstWeekRange,
  getKstWeekStart,
  kstDateStringToUtcStartOfDay,
  toKstDateString,
} from './kst-date.util';

// KST 시각 문자열 → Date. 예: kst('2026-10-04 21:30')
const kst = (value: string) => new Date(`${value.replace(' ', 'T')}:00+09:00`);
const keyOf = (date: Date) => toKstDateString(getKstWeekStart(date));
const rangeOf = (weekKey: string) => {
  const range = getKstWeekRange(kstDateStringToUtcStartOfDay(weekKey));
  return [toKstDateString(range.start), toKstDateString(range.end)];
};

describe('KST 주차 (리더보드 주간 key·기간)', () => {
  it('평소에는 월요일 00:00 KST가 주차 key', () => {
    expect(keyOf(kst('2026-09-21 00:00'))).toBe('2026-09-21');
    expect(keyOf(kst('2026-09-27 23:59'))).toBe('2026-09-21');
    expect(keyOf(kst('2026-09-28 00:00'))).toBe('2026-09-28');
    expect(keyOf(kst('2026-10-03 23:59'))).toBe('2026-09-28');
  });

  it('베타 첫날 10/4(일)은 다음 주(10/5 월) key로 들어간다', () => {
    expect(keyOf(kst('2026-10-04 00:00'))).toBe('2026-10-05');
    expect(keyOf(kst('2026-10-04 21:30'))).toBe('2026-10-05');
    expect(keyOf(kst('2026-10-05 00:00'))).toBe('2026-10-05');
    expect(keyOf(kst('2026-10-11 23:59'))).toBe('2026-10-05');
  });

  it('10/12(월)부터는 다시 월~일 7일 규칙', () => {
    expect(keyOf(kst('2026-10-12 00:00'))).toBe('2026-10-12');
    expect(keyOf(kst('2026-10-18 23:59'))).toBe('2026-10-12');
    expect(keyOf(kst('2027-10-03 12:00'))).toBe('2027-09-27');
  });

  it('실제 기간: 9/28 주는 6일, 10/5 주는 10/4부터 8일, 나머지는 7일 [start, end)', () => {
    expect(rangeOf('2026-09-21')).toEqual(['2026-09-21', '2026-09-28']);
    expect(rangeOf('2026-09-28')).toEqual(['2026-09-28', '2026-10-04']);
    expect(rangeOf('2026-10-05')).toEqual(['2026-10-04', '2026-10-12']);
    expect(rangeOf('2026-10-12')).toEqual(['2026-10-12', '2026-10-19']);
  });

  it('기간 경계는 정확히 KST 00:00', () => {
    const range = getKstWeekRange(kstDateStringToUtcStartOfDay('2026-10-05'));
    expect(range.start.toISOString()).toBe('2026-10-03T15:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-11T15:00:00.000Z');
  });
});
