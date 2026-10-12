# Uni-Form 백엔드

대학(원)생 대상 설문조사 플랫폼 **Uni-Form**의 API 서버입니다. 회원·팀·설문 작성(FormMate AI 도우미 포함)·응답·결과·리더보드·관리자 콘솔 API를 제공합니다.

## 기술 스택

| 구분 | 사용 |
|---|---|
| 런타임 | Node.js 24 (`.nvmrc`) |
| 프레임워크 | NestJS 11 (TypeScript, CommonJS) |
| DB | PostgreSQL 15, Prisma 6.19.3 |
| 외부 서비스 | Resend(메일 발송), Google Gemini(FormMate) |
| 서버 운영 | PM2, nginx, Cloudflare |
| 테스트·품질 | Jest, ESLint, Prettier |

## 구조

```mermaid
flowchart LR
  browser["브라우저"]

  subgraph cf["Cloudflare"]
    pages["Pages<br/>(프론트엔드)"]
    proxy["프록시<br/>(api / api-dev)"]
  end

  subgraph origin["오리진 서버"]
    nginx["nginx"]
    app["NestJS API<br/>(PM2)"]
    db[("PostgreSQL 15")]
  end

  resend["Resend<br/>(메일)"]
  gemini["Google Gemini<br/>(FormMate)"]

  browser --> pages
  browser --> proxy
  proxy --> nginx
  nginx --> app
  app --> db
  app --> resend
  app --> gemini
```

브라우저는 프론트엔드를 Cloudflare Pages에서 받고, API 요청은 Cloudflare 프록시를 거쳐 오리진 서버의 nginx → NestJS로 들어옵니다. 운영과 개발 API는 같은 서버에서 따로 돕니다.

## 환경

| 브랜치 | 환경 | API | 짝이 되는 프론트 | 배포 |
|---|---|---|---|---|
| `main` | 운영 | `https://api.uniform-app.com` | `https://uni-form-go.pages.dev` | `deploy.sh` |
| `develop` | 개발 | `https://api-dev.uniform-app.com` | `https://develop.uni-form-go.pages.dev` | `deploy-dev.sh` |

운영과 개발은 DB·DB 계정·비밀키가 모두 분리돼 있습니다.

## 로컬 실행

필요한 것: Node.js 24, Docker.

```bash
nvm use                      # .nvmrc의 Node 24
npm install
cp .env.example .env
```

`npm install`이 일부 패키지의 install script를 실행하지 않았다는 경고(`install-scripts`)를 보여줄 수 있는데, 실행에 필요 없는 스크립트(텔레메트리·버전 안내 등)라 무시해도 됩니다.

`.env`에서 꼭 있어야 하는 키입니다. `.env.example`의 값 그대로도 로컬에서는 앱이 뜨지만, 메일과 FormMate는 실제 키가 있어야 동작합니다.

| 키 | 설명 |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `docker compose`가 만드는 로컬 DB 계정. 없으면 compose가 실행되지 않는다 |
| `DATABASE_URL` | 앱·Prisma가 쓰는 DB 주소. 위 `POSTGRES_*`와 같은 계정·DB여야 한다 |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | access·refresh 토큰 서명 키. 없으면 앱이 뜨지 않는다 |
| `WITHDRAWN_EMAIL_HMAC_SECRET` | 탈퇴 이메일 해시 키(30일 재가입 차단). 없으면 앱이 뜨지 않는다 |
| `TERMS_VERSION` | 현재 약관 시행일(`YYYY-MM-DD`). 없거나 형식이 틀리면 앱이 뜨지 않는다 |
| `RESEND_API_KEY` | 메일 발송 키. 없으면 앱이 뜨지 않는다(예시 값이면 뜨지만 발송은 실패) |
| `GEMINI_API_KEY` | FormMate용 Gemini 키. 없어도 앱은 뜨지만 FormMate 요청이 실패한다 |

나머지 키(`PORT`, `CORS_ORIGIN`, `FRONTEND_URL`, `RETENTION_*` 등)는 `.env.example`의 주석을 참고하세요.

```bash
docker compose up -d         # 로컬 PostgreSQL 15 (127.0.0.1:5432)
npm run prisma:migrate       # 마이그레이션 적용 + Prisma Client 생성
npm run start:dev            # http://localhost:3000 (코드가 바뀌면 다시 뜬다)
```

API 문서(Swagger): http://localhost:3000/api-docs

## 테스트

```bash
npm test                     # 단위 테스트
npm run lint                 # ESLint(자동 수정 포함)
npm run build                # 빌드 확인
```

e2e 테스트는 `AppModule`을 그대로 띄워 **실제 DB**에 데이터를 만들고 지웁니다. 테스트 파일끼리 서로 간섭하지 않도록 한 번에 하나씩 실행합니다(`--runInBand`). 각 테스트는 자기가 만든 데이터만 지우지만, 개인정보 정리 배치 테스트(`test/retention.e2e-spec.ts`)는 테이블 전체를 기준으로 지우기 때문에 **DB 이름이 `_e2e` 또는 `_test`로 끝날 때만** 실행됩니다. 개발용 DB와 분리된 e2e 전용 DB에서 돌리는 것을 권장합니다.

