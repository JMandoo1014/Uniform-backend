#!/usr/bin/env bash
# ============================================================
# 배포 전 마이그레이션 안전 점검 스크립트 (Uni-Form backend)
#
# 배경: Dockerfile의 컨테이너 시작 명령이
#   npx prisma migrate deploy && node dist/main
# 으로 마이그레이션을 자동 적용한다. category/estimatedMinutes 같은 컬럼
# 추가 마이그레이션 자체는 nullable이라 안전하지만, "배포 대상 DB에 아직
# 적용 안 된(pending) 마이그레이션이 있는지"를 미리 확인하지 않고 배포하면
# migrate deploy가 배포 도중에야 실패해서 컨테이너가 못 뜬다 — 이전 배포가
# 실패한 채로 남았거나, 이 DB에 애초에 migrate deploy를 한 번도 안 돌렸거나
# 하는 경우가 대표적이다. 이 스크립트는 그 상태를 배포 "전에" 미리 확인하기
# 위한 것이다.
#
# 이 스크립트는 아무것도 바꾸지 않는다(read-only) — `npx prisma migrate
# status`만 실행하고 결과를 사람이 읽기 쉽게 정리해서 보여준다. 배포를
# 막거나 진행시키는 것도 이 스크립트가 아니라 사람이 결과를 보고 판단한다
# (scripts/qa-cleanup-test-data.sql과 같은 "안전하게 미리보기 가능한" 성격).
#
# 이 하나의 스크립트가 특정 마이그레이션 하나만 보는 게 아니라, `prisma
# migrate status`가 검사하는 전체 migration history 대 실제 적용 여부의
# 어긋남을 일반적으로 잡아낸다 — category/estimatedMinutes는 이 문제가
# 실제로 발생할 수 있는 예시 중 하나일 뿐이다. 단, 마이그레이션 파일에 없는
# 수동 스키마 변경(drift)까지는 잡아내지 못한다 — 아래 실패 시 안내 참고.
#
# 실행 (배포 직전, 배포 대상 DB에 대해):
#   ./scripts/pre-deploy-check.sh
#   (.env의 DATABASE_URL을 그대로 쓴다 — 로컬 dev DB를 보고 있는 게 아닌지
#   아래 첫 출력 줄에서 반드시 확인할 것)
#
#   다른 DB를 보려면:
#   DATABASE_URL="postgresql://..." ./scripts/pre-deploy-check.sh
#
# CI 단계로 쓰려면: 이 스크립트를 배포 전 단계에 그대로 실행하고 종료 코드를
# 게이트로 쓰면 된다(0=문제 없음, 1=확인 필요 — 아래 참고).
# ============================================================

set -euo pipefail
cd "$(dirname "$0")/.."

echo "── 배포 대상 DB 확인 ──"
echo "아래 host/db가 배포하려는 환경이 맞는지 먼저 확인하세요(로컬 dev DB를"
echo "잘못 보고 있으면 이 점검 자체가 의미 없습니다)."
# DATABASE_URL은 환경변수로 이미 있으면 그걸 쓰고, 없으면 .env에서 읽는다
# (npx prisma도 같은 우선순위로 .env를 읽는다). 비밀번호는 보여주지 않는다.
RAW_URL="${DATABASE_URL:-}"
if [ -z "$RAW_URL" ] && [ -f .env ]; then
  RAW_URL=$(grep -m1 '^DATABASE_URL=' .env | sed -E 's/^DATABASE_URL="?([^"]*)"?$/\1/')
fi
if [ -z "$RAW_URL" ]; then
  echo "(DATABASE_URL을 찾을 수 없음 — 환경변수 또는 .env를 확인하세요)"
else
  node -e "
    try {
      const url = new URL(process.argv[1]);
      console.log('host=' + url.hostname + ' db=' + url.pathname.slice(1));
    } catch {
      console.log('(DATABASE_URL 형식을 해석할 수 없음)');
    }
  " "$RAW_URL"
fi
echo

echo "── npx prisma migrate status ──"
set +e
STATUS_OUTPUT=$(npx prisma migrate status 2>&1)
STATUS_EXIT=$?
set -e
echo "$STATUS_OUTPUT"
echo

if [ "$STATUS_EXIT" -ne 0 ]; then
  echo "⚠ prisma migrate status가 문제를 보고했습니다(위 출력 참고) — 배포 전에"
  echo "  반드시 원인을 확인하세요. 대표적인 원인(로컬에서 재현해 직접 확인함):"
  echo "  - 아직 이 DB에 적용되지 않은(pending) 마이그레이션이 있음 — 이전"
  echo "    배포가 중간에 실패했거나, 이 DB에 한 번도 migrate deploy를 안 돌린 경우"
  echo "  - 적용된 것으로 기록된 마이그레이션의 체크섬이 파일과 다름(파일이"
  echo "    나중에 수정된 경우 등)"
  echo
  echo "  주의: migrate status는 '기록된 마이그레이션이 다 적용됐는지'만 보고,"
  echo "  마이그레이션 파일에 없는 임의의 수동 스키마 변경(예: 급하게 컬럼을"
  echo "  직접 ALTER)까지 잡아내지는 않는다 — 그런 컬럼이 이미 있는 채로 같은"
  echo "  컬럼을 추가하는 마이그레이션을 그대로 배포하면 이 단계를 통과하고도"
  echo "  migrate deploy 시점에 \"column already exists\"로 실패할 수 있다."
  echo "  의심되면 대상 컬럼이 이미 있는지 직접 확인하세요(읽기 전용):"
  echo "    npx prisma db execute --stdin <<< \\"
  echo "      \"SELECT column_name FROM information_schema.columns WHERE table_name='surveys';\""
  exit 1
fi

echo "✓ 마이그레이션 기록과 실제 DB 스키마가 일치합니다 — 배포해도 안전합니다."
