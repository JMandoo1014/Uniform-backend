import { HttpException, HttpStatus } from '@nestjs/common';

// code를 주면 응답에 고정 code가 함께 실린다(프론트가 message 문구가 아니라 code로
// 케이스를 구분할 수 있게). HttpExceptionFilter가 message·statusCode 외의 필드를
// 그대로 얹으므로 응답은 { statusCode, message, code, path, timestamp }가 된다.
// code가 없으면 지금처럼 문자열로 넘겨 응답 모양이 바뀌지 않는다.
export class BusinessException extends HttpException {
  constructor(
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly code?: string,
  ) {
    super(code === undefined ? message : { message, code }, status);
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

// I7: 401은 "이 요청의 인증(JWT)이 무효"라는 뜻으로 프론트 axios 인터셉터가
// 세션 만료로 해석해 강제 로그아웃시킨다(apiClient.js). 이건 이미 로그인된
// 사용자가 비밀번호 변경 중 현재 비밀번호를 잘못 입력한 것 — 세션은 멀쩡하고
// 입력값이 틀린 것뿐이라 401이 아니라 다른 "입력값이 틀렸다" 예외들(예:
// InvalidVerificationTokenException)과 같은 400으로 맞춘다.
export class CurrentPasswordMismatchException extends BusinessException {
  constructor() {
    super(
      '현재 비밀번호가 올바르지 않습니다.',
      HttpStatus.BAD_REQUEST,
      'CURRENT_PASSWORD_MISMATCH',
    );
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

// 비밀번호 재설정: 새 비밀번호가 지금 비밀번호와 같으면 거부한다(토큰은 소모하지
// 않아 다른 비밀번호로 다시 시도할 수 있다).
export class SameAsCurrentPasswordException extends BusinessException {
  constructor() {
    super(
      '현재 비밀번호와 다른 비밀번호를 입력해주세요',
      HttpStatus.BAD_REQUEST,
      'SAME_AS_CURRENT_PASSWORD',
    );
  }
}

export class InvalidPasswordResetTokenException extends BusinessException {
  constructor() {
    // 없는·만료된·이미 쓴 토큰과 동시 요청에서 밀린 쪽 모두 같은 code — 토큰이
    // 있었는지 응답으로 구분할 수 없어야 한다.
    super(
      '유효하지 않거나 만료된 재설정 토큰입니다.',
      HttpStatus.BAD_REQUEST,
      'INVALID_PASSWORD_RESET_TOKEN',
    );
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
// 프론트가 message 문자열이 아니라 고정된 code로 케이스를 구분해야 해서
// (문구가 바뀌면 프론트가 깨짐) SurveyVersionConflictException과 같은
// 패턴 — BusinessException 대신 HttpException을 바로 상속해 객체 바디에
// code를 실어 보낸다. 기존 statusCode/message/path/timestamp 필드는 그대로,
// code만 추가된다(새 스키마 아님) — HttpExceptionFilter가 message/statusCode를
// 뺀 나머지를 이미 그대로 얹어주므로 필터 쪽 변경은 필요 없다.
export class OwnSurveyResponseForbiddenException extends HttpException {
  constructor() {
    super(
      {
        message: '본인이 만든 설문에는 응답할 수 없습니다.',
        code: 'OWNER_CANNOT_RESPOND',
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

// Spec 5.1/5.5: 모집 중이 아니거나(마감/보관/운영삭제 등) 마감 시각이 지난 설문.
export class SurveyNotOpenException extends HttpException {
  constructor() {
    super(
      {
        message: '모집 중인 설문이 아닙니다.',
        code: 'SURVEY_NOT_RECRUITING',
      },
      HttpStatus.CONFLICT,
    );
  }
}

// Spec 5.1: 이미 제출을 완료한 설문은 다시 응답할 수 없다.
export class AlreadyRespondedException extends HttpException {
  constructor() {
    super(
      {
        message: '이미 응답을 완료한 설문입니다.',
        code: 'ALREADY_RESPONDED',
      },
      HttpStatus.CONFLICT,
    );
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

// Spec 3.1: "한 회원은 최대 3개 팀에 속할 수 있다."
export class TeamJoinLimitExceededException extends BusinessException {
  constructor() {
    super(
      '이미 3개의 팀에 속해 있어 더 가입할 수 없습니다.',
      HttpStatus.CONFLICT,
    );
  }
}

// Spec 3.1: 팀 화면(멤버 목록·초대 링크 등)은 현재 팀원만 볼 수 있다.
export class NotTeamMemberException extends BusinessException {
  constructor() {
    super('현재 팀원만 접근할 수 있습니다.', HttpStatus.FORBIDDEN);
  }
}

// Spec 3.1: "팀장 포함 최대 6명."
export class TeamFullException extends BusinessException {
  constructor() {
    super('팀 인원이 가득 찼습니다.', HttpStatus.CONFLICT);
  }
}

// Spec 3.1: 재발급하면 이전 초대 링크는 즉시 무효화되므로, 존재하지 않거나
// 무효화된 토큰은 동일하게 "유효하지 않음"으로 처리한다.
export class InvalidInviteTokenException extends BusinessException {
  constructor() {
    super('유효하지 않은 초대 링크입니다.', HttpStatus.BAD_REQUEST);
  }
}

// I6: 동시에 같은 초대 링크로 두 번 가입 요청이 오면(중복 클릭 등) 두 번째
// 요청이 team_members의 (teamId, userId) unique 제약에 걸려 Prisma P2002를
// 던진다 — team.service.ts joinTeam이 이걸 잡아 이 예외로 바꾼다. 사전 확인
// (멤버 여부 조회) 실패든 레이스로 인한 P2002든 결과는 항상 이 예외로
// 동일하다는 걸 프론트가 code로 구분할 수 있게 SurveyVersionConflictException과
// 같은 패턴(object body + code)을 쓴다.
export class AlreadyTeamMemberException extends HttpException {
  constructor() {
    super(
      { message: '이미 가입한 팀입니다.', code: 'ALREADY_TEAM_MEMBER' },
      HttpStatus.CONFLICT,
    );
  }
}

// Spec 3.1: 초대 링크 관리·팀원 내보내기·팀장 넘기기·해산은 팀장만 가능.
export class NotTeamLeaderException extends BusinessException {
  constructor() {
    super('팀장만 할 수 있는 작업입니다.', HttpStatus.FORBIDDEN);
  }
}

// Spec 3.4: "팀장 나가기: 팀장을 다른 팀원에게 넘긴 뒤에만 나갈 수 있다."
export class LeaderMustTransferBeforeLeavingException extends BusinessException {
  constructor() {
    super(
      '팀장은 팀장을 위임한 뒤에만 팀을 나갈 수 있습니다.',
      HttpStatus.CONFLICT,
    );
  }
}

// Spec 3.1: "팀 초안 삭제는 팀장 또는 만든 사람만." NotTeamLeaderException은
// "팀장만"이라고 말해 이 규칙(팀장 또는 만든 사람)에는 메시지가 맞지 않는다 —
// 만든 사람인 일반 팀원은 이 동작이 허용돼야 하므로 별도 예외로 둔다.
export class TeamDraftDeleteForbiddenException extends BusinessException {
  constructor() {
    super('팀장 또는 만든 사람만 삭제할 수 있습니다.', HttpStatus.FORBIDDEN);
  }
}

// Spec 4.2 FormMate: 적용(apply)은 PENDING 상태의 제안만, 되돌리기(revert)는
// APPLIED 상태의 제안만 대상으로 할 수 있다.
export class FormMateChangeNotApplicableException extends BusinessException {
  constructor() {
    super('적용할 수 없는 상태의 제안입니다.', HttpStatus.CONFLICT);
  }
}

// Spec 4.2 FormMate: 저장된 제안의 내용(after/before)이 문항으로 만들 수 없는
// 모양인 경우 — 검증이 추가되기 전에 저장된 제안 등. 다시 요청해도 같은 제안은
// 적용되지 않으므로 새 제안을 받도록 안내한다.
export class FormMateChangeInvalidException extends BusinessException {
  constructor() {
    super(
      '적용할 수 없는 제안입니다. FormMate에게 다시 요청해주세요.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

// Spec 4.2 FormMate: Gemini가 토큰 제한으로 응답을 자르거나 스키마를 어겨서
// JSON.parse 자체가 실패하는 경우 — 클라이언트 잘못이 아니라 업스트림(AI) 응답
// 문제이므로 502로 알린다.
export class FormMateGenerationFailedException extends BusinessException {
  constructor() {
    super(
      'FormMate 응답을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
