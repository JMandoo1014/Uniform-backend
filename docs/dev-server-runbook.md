# 개발 서버 분리 절차서

운영 서버(Oracle Cloud, `ubuntu@134.185.108.221`) 한 대에 운영과 개발 백엔드를 함께 띄운다. 이 문서는 서버에서 순서대로 따라 하는 절차다. 각 단계 끝에 확인 방법과 되돌리는 방법이 있다.

| | 운영 | 개발 |
|---|---|---|
| 브랜치 | `main` | `develop` |
| 경로 | `~/Uniform-backend` | `~/Uniform-backend-dev` |
| PM2 이름 | `uniform-backend` | `uniform-backend-dev` |
| 앱 주소 | `127.0.0.1:3000` | `127.0.0.1:3001` |
| DB(같은 컨테이너 `uniform-postgres`) | `uniform_dev` (이름 유지) | `uniform_staging` |
| DB 계정 | 기존 계정(`.env`의 `POSTGRES_USER`) | `uniform_staging` (자기 DB에만 권한) |
| 도메인 | `api.uniform-app.com` | `api-dev.uniform-app.com` |
| 프론트 | 운영 Pages 도메인 | `https://develop.uni-form-go.pages.dev` |
| 배포 | `./deploy.sh` | `./deploy-dev.sh` |

**시작 전 조건**
- 이 절차서와 `deploy-dev.sh`, `.env.staging.example`이 들어간 PR이 `develop`에 머지돼 있어야 한다(개발 서버가 `develop`을 받아 쓰므로).
- 개발 프론트(`develop.uni-form-go.pages.dev`)의 API 주소를 `https://api-dev.uniform-app.com`으로 바꿀 준비가 돼 있어야 한다(9단계 전에 반영).
- 공유 postgres 컨테이너는 운영 경로의 `docker-compose.yml`로만 관리한다. **개발 경로(`~/Uniform-backend-dev`)에서는 `docker compose`를 실행하지 않는다.** 개발 `.env`에는 `POSTGRES_*`가 없어서 실행해도 바로 멈추게 돼 있다.

명령 중 `<...>`는 직접 채운다. 비밀번호·키 값은 화면에 출력하지 않도록 아래 명령은 값을 보여주지 않게 짜여 있다.

---

## 0. 현재 상태 기록

```bash
pm2 ls
cd ~/Uniform-backend && git rev-parse --abbrev-ref HEAD && git log --oneline -1
sudo ss -tlnp | grep -E ':(3000|3001) '        # 3000은 node, 3001은 비어 있어야 함
ls -l /etc/nginx/sites-enabled/ /etc/nginx/snippets/cloudflare-realip.conf
sudo openssl x509 -in /etc/uniform/ssl/origin.pem -noout -ext subjectAltName -enddate
#   SAN에 *.uniform-app.com 또는 api-dev.uniform-app.com이 있어야 개발 사이트에도 같은 인증서를 쓸 수 있다.
#   없으면 Cloudflare에서 Origin 인증서를 새로 발급(와일드카드 포함)해 교체한 뒤 진행한다.
```

되돌리기: 해당 없음(읽기만 함).

## 1. 운영 DB 백업

```bash
~/bin/uniform-db-backup.sh; echo "exit=$?"
tail -1 ~/backups/backup.log            # "... OK uniform-<날짜-시각>.dump <크기> bytes"
```

확인: 마지막 줄이 `OK`이고 방금 시각이다. 이 스크립트는 컨테이너의 `POSTGRES_DB`(= `uniform_dev`, 운영 DB)만 백업한다.

되돌리기: 해당 없음. 이후 단계에서 운영 DB를 되돌려야 하면 이 파일을 쓴다(최후 수단이므로 실행 전에 반드시 한 번 더 확인):

```bash
# 운영 DB를 백업 시점으로 되돌림 — 백업 이후의 모든 변경이 사라진다
docker exec -i uniform-postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < ~/backups/uniform-<날짜-시각>.dump
```

## 2. 개발 DB와 전용 계정 만들기

```bash
docker exec -it uniform-postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres'
```

psql 안에서:

```sql
-- 운영 계정이 Superuser인지 먼저 확인한다(아래 REVOKE가 운영 앱에 영향 없는 근거).
\du
-- 운영 계정 줄의 Attributes에 "Superuser"가 없으면 여기서 멈추고, 아래 REVOKE 전에
--   GRANT CONNECT ON DATABASE uniform_dev TO <운영 계정>;
-- 를 먼저 실행한다.

CREATE ROLE uniform_staging LOGIN;
\password uniform_staging
-- 새 비밀번호 두 번 입력(화면·기록에 남지 않음). openssl rand -hex 32 로 만든 값을 권장.

CREATE DATABASE uniform_staging OWNER uniform_staging;
REVOKE ALL ON DATABASE uniform_staging FROM PUBLIC;
-- 모든 계정은 기본적으로 모든 DB에 접속(CONNECT)할 수 있다. 개발 계정이 운영 DB에
-- 붙지 못하게 운영 DB와 기본 DB의 PUBLIC 접속 권한을 뺀다(Superuser는 영향 없음).
REVOKE CONNECT ON DATABASE uniform_dev FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
\q
```

