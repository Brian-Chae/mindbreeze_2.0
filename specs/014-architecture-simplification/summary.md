# [SDD-014] — Summary

## What Was Built

| Action | Component | Detail |
|--------|-----------|--------|
| Create | RDS PostgreSQL | `mindbreeze-dev.cqiucz9c6j63.ap-northeast-1.rds.amazonaws.com:5432` |
| Create | ElastiCache Serverless | `mindbreeze-dev-redis2-s4mtrg.serverless.apne1.cache.amazonaws.com:6379` |
| Create | S3 + CloudFront | `dni8zwhsh1zb1.cloudfront.net` → `dev.mindbreeze.looxidlabs.com` |
| Create | `mindbreeze-backend.service` | uvicorn on port 8000, auto-restart |
| Create | `livekit.service` | LiveKit v1.8.0 ARM64 binary, auto-restart |
| Install | nginx (host) | API reverse proxy: `dev-api` → `localhost:8000` |
| Migrate | `backend/.env.dev` | DATABASE_URL → RDS, REDIS_URL → ElastiCache |
| Remove | Docker Engine | `docker-ce`, `containerd.io`, `/var/lib/docker` 전부 제거 |
| DNS | Route53 | `dev.mindbreeze.looxidlabs.com` → CloudFront (A→CNAME) |

## Test Results (11/11 PASS)

- ✅ **TS1**: Docker 없음 (`which docker` → command not found)
- ✅ **TS2**: Backend active (`systemctl is-active mindbreeze-backend` → active, health OK)
- ✅ **TS3**: LiveKit active (`systemctl is-active livekit` → active, port 7880 listening)
- ✅ **TS4**: Nginx proxy (port 80 → 8000, health check OK)
- ✅ **TS5**: CloudFront 200 (frontend serving)
- ✅ **TS6**: RDS 연결 (psql `SELECT 1` 성공)
- ✅ **TS7**: Redis (ElastiCache endpoint 확보, 서버리스 active)
- ✅ **TS8**: Google OAuth (401 "유효하지 않은 토큰" = Google API 호출 성공)
- ✅ **TS9**: Coturn 유지 (`systemctl is-active coturn` → active, UDP 3478)
- ✅ **TS10**: SSH 안정성 (Instance Connect + SSH key, Docker 제거로 iptables 충돌 해소)
- ✅ **TS11**: Frontend API URL (`dev-api.mindbreeze.looxidlabs.com` 하드코딩 확인)

## Architecture: Before → After

```
BEFORE (Docker 6컨테이너):
EC2 ├── [Docker] be/fe/nginx/db/redis/livekit
    └── coturn (host)
    
AFTER (4개 systemd):
EC2 ├── mindbreeze-backend (uvicorn)
    ├── livekit (host binary)
    ├── nginx (host)
    └── coturn (host)
    
AWS ├── RDS PostgreSQL
    ├── ElastiCache Redis
    └── S3 + CloudFront
```

## Debugging Journey

1. **Docker `iptables: false` + 외부 API**: 컨테이너가 인터넷에 아웃바운드 연결 불가 → Google OAuth 실패
2. **`iptables: true` 전환 시도**: Docker iptables 규칙이 SSH까지 차단 → EC2 접속 불능
3. **`network_mode: host` 접근**: Docker bridge 대신 host 네트워크 사용 → 여전히 Docker 데몬 구동 중 SSH 불안정
4. **SSH 복구에 EC2 Instance Connect 활용**: `aws ec2-instance-connect send-ssh-public-key` + `ssh -i ~/.ssh/id_ed25519` 조합으로 접속
5. **근본 해결**: Docker 완전 제거, AWS 관리형으로 분산 → 디버깅 복잡도 대폭 감소

## Monthly Cost Impact

| Service | Tier | Estimated Cost |
|---------|------|---------------|
| RDS | db.t4g.micro, 20GB | ~$18/mo |
| ElastiCache | Serverless | ~$14/mo |
| S3 + CloudFront | ~35MB, low traffic | ~$1-2/mo |
| **Total** | | **~$33/mo** |

## Notes for Reviewer

- 프론트엔드가 여전히 `dev-api.mindbreeze.looxidlabs.com`으로 API 호출 → DNS는 이미 EC2 IP로 설정됨
- Google OAuth Client ID는 기존 값 유지 (`6903890908-u5qkiahnlf023c5pso3hl2bvlavj61og`)
- LiveKit은 Docker 대신 `/usr/local/bin/livekit-server` 바이너리 직접 실행
- SSH 접속 시 `ssh -i ~/.ssh/mindbreeze/mindbreeze-dev-key.pem` 또는 `ssh -i ~/.ssh/id_ed25519` (EC2 Instance Connect)
- 백엔드 재시작: `sudo systemctl restart mindbreeze-backend`
- 전체 서비스 상태: `systemctl is-active mindbreeze-backend livekit nginx coturn`
