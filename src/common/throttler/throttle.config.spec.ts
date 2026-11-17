import { loginEmailTracker, scaledLimit } from './throttle.config';

describe('loginEmailTracker', () => {
  it('counts case/whitespace variants of an email together', () => {
    const a = loginEmailTracker({ body: { email: 'User@Example.com' } });
    const b = loginEmailTracker({ body: { email: '  user@example.COM ' } });
    expect(a).toBe(b);
    expect(a).not.toBe(
      loginEmailTracker({ body: { email: 'other@example.com' } }),
    );
  });

  it('never contains the email itself', () => {
    const tracker = loginEmailTracker({ body: { email: 'user@example.com' } });
    expect(tracker).not.toContain('user');
    expect(tracker).not.toContain('example');
  });

  it('falls back to the IP when there is no usable email', () => {
    expect(loginEmailTracker({ ip: '203.0.113.1', body: {} })).toBe(
      'ip:203.0.113.1',
    );
    expect(loginEmailTracker({ ip: '203.0.113.1' })).toBe('ip:203.0.113.1');
    expect(loginEmailTracker({ ip: '203.0.113.1', body: { email: 42 } })).toBe(
      'ip:203.0.113.1',
    );
  });
});

describe('scaledLimit', () => {
  const original = process.env.THROTTLE_LIMIT_MULTIPLIER;
  afterEach(() => {
    if (original === undefined) delete process.env.THROTTLE_LIMIT_MULTIPLIER;
    else process.env.THROTTLE_LIMIT_MULTIPLIER = original;
  });

  it('uses the real limit unless a test multiplier is set', () => {
    delete process.env.THROTTLE_LIMIT_MULTIPLIER;
    expect(scaledLimit(10)()).toBe(10);
    process.env.THROTTLE_LIMIT_MULTIPLIER = '1000';
    expect(scaledLimit(10)()).toBe(10_000);
  });

  it('ignores invalid or lowering multipliers', () => {
    for (const value of ['abc', '0', '-5', '0.5', '']) {
      process.env.THROTTLE_LIMIT_MULTIPLIER = value;
      expect(scaledLimit(10)()).toBe(10);
    }
  });
});
