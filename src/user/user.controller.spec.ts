import { UserController } from './user.controller';

describe('UserController.changePassword', () => {
  it('issues new tokens only after the password change has been stored', async () => {
    const order: string[] = [];
    const userService = {
      changePassword: jest.fn(async () => {
        await Promise.resolve();
        order.push('changePassword resolved');
        return { id: 'user-1', email: 'a@b.c' };
      }),
    };
    const tokenService = {
      issueTokens: jest.fn(() => {
        order.push('issueTokens');
        return Promise.resolve({ accessToken: 'a', refreshToken: 'r' });
      }),
    };
    const controller = new UserController(
      userService as never,
      tokenService as never,
    );

    const result = await controller.changePassword(
      { sub: 'user-1', email: 'a@b.c' },
      { currentPassword: 'OldPass1234!', newPassword: 'NewPass1234!' },
    );

    expect(order).toEqual(['changePassword resolved', 'issueTokens']);
    expect(tokenService.issueTokens).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'a@b.c',
    });
    expect(result).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });
});
