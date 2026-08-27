# [SDD-014] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 승인받고 구현 시작할 것.

**Goal:** Docker 6개 컨테이너 제거, AWS 관리형 서비스로 분산, EC2 4개 systemd 프로세스로 단순화

## Architecture

### Before
```
EC2 t4g.medium
├── [Docker Engine]
│   ├── mindbreeze-dev-be   (Python/FastAPI)
│   ├── mindbreeze-dev-fe   (Nginx static)
│   ├── mindbreeze-dev-nginx (Nginx proxy)
│   ├── mindbreeze-dev-db    (PostgreSQL)
│   ├── mindbreeze-dev-redis (Redis)
│   └── docker-livekit-1     (LiveKit)
├── coturn (host process)
└── 6개 컨테이너, Docker 의존성, iptables 충돌
```

### After
```
EC2 t4g.medium
├── mindbreeze-backend.service  (uvicorn, port 8000)
├── livekit.service             (port 7880)
├── nginx.service               (port 80 → proxy to 8000)
└── coturn.service              (port 3478)

AWS
├── RDS PostgreSQL  (mindbreeze-dev.cqiucz9c6j63...)
├── ElastiCache Serverless (mindbreeze-dev-redis2...)
└── S3 + CloudFront  (dni8zwhsh1zb1.cloudfront.net)
```

### Data Flow
```
Browser → CloudFront (dev.mindbreeze.looxidlabs.com)
              ↓ S3 static files
              ↓ API calls → dev-api.mindbreeze.looxidlabs.com → EC2:80
                                                                    ↓ nginx proxy
                                                                    ↓ localhost:8000 (uvicorn)
                                                                         ↓ RDS (5432)
                                                                         ↓ ElastiCache (6379)
                                                                         ↓ Google OAuth (www.googleapis.com)
```

## Tech Stack

| Component | Before | After |
|-----------|--------|-------|
| Database | PostgreSQL 16 (Docker) | RDS PostgreSQL 16.14 (t4g.micro) |
| Cache | Redis 7 (Docker) | ElastiCache Serverless Redis 7 |
| Frontend | Nginx (Docker) | S3 + CloudFront |
| Backend | Python 3.12 (Docker) | Python 3.12 (systemd, uvicorn) |
| API Proxy | Nginx (Docker) | Nginx (host) |
| WebRTC | LiveKit (Docker) | LiveKit (host binary v1.8.0) |
| TURN | coturn (host) | coturn (host, unchanged) |

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Create | `specs/014-architecture-simplification/spec.md` | Stage ① |
| Create | `specs/014-architecture-simplification/plan.md` | Stage ② (this file) |
| Create | `specs/014-architecture-simplification/verify.md` | Stage ③ |
| Create | `/etc/systemd/system/mindbreeze-backend.service` | 백엔드 systemd |
| Create | `/etc/systemd/system/livekit.service` | LiveKit systemd |
| Modify | `backend/.env.dev` | DATABASE_URL → RDS, REDIS_URL → ElastiCache |
| Delete | `docker/docker-compose.dev.yml` | 더 이상 불필요 |
| Remove | Docker Engine + docker.socket | EC2에서 완전 제거 |

## Tasks

### Task 1: RDS PostgreSQL 생성
**Objective:** AWS RDS PostgreSQL 16.14 인스턴스 생성, 보안그룹 설정
**Files:** AWS CLI
**Estimate:** 10min (프로비저닝 대기 포함)
**Status:** ✅ 완료

### Task 2: ElastiCache Redis 생성
**Objective:** AWS ElastiCache Serverless Redis 생성, 엔드포인트 확보
**Files:** AWS CLI
**Estimate:** 10min
**Status:** ✅ 완료

### Task 3: S3 + CloudFront 프론트엔드 배포
**Objective:** S3 버킷 생성, 프론트엔드 dist 업로드, CloudFront 배포 생성, DNS 연결
**Files:** AWS CLI, Route53
**Estimate:** 15min
**Status:** ✅ 완료

### Task 4: Docker 완전 제거
**Objective:** EC2에서 Docker 엔진, docker.socket, docker-compose 바이너리, Docker 볼륨 제거
**Files:** `/etc/docker/daemon.json`, `/var/lib/docker/`
**Estimate:** 5min
**Status:** ⏳ 남음

### Task 5: 백엔드 systemd 등록 + 의존성 설치
**Objective:** Python venv EC2에서 재생성, requirements 설치, systemd 서비스 파일 생성
**Files:** `/etc/systemd/system/mindbreeze-backend.service`, `backend/venv/`
**Estimate:** 10min
**Status:** ✅ 완료

### Task 6: LiveKit systemd 등록
**Objective:** LiveKit ARM64 바이너리 다운로드, config 복사, systemd 서비스 생성
**Files:** `/etc/systemd/system/livekit.service`, `/etc/livekit/livekit.yaml`
**Estimate:** 5min
**Status:** ✅ 완료

### Task 7: Nginx host 설치 + API 리버스 프록시
**Objective:** nginx EC2 호스트에 설치, `dev-api.mindbreeze.looxidlabs.com` → `localhost:8000` 프록시
**Files:** `/etc/nginx/sites-available/mindbreeze-api`
**Estimate:** 5min
**Status:** ✅ 완료

### Task 8: DNS 업데이트
**Objective:** `dev.mindbreeze.looxidlabs.com` → CloudFront, `dev-api` → EC2 (유지)
**Files:** Route53
**Estimate:** 5min
**Status:** ✅ 완료

### Task 9: 보안그룹 정리
**Objective:** Docker 관련 포트 제거, 필수 포트만 유지 (22, 80, 8000, 7880-7881, 3478, 50000-60000/udp)
**Files:** AWS EC2 Security Group
**Estimate:** 5min
**Status:** ⏳ 남음

### Task 10: E2E 검증
**Objective:** SPIKE-free 검증 — health check, Google OAuth, LiveKit, RDS/Redis 연결
**Files:** curl, Python test scripts
**Estimate:** 10min
**Status:** ⏳ 부분 완료 (API health + Google OAuth 확인됨)

## Testing Strategy

- `systemctl is-active mindbreeze-backend livekit nginx coturn` → 모두 active
- `curl https://dev-api.mindbreeze.looxidlabs.com/health` → `{"status":"ok"}`
- `curl https://dev.mindbreeze.looxidlabs.com` → 200 (CloudFront)
- `POST /api/v1/auth/google` with test token → 401 (정상 — Google API 통신 성공 의미)
- `docker ps` → command not found
