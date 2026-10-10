import { isIssuedBeforePasswordChange } from './password-change.util';

describe('isIssuedBeforePasswordChange', () => {
  // 2026-10-10T00:00:10.500Z — 초로 내리면 1791590410
  const changedAt = new Date('2026-10-10T00:00:10.500Z');
  const changedSec = Math.floor(changedAt.getTime() / 1000);

  it('never rejects members who have not changed their password', () => {
    expect(isIssuedBeforePasswordChange(0, null)).toBe(false);
    expect(isIssuedBeforePasswordChange(undefined, null)).toBe(false);
  });

  it('rejects a token issued in an earlier second', () => {
    expect(isIssuedBeforePasswordChange(changedSec - 1, changedAt)).toBe(true);
  });

  it('accepts a token issued in the same second as the change (login right after reset)', () => {
    expect(isIssuedBeforePasswordChange(changedSec, changedAt)).toBe(false);
  });

  it('accepts a token issued after the change', () => {
    expect(isIssuedBeforePasswordChange(changedSec + 1, changedAt)).toBe(false);
  });

  it('rejects a token without iat for a member who changed their password', () => {
    expect(isIssuedBeforePasswordChange(undefined, changedAt)).toBe(true);
  });
});