```bash
# 한 번만: 로컬 컨테이너에 e2e 전용 DB 만들기
docker exec uniform-postgres sh -c 'createdb -U "$POSTGRES_USER" uniform_e2e'

# DATABASE_URL을 e2e DB로 바꿔 마이그레이션 후 실행(계정·비밀번호는 로컬 .env 값)
export E2E_DB="postgresql://uniform:uniform@localhost:5432/uniform_e2e?schema=public"
DATABASE_URL="$E2E_DB" npm run prisma:migrate
DATABASE_URL="$E2E_DB" npm run test:e2e
```

`DATABASE_URL`을 바꾸지 않고 `npm run test:e2e`를 실행하면 `.env`의 개발용 DB를 쓰고, 정리 배치 테스트는 건너뜁니다. 메일 발송은 테스트에서 가짜로 바뀌어 실제로 나가지 않습니다.

## 작업·배포 흐름

1. 기능 브랜치(`feature/*`, `fix/*` 등)에서 작업하고 `develop`으로 PR을 올린다.
2. 머지 후 개발 서버에 `deploy-dev.sh`로 배포하고 `api-dev`(개발 프론트)에서 확인한다.
3. `develop` → `main` PR을 올린다.
4. 머지 후 운영 서버에서 `deploy.sh`로 배포한다.

`develop`과 `main`은 PR 없이 직접 push할 수 없습니다. 두 배포 스크립트는 브랜치·포트·DB가 맞는 환경인지 확인한 뒤에만 진행합니다. 서버에서 실행하는 세부 절차는 [docs/dev-server-runbook.md](docs/dev-server-runbook.md)를 따르세요.

## 꼭 지킬 것

- **`survey-purge`를 켜지 않는다.** 결과 화면의 확정 집계 스냅샷이 아직 없어서, 켜면 마감 30일이 지난 설문의 결과 그래프가 비게 됩니다. `RETENTION_DISABLED_JOBS`에 `survey-purge`를 그대로 둡니다.
- **`TERMS_VERSION`은 프론트 `POLICY_EFFECTIVE_DATE`와 같은 날짜(`YYYY-MM-DD`)로 함께 바꾼다.** 바꾸면 그 날짜에 동의하지 않은 회원 전원에게 재동의를 받습니다.
- **`WITHDRAWN_EMAIL_HMAC_SECRET`은 한 번 정하면 바꾸지 않는다.** 바꾸면 이미 탈퇴한 이메일과 대조가 안 돼 30일 재가입 차단이 풀립니다.
- **운영과 개발은 비밀키를 공유하지 않는다.** `JWT_SECRET`, `JWT_REFRESH_SECRET`, `WITHDRAWN_EMAIL_HMAC_SECRET`, DB 계정·비밀번호는 환경마다 따로 만듭니다.
- **`.env`는 커밋하지 않는다.** 템플릿만 커밋합니다: `.env.example`(로컬), `.env.staging.example`(개발 서버), `.env.production.example`(운영).

## 디렉터리 구조

```
src/
  auth/         회원가입·로그인·토큰(JWT)·이메일 인증·비밀번호 재설정
  user/         내 정보·프로필·비밀번호 변경·약관 재동의·탈퇴
  team/         팀 생성·초대·팀장 위임·해산
  survey/       설문 초안 작성·게시·목록, FormMate(Gemini) AI 도우미
  response/     설문 응답(응답 세션·자동 저장·제출)
  result/       설문 결과 집계·그래프 이미지·내보내기
  leaderboard/  주간 응답 리더보드·보상 안내
  mypage/       내 설문·내 응답·쿠폰
  dashboard/    대시보드 요약·추이·최근 활동
  support/      고객센터 안내·문의 접수
  admin/        관리자 콘솔(회원·설문·팀·리더보드 보상·문의·조치 기록)
  retention/    개인정보 정리 배치(매일 04:00 KST)
  mail/         메일 발송(Resend SMTP)
  prisma/       Prisma 클라이언트(PrismaService)
  common/       공통 예외·필터·인터셉터·유틸·상수
prisma/         schema.prisma, 마이그레이션
test/           e2e 테스트
deploy/nginx/   서버 nginx 사이트 설정 원본
docs/           명세서, 서버 절차서
```

## 관련 문서·저장소

- [docs/spec.md](docs/spec.md): 서비스 명세서
- [docs/dev-server-runbook.md](docs/dev-server-runbook.md): 운영·개발 서버 구성과 배포 절차
- [CLAUDE.md](CLAUDE.md): 확정된 규칙·담당 범위·브랜치 정책
- [deploy/nginx/README.md](deploy/nginx/README.md): nginx 사이트 설정
- 프론트엔드: [Happy-Day-HaHa/Uni-Form_web](https://github.com/Happy-Day-HaHa/Uni-Form_web)
