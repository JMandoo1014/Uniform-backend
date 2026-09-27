import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MinLength } from 'class-validator';

// Spec 2.2: 비밀번호는 8자 이상, 영문과 숫자를 모두 포함해야 한다.
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export function IsValidPassword() {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: '비밀번호는 8자 이상이어야 합니다.' }),
    Matches(PASSWORD_REGEX, {
      message: '비밀번호는 영문과 숫자를 모두 포함해야 합니다.',
    }),
  );
}
