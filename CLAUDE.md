# Uni-Form Backend — 프로젝트 컨텍스트

이 프로젝트는 대학(원)생 대상 설문조사 플랫폼 "Uni-Form"의 백엔드(NestJS + Prisma + PostgreSQL)다.

## 필수 규칙

**명세서에 없는 값을 절대 임의로 추론하지 말 것.** enum, 글자수 제한, 검증 규칙 등 구체적인 값이 필요한데 명세서에서 못 찾겠으면, 추측해서 구현하지 말고 반드시 사용자에게 먼저 물어볼 것. 지금까지 gender/enrollmentStatus/grade/majorField enum을 임의로 잘못 추론해서 다시 고친 적이 있다 — 이 실수를 반복하지 않는다.

전체 명세서는 `docs/spec.md`에 있다. 새 기능을 구현하기 전에 관련 섹션을 먼저 찾아 읽을 것.

## 확정된 기술 스택 (변경 금지)

- NestJS **11** (CommonJS + Jest + ESLint + Prettier) — `nest new` 기본값이 Nest 12(ESM+vitest+oxlint)로 바뀌었으니 절대 그걸로 재생성하지 말 것
- Prisma **6.19.3** 고정 — npm `latest` 태그가 현재 RC 버전을 가리키므로 버전 업그레이드 시 반드시 안정 버전인지 확인
- 비밀번호 해싱: `bcryptjs` (네이티브 `bcrypt`는 이 환경에서 빌드 안 됨)
- PostgreSQL, `prisma migrate dev`로 마이그레이션 관리 (기존 마이그레이션 파일 직접 수정 금지, 항상 새 마이그레이션 추가)

## 확정된 User 프로필 enum 값 (명세서 2.3절)

- `gender`: `MALE` / `FEMALE` / `PREFER_NOT_TO_SAY` (⚠️ `OTHER` 아님 — 답변 거부이지 제3의 성별이 아님)
- `enrollmentStatus`: `ENROLLED` / `LEAVE_OF_ABSENCE` / `GRADUATED` / `NOT_APPLICABLE` (4개, 3개 아님)
- `grade`: `FRESHMAN` / `SOPHOMORE` / `JUNIOR` / `SENIOR_OR_ABOVE` / `GRADUATE` / `NOT_APPLICABLE` (자유 입력 금지 — 같은 전공이 여러 값으로 저장되는 걸 막기 위함)
- `majorField`: `HUMANITIES_SOCIAL` / `BUSINESS` / `ENGINEERING` / `NATURAL_SCIENCE` / `MEDICINE` / `ARTS_SPORTS` / `EDUCATION` / `NOT_APPLICABLE` (자유 입력 금지)

## 확정된 검증 규칙 (프론트 배포본 기준 — 명세서 원문과 다를 수 있음, 이쪽이 우선)

- 단답형/기타 답변: 최대 **50자** (명세서 4.3절은 100자로 적혀 있으나 프론트 배포본이 50자로 구현되어 있어 이쪽을 따름)
- 서술형 답변 글자수: 미확인 — 구현 전 반드시 사용자에게 확인
- 목표 인원: 1~100명
- 마감일: 오늘 이후 날짜만 허용, 단 "오늘"도 유효한 마감일임 (명세서 1.4절, 4.5절)

## 담당 범위 (이 레포 = 지호 담당)

Auth · User · Team · Survey(제작~게시)만 이 레포에서 구현한다. Response · Leaderboard · Result · MyPage · Dashboard · Support · Admin은 팀원(기찬)의 별도 레포 담당이다.

## 아키텍처 원칙

- `Survey.version` 필드는 팀 초안 동시 저장 충돌 방지용 낙관적 락 — 수정 API는 반드시 `where: { id, version }` + `version: { increment: 1 }` 패턴을 쓸 것
- 도메인별 모듈 구조: `src/{auth,user,team,survey}/` 각각 `*.module.ts / *.controller.ts / *.service.ts / dto/`