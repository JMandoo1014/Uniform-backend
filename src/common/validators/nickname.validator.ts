import { applyDecorators } from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';

// Spec 2.3: 닉네임은 2~12자, 한글·영문·숫자만 허용(공백 등 다른 문자 불가).
export const NICKNAME_REGEX = /^[가-힣a-zA-Z0-9]{2,12}$/;

export function IsValidNickname() {
  return applyDecorators(
    IsString(),
    Length(2, 12, { message: '닉네임은 2~12자여야 합니다.' }),
    Matches(NICKNAME_REGEX, {
      message: '닉네임은 한글, 영문, 숫자만 사용할 수 있습니다.',
    }),
  );
}
