import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  InvalidPasswordResetTokenException,
  InvalidRefreshTokenException,
  SameAsCurrentPasswordException,
} from '../common/exceptions/business.exception';
import { UserService } from '../user/user.service';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

describe('AuthService.refresh', () => {
  let service: AuthService;
  let userService: { findById: jest.Mock };
  let jwtService: { verifyAsync: jest.Mock; signAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock; get: jest.Mock };
  let mailService: {
    sendEmailVerification: jest.Mock;
    sendPasswordReset: jest.Mock;
  };

  beforeEach(async () => {
    userService = { findById: jest.fn() };
    jwtService = { verifyAsync: jest.fn(), signAsync: jest.fn() };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
        if (key === 'JWT_SECRET') return 'access-secret';
        throw new Error(`unexpected getOrThrow key: ${key}`);
      }),
      get: jest.fn((_key: string, fallback?: string) => fallback),
    };
    mailService = {
      sendEmailVerification: jest.fn(),
      sendPasswordReset: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        TokenService,
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('rejects with InvalidRefreshTokenException when the token is expired/tampered', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(
      service.refresh({ refreshToken: 'bad-token' }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    expect(userService.findById).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('rejects with InvalidRefreshTokenException when the account no longer exists', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
    });
    userService.findById.mockResolvedValue(null);

    await expect(
      service.refresh({ refreshToken: 'good-token' }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it.each([
    UserStatus.RESTRICTED,
    UserStatus.PENDING_VERIFICATION,
    UserStatus.WITHDRAWN,
  ])(
    'rejects with InvalidRefreshTokenException when account status is %s',
    async (status) => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.com',
      });
      userService.findById.mockResolvedValue({ id: 'user-1', status });

      await expect(
        service.refresh({ refreshToken: 'good-token' }),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    },
  );

  describe('after a password change', () => {
    const changedAt = new Date('2026-10-10T00:00:10.500Z');
    const changedSec = Math.floor(changedAt.getTime() / 1000);

    beforeEach(() => {
      userService.findById.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.ACTIVE,
        passwordChangedAt: changedAt,
      });
      jwtService.signAsync.mockResolvedValue('new-access-token');
    });

    it('rejects a refresh token issued before the change with the usual 401', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.com',
        iat: changedSec - 1,
      });

      await expect(
        service.refresh({ refreshToken: 'old-token' }),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('accepts a refresh token issued in the same second as the change', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.com',
        iat: changedSec,
      });

      await expect(
        service.refresh({ refreshToken: 'new-token' }),
      ).resolves.toEqual({ accessToken: 'new-access-token' });
    });
  });

  it('issues a new accessToken (and does not rotate the refreshToken) for an ACTIVE account', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'a@b.com',
    });
    userService.findById.mockResolvedValue({
      id: 'user-1',
      status: UserStatus.ACTIVE,
    });
    jwtService.signAsync.mockResolvedValue('new-access-token');

    const result = await service.refresh({ refreshToken: 'good-token' });

    expect(result).toEqual({ accessToken: 'new-access-token' });
    expect(jwtService.signAsync).toHaveBeenCalledTimes(1);
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      { sub: 'user-1', email: 'a@b.com' },
      expect.objectContaining({ secret: 'access-secret' }),
    );
  });
});

describe('AuthService.confirmPasswordReset', () => {
  const TOKEN = 'a'.repeat(64);
  let userService: {
    findByPasswordResetToken: jest.Mock;
    consumePasswordResetToken: jest.Mock;
  };
  let service: AuthService;

  async function userWithPassword(password: string, expiresInMs = 60_000) {
    return {
      id: 'user-1',
      passwordHash: await bcrypt.hash(password, 4),
      passwordResetTokenExpiresAt: new Date(Date.now() + expiresInMs),
    };
  }

  beforeEach(() => {
    userService = {
      findByPasswordResetToken: jest.fn(),
      consumePasswordResetToken: jest.fn().mockResolvedValue(true),
    };
    service = new AuthService(
      userService as never,
      {} as never,
      { get: jest.fn() } as never,
      {} as never,
      {} as never,
    );
  });

  it('consumes the token atomically with the new password hash', async () => {
    userService.findByPasswordResetToken.mockResolvedValue(
      await userWithPassword('OldPass1234!'),
    );

    await service.confirmPasswordReset({
      token: TOKEN,
      newPassword: 'NewPass1234!',
    });

    const [[userId, token, passwordHash, now]] = userService
      .consumePasswordResetToken.mock.calls as [[string, string, string, Date]];
    expect(userId).toBe('user-1');
    expect(token).toBe(TOKEN);
    expect(passwordHash).not.toBe('NewPass1234!');
    expect(now).toBeInstanceOf(Date);
  });

  it('answers the same invalid-token error when another request consumed the token first', async () => {
    userService.findByPasswordResetToken.mockResolvedValue(
      await userWithPassword('OldPass1234!'),
    );
    userService.consumePasswordResetToken.mockResolvedValue(false);

    await expect(
      service.confirmPasswordReset({
        token: TOKEN,
        newPassword: 'NewPass1234!',
      }),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenException);
  });

  it.each([
    ['unknown token', null],
    ['expired token', 'expired'],
  ])(
    'rejects an %s with the same invalid-token error',
    async (_label, kind) => {
      userService.findByPasswordResetToken.mockResolvedValue(
        kind === 'expired' ? await userWithPassword('OldPass1234!', -1) : null,
      );

      await expect(
        service.confirmPasswordReset({
          token: TOKEN,
          newPassword: 'NewPass1234!',
        }),
      ).rejects.toBeInstanceOf(InvalidPasswordResetTokenException);
      expect(userService.consumePasswordResetToken).not.toHaveBeenCalled();
    },
  );

  it('rejects the current password without consuming the token', async () => {
    userService.findByPasswordResetToken.mockResolvedValue(
      await userWithPassword('SamePass1234!'),
    );

    await expect(
      service.confirmPasswordReset({
        token: TOKEN,
        newPassword: 'SamePass1234!',
      }),
    ).rejects.toBeInstanceOf(SameAsCurrentPasswordException);
    expect(userService.consumePasswordResetToken).not.toHaveBeenCalled();
  });
});
