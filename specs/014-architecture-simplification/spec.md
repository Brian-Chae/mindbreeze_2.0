# [SDD-014] MIND BREEZE 2.0 아키텍처 단순화

## Goal

Docker 컨테이너 6개로 인한 복잡도와 네트워크 이슈를 근본적으로 해결하기 위해, AWS 관리형 서비스(RDS, ElastiCache, S3+CloudFront)로 인프라를 분산하고 EC2에는 Python 백엔드와 LiveKit만 systemd로 직접 실행하도록 단순화한다.

## Context

- **문제**: Docker `iptables: false` 설정으로 컨테이너 외부 통신 불가 → `iptables: true` 변경 시 SSH까지 불능. 6개 컨테이너가 얽힌 Docker 네트워크는 디버깅이 극도로 어려움.
- **계기**: Google OAuth(백엔드 → googleapis.com) 디버깅 과정에서 Docker DNS/NAT 문제가 근본 원인으로 밝혀짐.
- **방향**: Brian의 판단 — "서버를 단순하게 가져가면서 디버깅이 쉬운 구조로"

## Figma Reference

- 해당 없음 (인프라 작업)

## Scope

### ✅ In-scope

- PostgreSQL: Docker 컨테이너 → AWS RDS (`db.t4g.micro`, PostgreSQL 16)
- Redis: Docker 컨테이너 → AWS ElastiCache Serverless
- Frontend: Docker Nginx → S3 + CloudFront 정적 호스팅
- Backend: Docker 컨테이너 → EC2 systemd 직접 실행 (`uvicorn`)
- **Docker Engine 완전 제거** (서비스 및 바이너리)
- Nginx: EC2 호스트 직접 실행 (API 리버스 프록시 only)
- LiveKit: Docker 컨테이너 → EC2 호스트 직접 실행
- DNS 업데이트: `dev.mindbreeze.looxidlabs.com` → CloudFront
- 보안그룹 정리 (Docker 관련 포트 제거)

### ❌ Out-of-scope

- LiveKit을 Daily.co 등 외부 서비스로 전환 (추후 검토)
- RDS Read Replica, Multi-AZ (개발 환경 불필요)
- HTTPS/ACM 인증서 (추후 SDD)
- CI/CD 파이프라인 변경 (GitHub Actions 유지)

## Acceptance Criteria

- [ ] `docker` 명령어가 EC2에 존재하지 않음
- [ ] 백엔드 `systemctl status mindbreeze-backend` → active
- [ ] LiveKit `systemctl status livekit` → active
- [ ] `curl https://dev.mindbreeze.looxidlabs.com` → 200 (CloudFront)
- [ ] `curl https://dev-api.mindbreeze.looxidlabs.com/health` → `{"status":"ok"}`
- [ ] Google OAuth: `POST /api/v1/auth/google` → Google API 호출 성공 (401 with invalid token = 정상)
- [ ] RDS + ElastiCache 연결 정상
- [ ] SSH 재연결 안정적 (Docker 없음으로 iptables 충돌 해소)

## Dependencies

- AWS RDS, ElastiCache, S3, CloudFront (신규 생성)
- EC2 보안그룹 포트 조정
- Route53 DNS 레코드 변경

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| RDS 비용 과다 | Low | Medium | t4g.micro 최소 사양, dev 환경이므로 과금 적음 |
| ElastiCache 연결 지연 | Low | Low | Serverless라 자동 스케일링 |
| DNS 전파 지연 | Medium | Low | TTL 300초, CloudFront 즉시 배포 |
| LiveKit 호스트 바이너리 관리 | Medium | Low | systemd로 자동 재시작, GitHub Release에서 다운로드 자동화 |
| 기존 Docker 데이터 유실 | Low | High | RDS는 신규 생성이므로 데이터 마이그레이션은 수동 진행 |
