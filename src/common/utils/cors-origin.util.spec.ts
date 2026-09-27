import { parseCorsOrigin } from './cors-origin.util';

describe('parseCorsOrigin', () => {
  it('returns true (allow all) when unset or empty', () => {
    expect(parseCorsOrigin(undefined)).toBe(true);
    expect(parseCorsOrigin('')).toBe(true);
  });

  it('keeps a single exact origin as a plain string', () => {
    expect(parseCorsOrigin('https://uni-form-go.pages.dev')).toEqual([
      'https://uni-form-go.pages.dev',
    ]);
  });

  it('splits comma-separated origins and trims whitespace', () => {
    const result = parseCorsOrigin(
      'https://uni-form-go.pages.dev, http://localhost:5173 ,,',
    );
    expect(result).toEqual([
      'https://uni-form-go.pages.dev',
      'http://localhost:5173',
    ]);
  });

  it('turns a "*" entry into a RegExp matching only that subdomain slot', () => {
    const result = parseCorsOrigin('https://*.uni-form-go.pages.dev');
    expect(result).toHaveLength(1);
    const [pattern] = result as RegExp[];
    expect(pattern).toBeInstanceOf(RegExp);
    expect(pattern.test('https://32f4eea9.uni-form-go.pages.dev')).toBe(true);
    expect(pattern.test('https://landing-v4-dandy.uni-form-go.pages.dev')).toBe(
      true,
    );
    // must not match the bare root domain (no subdomain present)
    expect(pattern.test('https://uni-form-go.pages.dev')).toBe(false);
    // must not match a nested sub-subdomain (dot not covered by the wildcard)
    expect(pattern.test('https://a.b.uni-form-go.pages.dev')).toBe(false);
    // must not match an unrelated domain
    expect(pattern.test('https://uni-form-go.pages.dev.evil.example')).toBe(
      false,
    );
    expect(pattern.test('https://evil.example')).toBe(false);
  });

  it('mixes exact strings and wildcard patterns in one CORS_ORIGIN value', () => {
    const result = parseCorsOrigin(
      'https://uni-form-go.pages.dev,http://localhost:5173,https://*.uni-form-go.pages.dev',
    ) as (string | RegExp)[];

    expect(result[0]).toBe('https://uni-form-go.pages.dev');
    expect(result[1]).toBe('http://localhost:5173');
    expect(result[2]).toBeInstanceOf(RegExp);
    expect(
      (result[2] as RegExp).test('https://abc123.uni-form-go.pages.dev'),
    ).toBe(true);
  });

  it('never lets an unrelated external domain through', () => {
    const result = parseCorsOrigin(
      'https://uni-form-go.pages.dev,https://*.uni-form-go.pages.dev',
    ) as (string | RegExp)[];
    const matches = (origin: string) =>
      result.some((entry) =>
        entry instanceof RegExp ? entry.test(origin) : entry === origin,
      );

    expect(matches('https://evil-site.example')).toBe(false);
    expect(matches('https://uni-form-go.pages.dev.evil.example')).toBe(false);
  });
});
