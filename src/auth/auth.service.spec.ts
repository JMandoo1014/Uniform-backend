import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { InvalidRefreshTokenException } from '../common/exceptions/business.exception';
import { UserService } from '../user/user.service';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';

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
