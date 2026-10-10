#!/usr/bin/env bash
# 운영 배포: ~/Uniform-backend 를 origin/main 으로 맞추고 설치·마이그레이션·빌드 후
# PM2(uniform-backend, 127.0.0.1:3000, DB uniform_dev)를 재시작한다.
# 개발 서버는 deploy-dev.sh(~/Uniform-backend-dev, develop, 3001, uniform_staging).
#
# 실수 방지 가드 — 하나라도 어긋나면 아무것도 바꾸지 않고 멈춘다:
#   - 이 스크립트가 운영 경로(~/Uniform-backend)에 있는가
#   - 현재 브랜치가 main인가(처음 전환은 docs/dev-server-runbook.md 참고)
#   - .env의 PORT가 3000(또는 비어 있음)이고 DATABASE_URL의 DB가 uniform_dev인가
#   - PM2 uniform-backend가 이 경로에서 돌고 있는가
#   - 추적 중인 파일에 서버에서 직접 고친 내용이 없는가(reset --hard로 사라지므로)
#
# 실행 중 git reset --hard가 이 파일 자체를 바꿀 수 있어서, 본문 전체를 main
# 함수로 감싸 끝까지 읽은 뒤 실행하고 마지막 줄에서 바로 종료한다.
set -euo pipefail

main() {
  local PROD_DIR="${HOME}/Uniform-backend"
  local BRANCH="main"
  local PM2_NAME="uniform-backend"
  local EXPECTED_PORT="3000"
  local EXPECTED_DB="uniform_dev"

  cd "$(dirname "$0")"
  local here prod
  here="$(pwd -P)"
  prod="$(cd "${PROD_DIR}" 2>/dev/null && pwd -P || true)"
  if [ -z "${prod}" ] || [ "${here}" != "${prod}" ]; then
    fail "이 스크립트는 운영 경로(${PROD_DIR})에서만 실행합니다. 지금 위치: ${here}"
  fi

  local current
  current="$(git rev-parse --abbrev-ref HEAD)"
  if [ "${current}" != "${BRANCH}" ]; then
    fail "현재 브랜치: ${current} (필요: ${BRANCH}). 처음 전환 절차는 docs/dev-server-runbook.md 참고."
  fi

  [ -f .env ] || fail ".env가 없습니다."
  local port db
  port="$(env_value PORT)"
  if [ -n "${port}" ] && [ "${port}" != "${EXPECTED_PORT}" ]; then
    fail ".env PORT=${port} (필요: ${EXPECTED_PORT} 또는 비워 둠). 개발 .env를 잘못 둔 것 아닌지 확인하세요."
  fi
  db="$(database_name)"
  if [ "${db}" != "${EXPECTED_DB}" ]; then
    fail ".env DATABASE_URL의 DB: ${db:-(없음)} (필요: ${EXPECTED_DB})."
  fi

  local pm2_cwd
  pm2_cwd="$(pm2_cwd_of "${PM2_NAME}")"
  if [ -z "${pm2_cwd}" ]; then
    fail "PM2 프로세스 '${PM2_NAME}'가 없습니다. 운영 프로세스가 맞는지 'pm2 ls'로 확인하세요."
  fi
  if [ "$(cd "${pm2_cwd}" && pwd -P)" != "${here}" ]; then
    fail "PM2 '${PM2_NAME}'가 다른 경로(${pm2_cwd})에서 돌고 있습니다."
  fi

  if [ -n "$(git status --porcelain --untracked-files=no)" ] &&
    [ "${DEPLOY_DISCARD_LOCAL_CHANGES:-}" != "1" ]; then
    git status --short --untracked-files=no
    fail "서버에서 직접 고친 추적 파일이 있습니다(위 목록). 확인 후 버려도 되면 DEPLOY_DISCARD_LOCAL_CHANGES=1 ./deploy.sh"
  fi

  echo "[1/6] git: origin/${BRANCH} 로 맞춤 (이전: $(git rev-parse --short HEAD))"
  git fetch origin
  git reset --hard "origin/${BRANCH}"
  echo "      → $(git log --oneline -1)"

  echo "[2/6] npm install"
  npm install

  echo "[3/6] prisma generate"
  npx prisma generate

  echo "[4/6] prisma migrate deploy (DB: ${EXPECTED_DB})"
  npx prisma migrate deploy

  echo "[5/6] build"
  npm run build

  echo "[6/6] pm2 restart ${PM2_NAME}"
  pm2 restart "${PM2_NAME}" --update-env

  wait_until_up "${EXPECTED_PORT}" "${PM2_NAME}"
  pm2 status
}

fail() {
  echo "중단: $*" >&2
  exit 1
}

# .env에서 한 값을 읽는다(앞뒤 따옴표 제거). 값은 출력하지 않는다.
env_value() {
  grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/' || true
}

# DATABASE_URL의 DB 이름만 꺼낸다(계정·비밀번호는 출력하지 않는다).
database_name() {
  local url
  url="$(env_value DATABASE_URL)"
  url="${url%%\?*}"
  echo "${url##*/}"
}

# PM2 프로세스의 실행 경로. 없으면 빈 문자열.
pm2_cwd_of() {
  pm2 jlist 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const p = JSON.parse(s || "[]").find((x) => x.name === process.argv[1]);
      process.stdout.write(p ? String(p.pm2_env.pm_cwd || "") : "");
    });' "$1"
}

# 재시작 뒤 앱이 응답할 때까지 최대 30초 기다린다.
wait_until_up() {
  local port="$1" name="$2" code=""
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/support/info" || true)"
    [ "${code}" = "200" ] && { echo "      → 127.0.0.1:${port} 응답 200"; return 0; }
    sleep 1
  done
  pm2 logs "${name}" --lines 30 --nostream || true
  fail "재시작 후 30초 안에 127.0.0.1:${port} 가 응답하지 않았습니다(마지막 코드: ${code:-없음})."
}

main "$@"; exit $?
