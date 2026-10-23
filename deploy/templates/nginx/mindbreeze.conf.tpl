# MIND BREEZE 2.0 — nginx (렌더 결과물, 직접 편집 금지: deploy/templates/nginx/mindbreeze.conf.tpl)
# 변수: WEB_HOST, API_HOST, CERT_NAME, PREFIX
# 점검 모드: /etc/nginx/mindbreeze-maintenance.d/*.conf 를 두면 아래 server 블록에 include 된다(없으면 무시).

# 정적 파일·API 응답 압축 (http 컨텍스트 — 웹·API server 블록 공통 적용)
# `gzip on;` 은 Ubuntu 기본 /etc/nginx/nginx.conf 에 이미 있어 여기 다시 쓰면 nginx -t 가 duplicate 오류를 낸다.
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_min_length 1024;
gzip_types text/plain text/css text/javascript application/javascript application/json application/xml image/svg+xml application/manifest+json;

map $http_upgrade $mb_connection_upgrade {
    default upgrade;
    ''      close;
}

# HTTP -> HTTPS (ACME 챌린지는 예외)
server {
    listen 80;
    listen [::]:80;
    server_name @@WEB_HOST@@ @@API_HOST@@;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# 프론트엔드 (릴리스 링크 /current/dist)
server {
    listen 443 ssl http2;   # Ubuntu 24.04 nginx 1.24 는 `http2 on;` 지시어 미지원
    listen [::]:443 ssl http2;
    server_name @@WEB_HOST@@;

    ssl_certificate     /etc/letsencrypt/live/@@CERT_NAME@@/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/@@CERT_NAME@@/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:MB_SSL:10m;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    include /etc/nginx/mindbreeze-maintenance.d/*.conf;

    root @@PREFIX@@/current/dist;
    index index.html;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    # 해시 파일명 정적 자산은 장기 캐시, index.html 은 항상 재검증(릴리스 전환 즉시 반영)
    location ^~ /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        add_header X-Content-Type-Options "nosniff" always;
        try_files $uri =404;
    }

    location / {
        add_header Cache-Control "no-cache" always;
        add_header Strict-Transport-Security "max-age=31536000" always;
        add_header X-Content-Type-Options "nosniff" always;
        try_files $uri $uri/ /index.html;
    }
}

# API / WebSocket / LiveKit 시그널링
server {
    listen 443 ssl http2;   # Ubuntu 24.04 nginx 1.24 는 `http2 on;` 지시어 미지원
    listen [::]:443 ssl http2;
    server_name @@API_HOST@@;

    ssl_certificate     /etc/letsencrypt/live/@@CERT_NAME@@/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/@@CERT_NAME@@/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:MB_SSL:10m;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;

    include /etc/nginx/mindbreeze-maintenance.d/*.conf;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    location /livekit/ {
        proxy_pass http://127.0.0.1:7880/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $mb_connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $mb_connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
    }
}