확인:

```bash
# 개발 계정 → 개발 DB: 성공(비밀번호 입력)
docker exec -it uniform-postgres psql -h 127.0.0.1 -U uniform_staging -d uniform_staging -c 'select current_user, current_database()'
# 개발 계정 → 운영 DB: "permission denied for database \"uniform_dev\"" 로 실패해야 한다
docker exec -it uniform-postgres psql -h 127.0.0.1 -U uniform_staging -d uniform_dev -c 'select 1'
# 운영 앱은 그대로 DB에 붙는다: 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/leaderboard/rewards/config
```

되돌리기(psql 안에서, 운영 계정으로):

```sql
GRANT CONNECT ON DATABASE uniform_dev TO PUBLIC;
GRANT CONNECT ON DATABASE postgres TO PUBLIC;
DROP DATABASE IF EXISTS uniform_staging;
DROP ROLE IF EXISTS uniform_staging;
```

## 3. 개발 경로 클론과 `.env`

```bash
# 운영과 같은 원격 주소로 develop을 받는다(주소에 토큰이 있을 수 있어 화면에 출력하지 않음)
git clone -b develop "$(git -C ~/Uniform-backend remote get-url origin)" ~/Uniform-backend-dev
cd ~/Uniform-backend-dev
cp .env.staging.example .env && chmod 600 .env
nano .env
```

`.env`에서 채울 것(템플릿의 ⚠️ 표시 참고):
- `DATABASE_URL`: 2단계에서 정한 `uniform_staging` 비밀번호
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `WITHDRAWN_EMAIL_HMAC_SECRET`: 각각 `openssl rand -hex 32`로 **새로** 만든 값
- `RESEND_API_KEY`, `GEMINI_API_KEY`: 템플릿의 선택지 참고(개발 전용 키 권장)
- `PORT=3001`, `CORS_ORIGIN`, `FRONTEND_URL`은 템플릿 값 그대로

확인(값은 출력하지 않고 운영과 같은지만 본다):

```bash
for k in JWT_SECRET JWT_REFRESH_SECRET WITHDRAWN_EMAIL_HMAC_SECRET DATABASE_URL; do
  a=$(grep -m1 "^$k=" ~/Uniform-backend/.env); b=$(grep -m1 "^$k=" ~/Uniform-backend-dev/.env)
  if [ -z "$b" ]; then echo "⚠️ $k 비어 있음"; elif [ "$a" = "$b" ]; then echo "⚠️ $k 운영과 같음 — 바꿀 것"; else echo "OK $k"; fi
done
stat -c '%a %U' ~/Uniform-backend-dev/.env    # 600 ubuntu
```

되돌리기: `rm -rf ~/Uniform-backend-dev`

## 4. 개발 DB 마이그레이션

```bash
cd ~/Uniform-backend-dev
npm install && npx prisma generate
./scripts/pre-deploy-check.sh     # "host=localhost db=uniform_staging" 줄 확인. 빈 DB라 pending 표시와 exit 1은 정상
npx prisma migrate deploy
npx prisma migrate status         # "Database schema is up to date!"
```

되돌리기(개발 DB만 비우고 다시 시작, 운영 계정 psql에서):

```sql
DROP DATABASE uniform_staging;
CREATE DATABASE uniform_staging OWNER uniform_staging;
REVOKE ALL ON DATABASE uniform_staging FROM PUBLIC;
```

## 5. 개발 앱 기동(PM2)

```bash
cd ~/Uniform-backend-dev
./deploy-dev.sh
```

`deploy-dev.sh`는 경로(`~/Uniform-backend-dev`), 브랜치(`develop`), `.env`의 `PORT=3001`과 DB(`uniform_staging`)를 확인한 뒤에만 진행한다. 운영 DB나 운영 경로가 보이면 아무것도 바꾸지 않고 멈춘다. 처음 실행이면 `pm2 start ... --name uniform-backend-dev`와 `pm2 save`(재부팅 후 자동 시작)를 하고, 그다음부터는 재시작만 한다.

확인:

```bash
pm2 ls                                            # uniform-backend, uniform-backend-dev 둘 다 online
sudo ss -tlnp | grep ':3001 '                     # 127.0.0.1:3001 (0.0.0.0 아님)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/support/info   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/support/info   # 운영도 200
```

되돌리기: `pm2 delete uniform-backend-dev && pm2 save`

