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

export class NoProfileChangesException extends BusinessException {
  constructor() {
    super('변경할 값이 없습니다.', HttpStatus.BAD_REQUEST);
  }
}

export class CurrentPasswordMismatchException extends BusinessException {
  constructor() {
    super('현재 비밀번호가 올바르지 않습니다.', HttpStatus.UNAUTHORIZED);
  }
}

export class AccountWithdrawnException extends BusinessException {
  constructor() {
    super('탈퇴한 계정입니다.', HttpStatus.FORBIDDEN);
  }
}

export class RecentlyWithdrawnEmailException extends BusinessException {
  constructor() {
    super(
      '탈퇴 후 30일 동안은 같은 이메일로 다시 가입할 수 없습니다.',
      HttpStatus.CONFLICT,
    );
  }
}

export class InvalidPasswordResetTokenException extends BusinessException {
  constructor() {
    super('유효하지 않거나 만료된 재설정 토큰입니다.', HttpStatus.BAD_REQUEST);
  }
}

// POST /auth/refresh: covers both a bad/expired/tampered refresh token and an
// otherwise-valid one whose account is no longer ACTIVE (withdrawn/restricted/
// still pending) since it was issued.
export class InvalidRefreshTokenException extends BusinessException {
  constructor() {
    super(
      '유효하지 않거나 만료된 리프레시 토큰입니다.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class EmailChangeNotAllowedException extends BusinessException {
  constructor() {
    super(
      '인증 대기 상태에서만 가입 이메일을 변경할 수 있습니다.',
      HttpStatus.CONFLICT,
    );
  }
}

// Spec 4.6: draft-only operations (edit, delete, publish) are rejected once a
// survey has left the "임시저장" (DRAFT) status.
export class SurveyNotDraftException extends BusinessException {
  constructor() {
    super('임시저장 상태의 설문만 처리할 수 있습니다.', HttpStatus.CONFLICT);
  }
}

// Spec 4.1: concurrent draft edits are rejected via optimistic locking
// (Survey.version); the caller must refetch and retry with the latest content,
// which is attached here so the global exception filter can return it.
export class SurveyVersionConflictException extends HttpException {
  constructor(latestSurvey: unknown) {
    super(
      {
        message:
          '다른 곳에서 먼저 저장되어 버전이 달라졌습니다. 최신 내용을 확인해주세요.',
        latestSurvey,
      },
      HttpStatus.CONFLICT,
    );
  }
}
