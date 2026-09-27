import { randomInt } from 'crypto';
import { Prisma, SurveyQuestionType } from '@prisma/client';
import {
  addDaysToKstDateString,
  getKstWeekStart,
  isValidKstDateString,
  kstDateStringToUtcStartOfDay,
  toKstDateString,
} from '../common/utils/kst-date.util';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ScoredRow {
  userId: string;
  points: number;
  lastActiveAt: Date;
}

export type RankedRow<T extends ScoredRow = ScoredRow> = T & { rank: number };

// Spec 6.5: 응답 횟수 내림차순, 같은 횟수면 먼저 도달한 사람이 위(정렬만),
// 순위 번호는 동점이면 같다(1,2,2,4식).
export function rankRows<T extends ScoredRow>(rows: T[]): RankedRow<T>[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      a.lastActiveAt.getTime() - b.lastActiveAt.getTime(),
  );
  let rank = 0;
  let prevPoints: number | null = null;
  return sorted.map((row, index) => {
    if (row.points !== prevPoints) {
      rank = index + 1;
      prevPoints = row.points;
    }
    return { ...row, rank };
  });
}

// 동점 그룹 단위로 보상 자리(limit)를 채운다. 그룹 전체가 남은 자리에 들어가면
// 확정(clearWinners), 넘치면 그 그룹이 추첨 대상(contestedGroup)이 된다.
// 예: 1위 1명·2위 1명·3위 동점 2명 → clear=[1위,2위], contested=[3위 2명], 남은 자리 1.
export function resolveRewardWinners<T extends { rank: number }>(
  ranked: T[],
  limit: number,
): { clearWinners: T[]; contestedGroup: T[]; remainingSlots: number } {
  const groups: T[][] = [];
  for (const row of ranked) {
    const last = groups.at(-1);
    if (last && last[0].rank === row.rank) {
      last.push(row);
    } else {
      groups.push([row]);
    }
  }

  const clearWinners: T[] = [];
  let remaining = limit;
  for (const group of groups) {
    if (remaining === 0) break;
    if (group.length <= remaining) {
      clearWinners.push(...group);
      remaining -= group.length;
    } else {
      return { clearWinners, contestedGroup: group, remainingSlots: remaining };
    }
  }
  return { clearWinners, contestedGroup: [], remainingSlots: 0 };
}

// 추첨: 동점 그룹에서 count명을 균등하게 뽑는다(Fisher-Yates). 테스트를 위해
// 난수 함수를 주입받는다.
export function pickLotteryWinners<T>(
  group: T[],
  count: number,
  random: (maxExclusive: number) => number = (max) => randomInt(max),
): T[] {
  const pool = [...group];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// 최종 보상 대상에 1..n 자리 번호를 붙인다 — 확정 당첨자(순위 순) 뒤에 추첨
// 당첨자(리더보드 정렬 순)를 잇는다. 추첨이 없으면 확정 당첨자만.
export function assignRewardSlots<T extends { userId: string }>(
  clearWinners: T[],
  contestedGroup: T[],
  lotteryWinnerIds: string[],
): (T & { slot: number })[] {
  const lotterySet = new Set(lotteryWinnerIds);
  return [
    ...clearWinners,
    ...contestedGroup.filter((row) => lotterySet.has(row.userId)),
  ].map((row, index) => ({ ...row, slot: index + 1 }));
}

// "YYYY-MM-DD"(그 주의 아무 날) → 그 주 월요일 00:00 KST. 잘못된 형식이면 null.
export function parseWeekKey(input: string): Date | null {
  if (!isValidKstDateString(input)) return null;
  return getKstWeekStart(kstDateStringToUtcStartOfDay(input));
}

export function toWeekKey(weekStart: Date): string {
  return toKstDateString(weekStart);
}

// "9.21 ~ 9.27"
export function weekRangeLabel(weekStart: Date): string {
  const start = toKstDateString(weekStart);
  const end = addDaysToKstDateString(start, 6);
  const short = (value: string) => {
    const [, month, day] = value.split('-').map(Number);
    return `${month}.${day}`;
  };
  return `${short(start)} ~ ${short(end)}`;
}

// 관리자 콘솔 번호형 이름(닉네임 "회원12345", 팀 "팀12345").
export function generateNumberedName(
  prefix: string,
  random: (min: number, maxExclusive: number) => number = (min, max) =>
    randomInt(min, max),
): string {
  return `${prefix}${random(10000, 100000)}`;
}

interface AnswerQuestion {
  type: SurveyQuestionType;
  options: { id: string; label: string }[];
}

// 관리자가 원문 답변을 읽을 수 있게 저장값(보기 id 등)을 사람이 읽는 값으로
// 바꾼다. 관리자 뷰라 마스킹하지 않는다.
export function formatAdminAnswer(
  question: AnswerQuestion | undefined,
  value: Prisma.JsonValue,
): string | string[] | number | null {
  if (value === null || value === undefined) return null;
  const labelOf = (optionId: unknown) =>
    question?.options.find((o) => o.id === optionId)?.label ?? String(optionId);

  if (question?.type === SurveyQuestionType.SINGLE_CHOICE) {
    const answer = value as { optionId?: string; etcText?: string };
    if (!answer || typeof answer !== 'object' || !answer.optionId) return null;
    const label = labelOf(answer.optionId);
    return answer.etcText?.trim()
      ? `${label} (${answer.etcText.trim()})`
      : label;
  }
  if (question?.type === SurveyQuestionType.MULTI_CHOICE) {
    return Array.isArray(value) ? value.map(labelOf) : null;
  }
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}
