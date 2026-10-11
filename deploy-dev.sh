#!/usr/bin/env bash
# 개발 서버 배포: ~/Uniform-backend-dev 를 origin/develop 으로 맞추고 설치·마이그레이션·
# 빌드 후 PM2(uniform-backend-dev, 127.0.0.1:3001, DB uniform_staging)를 재시작한다.
# 프로세스가 아직 없으면 새로 띄우고 pm2 save로 재부팅 후에도 뜨게 한다.
#
# 운영을 건드리지 못하게 하는 가드 — 하나라도 어긋나면 아무것도 바꾸지 않고 멈춘다:
#   - 이 스크립트가 개발 경로(~/Uniform-backend-dev)에 있고, 운영 경로가 아닌가
#   - 현재 브랜치가 develop인가
#   - .env의 PORT가 3001이고 DATABASE_URL의 DB가 uniform_staging인가(운영 DB 거부)
#   - PM2 이름이 운영 이름(uniform-backend)이 아닌가, 이미 있으면 이 경로에서 도는가
#
# 실행 중 git reset --hard가 이 파일 자체를 바꿀 수 있어서, 본문 전체를 main
# 함수로 감싸 끝까지 읽은 뒤 실행하고 마지막 줄에서 바로 종료한다.
set -euo pipefail

main() {
  local DEV_DIR="${HOME}/Uniform-backend-dev"
  local PROD_DIR="${HOME}/Uniform-backend"
  local BRANCH="develop"
  local PM2_NAME="uniform-backend-dev"
  local PROD_PM2_NAME="uniform-backend"
  local EXPECTED_PORT="3001"
  local EXPECTED_DB="uniform_staging"
  local PROD_DB="uniform_dev"

  [ "${PM2_NAME}" != "${PROD_PM2_NAME}" ] || fail "PM2 이름이 운영 이름과 같습니다."

  cd "$(dirname "$0")"
  local here dev prod
  here="$(pwd -P)"
  dev="$(cd "${DEV_DIR}" 2>/dev/null && pwd -P || true)"
  prod="$(cd "${PROD_DIR}" 2>/dev/null && pwd -P || true)"
  if [ -n "${prod}" ] && [ "${here}" = "${prod}" ]; then
    fail "운영 경로(${PROD_DIR})에서는 실행할 수 없습니다."
  fi
  if [ -z "${dev}" ] || [ "${here}" != "${dev}" ]; then
    fail "이 스크립트는 개발 경로(${DEV_DIR})에서만 실행합니다. 지금 위치: ${here}"
  fi

  local current
  current="$(git rev-parse --abbrev-ref HEAD)"
  if [ "${current}" != "${BRANCH}" ]; then
    fail "현재 브랜치: ${current} (필요: ${BRANCH})."
  fi

  [ -f .env ] || fail ".env가 없습니다(.env.staging.example 참고)."
  local port db
  port="$(env_value PORT)"
  if [ "${port}" != "${EXPECTED_PORT}" ]; then
    fail ".env PORT=${port:-(비어 있음)} (필요: ${EXPECTED_PORT}). 비어 있으면 운영 포트 3000으로 뜹니다."
  fi
  db="$(database_name)"
  if [ "${db}" = "${PROD_DB}" ]; then
    fail ".env DATABASE_URL이 운영 DB(${PROD_DB})를 가리킵니다."
  fi
  if [ "${db}" != "${EXPECTED_DB}" ]; then
    fail ".env DATABASE_URL의 DB: ${db:-(없음)} (필요: ${EXPECTED_DB})."
  fi

  local pm2_cwd
  pm2_cwd="$(pm2_cwd_of "${PM2_NAME}")"
  if [ -n "${pm2_cwd}" ] && [ "$(cd "${pm2_cwd}" && pwd -P)" != "${here}" ]; then
    fail "PM2 '${PM2_NAME}'가 다른 경로(${pm2_cwd})에서 돌고 있습니다."
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

  if [ -n "${pm2_cwd}" ]; then
    echo "[6/6] pm2 restart ${PM2_NAME}"
    pm2 restart "${PM2_NAME}" --update-env
  else
    echo "[6/6] pm2 start ${PM2_NAME} (처음 실행)"
    pm2 start dist/main.js --name "${PM2_NAME}" --cwd "${here}"
    pm2 save
  fi

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
