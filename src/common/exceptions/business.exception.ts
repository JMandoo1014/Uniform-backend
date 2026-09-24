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

// Spec 4.5 step 1 / 5.1: "계정이 활성인지" 확인 — RESTRICTED/PENDING_VERIFICATION/
// WITHDRAWN 등 ACTIVE가 아닌 계정은 거부한다. (지호가 Survey 도메인에서 먼저
// 추가한 예외를 Response 도메인에서도 그대로 재사용 — 중복 정의였던 걸 병합.)
export class AccountNotActiveException extends BusinessException {
  constructor() {
    super('활성 회원만 이용할 수 있는 기능입니다.', HttpStatus.FORBIDDEN);
  }
}

// Spec 5.1/3.3: 본인 설문 또는 자기 팀의 팀 설문에는 응답할 수 없다.
export class OwnSurveyResponseForbiddenException extends BusinessException {
  constructor() {
    super('본인이 만든 설문에는 응답할 수 없습니다.', HttpStatus.FORBIDDEN);
  }
}

// Spec 5.1/5.5: 모집 중이 아니거나(마감/보관/운영삭제 등) 마감 시각이 지난 설문.
export class SurveyNotOpenException extends BusinessException {
  constructor() {
    super('모집 중인 설문이 아닙니다.', HttpStatus.CONFLICT);
  }
}

// Spec 5.1: 이미 제출을 완료한 설문은 다시 응답할 수 없다.
export class AlreadyRespondedException extends BusinessException {
  constructor() {
    super('이미 응답을 완료한 설문입니다.', HttpStatus.CONFLICT);
  }
}

// Spec 5.4: 서버 기본 검사(필수 답변·입력 규칙 등) 실패. 위반 사항을 모두 모아 전달한다.
export class AnswerValidationException extends HttpException {
  constructor(errors: string[]) {
    super({ message: errors }, HttpStatus.BAD_REQUEST);
  }
}

// Spec 8.3: "마감/보관" 탭의 설문만 보관 또는 보관 해제할 수 있고, 이미 목표
// 상태인 설문을 다시 같은 방향으로 토글할 수는 없다.
export class SurveyArchiveNotAllowedException extends BusinessException {
  constructor() {
    super(
      '마감 또는 보관 상태의 설문만 보관 설정을 바꿀 수 있습니다.',
      HttpStatus.CONFLICT,
    );
  }
}
