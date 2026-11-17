import express from 'express';
import { applyTrustProxy } from './trust-proxy.util';

describe('applyTrustProxy', () => {
  const trusts = () => {
    const app = express();
    applyTrustProxy(app);
    return app.get('trust proxy fn') as (addr: string, i: number) => boolean;
  };

  it('trusts X-Forwarded-For only from loopback (the host nginx)', () => {
    const trust = trusts();
    expect(trust('127.0.0.1', 0)).toBe(true);
    expect(trust('::1', 0)).toBe(true);
  });

  it('does not trust a forwarded-for chain from anywhere else, so a client cannot spoof its IP', () => {
    const trust = trusts();
    expect(trust('203.0.113.9', 0)).toBe(false);
    expect(trust('10.0.0.5', 0)).toBe(false);
  });
});
