import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const changedAt = new Date('2026-10-10T00:00:10.500Z');
  const changedSec = Math.floor(changedAt.getTime() / 1000);

  function build(user: { passwordChangedAt: Date | null } | null) {
    const userService = {
      findPasswordChangedAt: jest.fn().mockResolvedValue(user),
    };
    const config = { getOrThrow: () => 'access-secret' };
    return {
      strategy: new JwtStrategy(config as never, userService as never),
      userService,
    };
  }

  const payload = (iat: number) => ({ sub: 'user-1', email: 'a@b.c', iat });

  it('passes the payload through for a member who never changed their password', async () => {
    const { strategy, userService } = build({ passwordChangedAt: null });
    await expect(strategy.validate(payload(1))).resolves.toEqual(payload(1));
    expect(userService.findPasswordChangedAt).toHaveBeenCalledWith('user-1');
  });

  it('rejects an access token issued before the password change with a plain 401', async () => {
    const { strategy } = build({ passwordChangedAt: changedAt });
    const error = await strategy
      .validate(payload(changedSec - 1))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual(
      new UnauthorizedException().getResponse(),
    );
  });

  it('accepts a token issued in the same second as the change', async () => {
    const { strategy } = build({ passwordChangedAt: changedAt });
    await expect(strategy.validate(payload(changedSec))).resolves.toBeDefined();
  });

  it('rejects a token whose member no longer exists', async () => {
    const { strategy } = build(null);
    await expect(strategy.validate(payload(1))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
