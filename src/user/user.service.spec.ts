import { NotFoundException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import {
  AccountWithdrawnException,
  CurrentPasswordMismatchException,
  SameAsCurrentPasswordException,
} from '../common/exceptions/business.exception';
import * as bcrypt from 'bcryptjs';
import { UserService } from './user.service';

// process.env(Prisma가 .env를 읽어 채울 수 있음)에 기대지 않도록 가짜 설정을 쓴다.
function buildConfig(env: Record<string, string | undefined>) {
  return {
    getOrThrow: (key: string) => {
      const value = env[key];
      if (value === undefined) {
        throw new TypeError(`Configuration key "${key}" does not exist`);
      }
      return value;
    },
  };
}

const VALID_ENV = {
  WITHDRAWN_EMAIL_HMAC_SECRET: 'test-secret',
  TERMS_VERSION: '2026-09-01',
};

describe('UserService terms version', () => {
  it('fails to construct (so the app fails to boot) without TERMS_VERSION', () => {
    expect(
      () =>
        new UserService(
          {} as never,
          buildConfig({ ...VALID_ENV, TERMS_VERSION: undefined }) as never,
        ),
    ).toThrow('TERMS_VERSION');
  });

  it.each(['v1', '2026-9-1', '2026-02-30', ''])(
    'fails to construct when TERMS_VERSION is not a YYYY-MM-DD date (%p)',
    (value) => {
      expect(
        () =>
          new UserService(
            {} as never,
            buildConfig({ ...VALID_ENV, TERMS_VERSION: value }) as never,
          ),
      ).toThrow('YYYY-MM-DD');
    },
  );

  it('exposes the configured current terms version', () => {
    const service = new UserService(
      {} as never,
      buildConfig(VALID_ENV) as never,
    );
    expect(service.getCurrentTermsVersion()).toBe('2026-09-01');
  });
});

describe('UserService.agreeToCurrentTerms', () => {
  function build(user: { status: UserStatus } | null) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn((args: unknown) => Promise.resolve(args)),
      },
    };
    const service = new UserService(
      prisma as never,
      buildConfig(VALID_ENV) as never,
    );
    return { prisma, service };
  }

  it('records the server-side current version and the current time', async () => {
    const { prisma, service } = build({ status: UserStatus.ACTIVE });
    const before = Date.now();

    await service.agreeToCurrentTerms('user-1');

    const [[args]] = prisma.user.update.mock.calls as [
      [
        {
          where: { id: string };
          data: { agreedTermsVersion: string; termsAgreedAt: Date };
        },
      ],
    ];
    expect(args.where).toEqual({ id: 'user-1' });
    expect(args.data.agreedTermsVersion).toBe('2026-09-01');
    expect(args.data.termsAgreedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('rejects a withdrawn account', async () => {
    const { prisma, service } = build({ status: UserStatus.WITHDRAWN });

    await expect(service.agreeToCurrentTerms('user-1')).rejects.toBeInstanceOf(
      AccountWithdrawnException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('404s for an unknown user', async () => {
    const { service } = build(null);

    await expect(service.agreeToCurrentTerms('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('UserService.changePassword', () => {
  function build(currentPassword: string) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          passwordHash: bcrypt.hashSync(currentPassword, 4),
        }),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'user-1', ...args.data }),
        ),
      },
    };
    const service = new UserService(
      prisma as never,
      buildConfig(VALID_ENV) as never,
    );
    return { prisma, service };
  }

  it('rejects a wrong current password with CURRENT_PASSWORD_MISMATCH and changes nothing', async () => {
    const { prisma, service } = build('OldPass1234!');

    const error = await service
      .changePassword('user-1', 'Wrong1234!', 'NewPass1234!')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CurrentPasswordMismatchException);
    expect((error as CurrentPasswordMismatchException).getResponse()).toEqual({
      message: '현재 비밀번호가 올바르지 않습니다.',
      code: 'CURRENT_PASSWORD_MISMATCH',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects the current password as the new one with SAME_AS_CURRENT_PASSWORD', async () => {
    const { prisma, service } = build('OldPass1234!');

    await expect(
      service.changePassword('user-1', 'OldPass1234!', 'OldPass1234!'),
    ).rejects.toBeInstanceOf(SameAsCurrentPasswordException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('stores the new hash and passwordChangedAt in one update', async () => {
    const { prisma, service } = build('OldPass1234!');
    const before = Date.now();

    await service.changePassword('user-1', 'OldPass1234!', 'NewPass1234!');

    const [[args]] = prisma.user.update.mock.calls as [
      [
        {
          where: { id: string };
          data: { passwordHash: string; passwordChangedAt: Date };
        },
      ],
    ];
    expect(args.where).toEqual({ id: 'user-1' });
    expect(args.data.passwordHash).not.toBe('NewPass1234!');
    expect(args.data.passwordChangedAt.getTime()).toBeGreaterThanOrEqual(
      before,
    );
  });
});
