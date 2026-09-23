const UNIT_TO_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** Parses simple durations like "15m", "24h", "7d" into milliseconds. */
export function parseDurationToMs(input: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration format: ${input}`);
  }
  const [, value, unit] = match;
  return Number(value) * UNIT_TO_MS[unit];
}
