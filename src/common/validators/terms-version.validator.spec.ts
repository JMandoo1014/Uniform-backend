import { isValidTermsVersion } from './terms-version.validator';

describe('isValidTermsVersion', () => {
  it.each(['2026-09-01', '2026-10-15', '2028-02-29'])('accepts %s', (v) => {
    expect(isValidTermsVersion(v)).toBe(true);
  });

  it.each([
    ['v1'],
    [''],
    ['   '],
    ['2026-9-1'],
    ['2026/09/01'],
    ['2026-09-01T00:00:00Z'],
    [' 2026-09-01'],
    ['2026-13-01'],
    ['2026-02-30'],
    ['2027-02-29'],
    [20260901],
    [null],
    [undefined],
  ])('rejects %p', (v) => {
    expect(isValidTermsVersion(v)).toBe(false);
  });
});
