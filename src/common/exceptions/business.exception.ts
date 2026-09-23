import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessException extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super(message, status);
  }
}

export class EmailAlreadyExistsException extends BusinessException {
  constructor() {
    super('이미 가입된 이메일입니다.', HttpStatus.CONFLICT);
  }
}

export class NicknameAlreadyExistsException extends BusinessException {
  constructor() {
    super('이미 사용 중인 닉네임입니다.', HttpStatus.CONFLICT);
  }
}

export class InvalidCredentialsException extends BusinessException {
  constructor() {
    super('이메일 또는 비밀번호가 올바르지 않습니다.', HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidVerificationTokenException extends BusinessException {
  constructor() {
    super('유효하지 않거나 만료된 인증 토큰입니다.', HttpStatus.BAD_REQUEST);
  }
}

export class EmailNotVerifiedException extends BusinessException {
  constructor() {
    super('이메일 인증이 완료되지 않았습니다.', HttpStatus.FORBIDDEN);
  }
}