## 6. nginx 개발 사이트 활성화

```bash
ls -l /etc/nginx/snippets/cloudflare-realip.conf   # 없으면 아래 첫 줄로 설치
sudo install -m 644 ~/Uniform-backend-dev/deploy/nginx/cloudflare-realip.conf /etc/nginx/snippets/cloudflare-realip.conf
sudo install -m 644 ~/Uniform-backend-dev/deploy/nginx/uniform-api-dev.conf /etc/nginx/sites-available/uniform-api-dev
sudo ln -sfn /etc/nginx/sites-available/uniform-api-dev /etc/nginx/sites-enabled/uniform-api-dev
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t`가 실패하면 `reload`하지 않는다(위 `&&`). 그대로 두면 기존 설정으로 계속 동작한다.

확인(서버 안에서, DNS 없이):

```bash
curl -sk --resolve api-dev.uniform-app.com:443:127.0.0.1 https://api-dev.uniform-app.com/support/info -o /dev/null -w '%{http_code}\n'   # 200
curl -s  -H 'Host: api-dev.uniform-app.com' http://127.0.0.1/support/info -o /dev/null -w '%{http_code}\n'                             # 200
curl -s  -H 'Host: api.uniform-app.com'     http://127.0.0.1/support/info -o /dev/null -w '%{http_code}\n'                             # 운영도 200
```

되돌리기:

```bash
sudo rm /etc/nginx/sites-enabled/uniform-api-dev
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Cloudflare DNS `api-dev` 레코드

Cloudflare 대시보드 → `uniform-app.com` → DNS → 레코드 추가:
- 유형 `A`, 이름 `api-dev`, IPv4 `134.185.108.221`
- **프록시 상태: 프록시됨(주황 구름)**. 꺼져 있으면 오리진 IP가 그대로 노출되고 Origin 인증서도 브라우저에서 거부된다.

SSL/TLS 모드는 영역 전체 설정이라 `api`와 같이 적용된다.

확인(내 PC에서):

```bash
dig +short api-dev.uniform-app.com     # Cloudflare IP가 나와야 한다(134.185.108.221이 나오면 프록시가 꺼진 것)
```

되돌리기: 대시보드에서 `api-dev` 레코드 삭제.

## 8. 외부에서 확인

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api-dev.uniform-app.com/support/info   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://api-dev.uniform-app.com/api-docs        # 200
# 개발 프론트 주소에 대한 CORS 허용: access-control-allow-origin 줄이 나와야 한다
curl -s -D - -o /dev/null -X OPTIONS \
  -H 'Origin: https://develop.uni-form-go.pages.dev' -H 'Access-Control-Request-Method: POST' \
  https://api-dev.uniform-app.com/auth/login | grep -i '^access-control-allow-origin'
# 운영은 그대로
curl -s -o /dev/null -w '%{http_code}\n' https://api.uniform-app.com/support/info       # 200
```

개발 프론트에서 회원가입부터 한 번 해 본다. 인증 메일 링크가 `develop.uni-form-go.pages.dev`로 열리고, 가입한 회원은 개발 DB에만 생긴다.

```bash
# 개발 DB에만 생겼는지(인원 수만)
docker exec uniform-postgres sh -c 'psql -U "$POSTGRES_USER" -d uniform_staging -tAc "select count(*) from users"'
```

되돌리기: 해당 없음(읽기만 함).

## 9. 운영 CORS에서 개발 프론트 주소 빼기

**개발 프론트가 이미 `api-dev`를 쓰고 있을 때만** 진행한다. 그 전에 빼면 개발 프론트가 깨진다.

```bash
cd ~/Uniform-backend
grep '^CORS_ORIGIN=' .env        # 공개값이라 봐도 된다. 항목을 확인한다
```

- `https://develop.uni-form-go.pages.dev` 항목이 있으면 그 항목만 지운다.
- **`https://*.uni-form-go.pages.dev` 같은 와일드카드가 있으면, 그 항목이 `develop` 서브도메인도 허용한다.** 와일드카드를 남기면 개발 주소가 계속 허용되므로 와일드카드를 빼야 한다. Pages 프리뷰 주소는 개발 서버(`api-dev`)의 `CORS_ORIGIN`에 넣는 것을 권장한다.

```bash
cp -p .env ~/backups/env.before-cors-$(date +%Y%m%d%H%M%S) && chmod 600 ~/backups/env.before-cors-*
nano .env                         # CORS_ORIGIN만 수정
pm2 restart uniform-backend --update-env
```

확인:

