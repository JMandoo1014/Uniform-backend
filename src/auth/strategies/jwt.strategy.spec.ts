import { UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const changedAt = new Date('2026-10-10T00:00:10.500Z');
  const changedSec = Math.floor(changedAt.getTime() / 1000);

  function build(
    user: { passwordChangedAt: Date | null; status?: UserStatus } | null,
  ) {
    const userService = {
      findTokenCheckState: jest
        .fn()
        .mockResolvedValue(user && { status: UserStatus.ACTIVE, ...user }),
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
    expect(userService.findTokenCheckState).toHaveBeenCalledWith('user-1');
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

  it('rejects any token of a withdrawn member with the same plain 401', async () => {
    const { strategy } = build({
      passwordChangedAt: null,
      status: UserStatus.WITHDRAWN,
    });
    const error = await strategy.validate(payload(1)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual(
      new UnauthorizedException().getResponse(),
    );
  });

  it.each([UserStatus.RESTRICTED, UserStatus.PENDING_VERIFICATION])(
    'does not block %s members here (their limits are enforced per feature)',
    async (status) => {
      const { strategy } = build({ passwordChangedAt: null, status });
      await expect(strategy.validate(payload(1))).resolves.toBeDefined();
    },
  );
});
