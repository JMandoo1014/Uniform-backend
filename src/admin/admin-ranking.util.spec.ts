import { SurveyQuestionType } from '@prisma/client';
import {
  assignRewardSlots,
  formatAdminAnswer,
  generateNumberedName,
  parseWeekKey,
  pickLotteryWinners,
  rankRows,
  resolveRewardWinners,
  toWeekKey,
  weekRangeLabel,
} from './admin-ranking.util';

const at = (minute: number) => new Date(Date.UTC(2026, 8, 21, 0, minute));
const row = (userId: string, points: number, minute = 0) => ({
  userId,
  points,
  lastActiveAt: at(minute),
});

describe('rankRows', () => {
  it('orders by points and gives tied rows the same competition rank (1,2,2,4)', () => {
    const ranked = rankRows([
      row('d', 1),
      row('b', 3, 5),
      row('a', 5),
      row('c', 3, 1),
    ]);
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([
      ['a', 1],
      ['c', 2], // 같은 점수면 먼저 도달한 쪽이 위
      ['b', 2],
      ['d', 4],
    ]);
  });
});

describe('resolveRewardWinners', () => {
  const ranks = (...values: number[]) =>
    values.map((rank, i) => ({ userId: `u${i}`, rank }));

  it('takes everyone when the top ranks fit in three slots', () => {
    const result = resolveRewardWinners(ranks(1, 2, 3, 4), 3);
    expect(result.clearWinners.map((r) => r.userId)).toEqual([
      'u0',
      'u1',
      'u2',
    ]);
    expect(result.contestedGroup).toEqual([]);
  });

  it('keeps a tie that still fits and stops once the slots are full (1,2,2,4)', () => {
    const result = resolveRewardWinners(ranks(1, 2, 2, 4), 3);
    expect(result.clearWinners).toHaveLength(3);
    expect(result.contestedGroup).toEqual([]);
  });

  it('marks the overflowing tie group for a lottery (spec: 3위 동점 2명, 보상 1명)', () => {
    const result = resolveRewardWinners(ranks(1, 2, 3, 3), 3);
    expect(result.clearWinners.map((r) => r.userId)).toEqual(['u0', 'u1']);
    expect(result.contestedGroup.map((r) => r.userId)).toEqual(['u2', 'u3']);
    expect(result.remainingSlots).toBe(1);
  });

  it('handles a tie for first that already exceeds the slots', () => {
    const result = resolveRewardWinners(ranks(1, 1, 1, 1), 3);
    expect(result.clearWinners).toEqual([]);
    expect(result.contestedGroup).toHaveLength(4);
    expect(result.remainingSlots).toBe(3);
  });

  it('returns nothing for an empty week', () => {
    expect(resolveRewardWinners([], 3)).toEqual({
      clearWinners: [],
      contestedGroup: [],
      remainingSlots: 0,
    });
  });
});

describe('pickLotteryWinners', () => {
  it('picks exactly the requested count from the group without duplicates', () => {
    const group = ['a', 'b', 'c', 'd'];
    const picked = pickLotteryWinners(group, 2);
    expect(picked).toHaveLength(2);
    expect(new Set(picked).size).toBe(2);
    picked.forEach((p) => expect(group).toContain(p));
  });

  it('uses the injected random source (deterministic shuffle)', () => {
    // 항상 0을 뽑으면 Fisher-Yates가 원소를 앞으로 돌려 보낸다.
    expect(pickLotteryWinners(['a', 'b', 'c'], 1, () => 0)).toEqual(['b']);
  });
});

describe('assignRewardSlots', () => {
  it('numbers clear winners first, then lottery winners, in leaderboard order', () => {
    const slots = assignRewardSlots(
      [{ userId: 'first' }, { userId: 'second' }],
      [{ userId: 'x' }, { userId: 'y' }, { userId: 'z' }],
      ['z'],
    );
    expect(slots.map((s) => [s.userId, s.slot])).toEqual([
      ['first', 1],
      ['second', 2],
      ['z', 3],
    ]);
  });
});

describe('week keys', () => {
  it('normalizes any day of the week to that KST Monday', () => {
    const thursday = parseWeekKey('2026-09-24');
    const monday = parseWeekKey('2026-09-21');
    expect(thursday).toEqual(monday);
    // KST 월요일 00:00 = UTC 전날 15:00
    expect(monday?.toISOString()).toBe('2026-09-20T15:00:00.000Z');
    expect(toWeekKey(monday!)).toBe('2026-09-21');
  });

  it('treats Sunday as the end of the previous week', () => {
    expect(toWeekKey(parseWeekKey('2026-09-27')!)).toBe('2026-09-21');
  });

  it('rejects malformed keys', () => {
    expect(parseWeekKey('2026-W39')).toBeNull();
    expect(parseWeekKey('2026-02-30')).toBeNull();
  });

  it('formats the week range label', () => {
    expect(weekRangeLabel(parseWeekKey('2026-09-21')!)).toBe('9.21 ~ 9.27');
  });
});

describe('generateNumberedName', () => {
  it('appends a five-digit number', () => {
    expect(generateNumberedName('회원', () => 12345)).toBe('회원12345');
    expect(generateNumberedName('팀')).toMatch(/^팀\d{5}$/);
  });
});

describe('formatAdminAnswer', () => {
  const options = [
    { id: 'o1', label: '매우 좋음' },
    { id: 'o2', label: '기타' },
  ];

  it('turns choice ids into option labels, keeping the etc text', () => {
    expect(
      formatAdminAnswer(
        { type: SurveyQuestionType.SINGLE_CHOICE, options },
        { optionId: 'o2', etcText: ' 직접 입력 ' },
      ),
    ).toBe('기타 (직접 입력)');
    expect(
      formatAdminAnswer({ type: SurveyQuestionType.MULTI_CHOICE, options }, [
        'o1',
        'o2',
      ]),
    ).toEqual(['매우 좋음', '기타']);
  });

  it('passes scale numbers and text through unchanged', () => {
    expect(
      formatAdminAnswer({ type: SurveyQuestionType.SCALE, options: [] }, 4),
    ).toBe(4);
    expect(
      formatAdminAnswer(
        { type: SurveyQuestionType.SHORT_ANSWER, options: [] },
        '010-1234-5678',
      ),
    ).toBe('010-1234-5678');
  });

  it('returns null for an empty answer', () => {
    expect(formatAdminAnswer(undefined, null)).toBeNull();
  });
});