```bash
# 개발 주소 → 운영 API: access-control-allow-origin 줄이 없어야 한다
curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://develop.uni-form-go.pages.dev' -H 'Access-Control-Request-Method: POST' https://api.uniform-app.com/auth/login | grep -i '^access-control-allow-origin' || echo "허용 안 됨(정상)"
# 운영 프론트 주소 → 운영 API: 허용 줄이 나와야 한다
curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: <운영 프론트 주소>' -H 'Access-Control-Request-Method: POST' https://api.uniform-app.com/auth/login | grep -i '^access-control-allow-origin'
```

확인이 끝나면 `.env` 백업 파일은 지운다(비밀값이 들어 있다): `rm ~/backups/env.before-cors-*`

되돌리기:

```bash
cp -p ~/backups/env.before-cors-<시각> ~/Uniform-backend/.env
pm2 restart uniform-backend --update-env
```

## 10. 운영을 `main`으로 전환

`main`은 `develop`보다 뒤처져 있어서, **먼저 `develop`을 `main`에 머지해야 한다.** 그래야 전환 후에도 지금 운영에서 돌고 있는 코드와 같다.

1. GitHub에서 `develop` → `main` PR을 만들어 머지한다.
2. 서버에서:

```bash
cd ~/Uniform-backend
git rev-parse HEAD > ~/backups/prod-head-before-main.txt     # 되돌릴 커밋 기록
~/bin/uniform-db-backup.sh && tail -1 ~/backups/backup.log   # 전환 직전 백업
git status --short
```

`git status`에 나오는 것 처리:
- `?? deploy.sh`: 예전에 서버에만 있던 배포 스크립트(저장소 밖). 새 `deploy.sh`가 저장소에 들어오므로 치워야 전환이 된다.
  ```bash
  mv deploy.sh ~/backups/deploy.sh.before-main
  ```
- ` M docker-compose.yml`: 2026-10-07에 5432를 `127.0.0.1`에만 열도록 서버에서 직접 고친 줄이다. 같은 변경이 저장소에도 들어갔으니 버려도 된다(이미 떠 있는 컨테이너에는 영향 없음). 다른 차이가 있으면 멈추고 확인한다.
  ```bash
  git diff docker-compose.yml
  git checkout -- docker-compose.yml
  ```

```bash
git fetch origin
git checkout -B main origin/main
./scripts/pre-deploy-check.sh      # "host=localhost db=uniform_dev" 줄과 마지막 줄 ✓ 확인
./deploy.sh
```

`deploy.sh`는 경로(`~/Uniform-backend`), 브랜치(`main`), `.env`의 `PORT`(3000 또는 비어 있음)와 DB(`uniform_dev`), PM2 `uniform-backend`가 이 경로에서 도는지를 확인한 뒤에만 진행한다. 서버에서 직접 고친 추적 파일이 있으면 멈춘다.

확인:

```bash
git -C ~/Uniform-backend rev-parse --abbrev-ref HEAD                          # main
curl -s -o /dev/null -w '%{http_code}\n' https://api.uniform-app.com/support/info   # 200
pm2 ls                                                                         # 두 프로세스 online
```

되돌리기(전환 전 커밋으로 develop 기준 운영 복귀):

```bash
cd ~/Uniform-backend
git checkout -B develop "$(cat ~/backups/prod-head-before-main.txt)"
npm install && npx prisma generate && npm run build
pm2 restart uniform-backend --update-env
# 새 deploy.sh는 main에서만 동작한다. 예전 방식으로 배포하려면:
#   cp ~/backups/deploy.sh.before-main ~/Uniform-backend/deploy.sh.old && bash ~/Uniform-backend/deploy.sh.old
```

마이그레이션은 되돌려지지 않는다. 전환으로 새 마이그레이션이 적용됐고 DB까지 되돌려야 하면 1단계의 복구 명령을 쓴다.

---

## 전환 후 작업 흐름

1. 기능 브랜치 → `develop` PR 머지
2. 개발 서버 반영: `cd ~/Uniform-backend-dev && ./deploy-dev.sh` → `api-dev`에서 확인
3. `develop` → `main` PR 머지
4. 운영 반영: `cd ~/Uniform-backend && ./deploy.sh`

## 백업

`~/bin/uniform-db-backup.sh`(매일 03:00 KST)는 컨테이너의 `POSTGRES_DB`인 운영 DB(`uniform_dev`)만 백업한다. 개발 DB는 다시 만들 수 있는 시험 데이터라 매일 백업하지 않는다. 개발 DB를 크게 바꾸기 전에 한 번 남기고 싶으면:

```bash
(umask 077 && docker exec uniform-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d uniform_staging -Fc' > ~/backups/staging-$(TZ=Asia/Seoul date +%Y%m%d-%H%M%S).dump)
```

이름을 `staging-`으로 시작하게 해서 운영 백업(`uniform-*.dump`, 30일 정리 대상)과 섞이지 않게 한다. 개발 백업은 필요 없어지면 직접 지운다.
