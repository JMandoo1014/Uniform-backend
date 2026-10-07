# 호스트 nginx 사이트

오리진 서버의 호스트 nginx가 Cloudflare에서 오는 요청을 받아 앱으로 넘긴다. 이 폴더가 서버 설정의 원본이다 — 서버에서 직접 고치지 말고 여기서 고친 뒤 복사한다.

| 파일 | 서버 위치 | 도메인 | 앱 |
|---|---|---|---|
| `uniform-api.conf` | `/etc/nginx/sites-available/uniform-api` | api.uniform-app.com | 127.0.0.1:3000 |
| `uniform-api-dev.conf` | `/etc/nginx/sites-available/uniform-api-dev` | api-dev.uniform-app.com | 127.0.0.1:3001 |
| `cloudflare-realip.conf` | `/etc/nginx/snippets/cloudflare-realip.conf` | (두 사이트가 include) | |

포트 예약: 3000 운영, 3001 개발, 3002 roomsolve(나중에 다시 쓸 때).

## 인증서

두 사이트 모두 `/etc/uniform/ssl/origin.pem`, `origin.key`(Cloudflare Origin 인증서)를 쓴다. 개발 도메인까지 덮는지 먼저 확인한다.

```bash
sudo openssl x509 -in /etc/uniform/ssl/origin.pem -noout -subject -ext subjectAltName -enddate
# SAN에 *.uniform-app.com(와일드카드) 또는 api-dev.uniform-app.com이 있어야 개발 사이트에도 쓸 수 있다.
```

## 설치 · 갱신

```bash
# 저장소 루트에서
sudo install -m 644 deploy/nginx/cloudflare-realip.conf /etc/nginx/snippets/cloudflare-realip.conf
sudo install -m 644 deploy/nginx/uniform-api.conf       /etc/nginx/sites-available/uniform-api
sudo install -m 644 deploy/nginx/uniform-api-dev.conf   /etc/nginx/sites-available/uniform-api-dev
sudo ln -sfn /etc/nginx/sites-available/uniform-api /etc/nginx/sites-enabled/uniform-api
sudo nginx -t && sudo systemctl reload nginx
```

개발 사이트는 개발 앱(127.0.0.1:3001)을 띄울 때 켠다.

```bash
sudo ln -sfn /etc/nginx/sites-available/uniform-api-dev /etc/nginx/sites-enabled/uniform-api-dev
sudo nginx -t && sudo systemctl reload nginx
# Cloudflare DNS에 api-dev 레코드(프록시 켬)도 함께 만든다.
```

## 확인

```bash
curl -sk --resolve api.uniform-app.com:443:127.0.0.1 https://api.uniform-app.com/api-docs -o /dev/null -w '%{http_code}\n'   # 200
curl -s  -H 'Host: api.uniform-app.com' http://127.0.0.1/api-docs -o /dev/null -w '%{http_code}\n'                            # 200 (Full (strict) 전까지)
```

Cloudflare SSL 모드를 Full (strict)로 바꾼 뒤에는 80을 닫아도 된다(별도 작업).
