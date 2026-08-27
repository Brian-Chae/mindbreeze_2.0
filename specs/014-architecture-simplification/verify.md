# [SDD-014] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: Docker 완전 제거 검증
1. `ssh ubuntu@18.183.86.88`
2. `which docker` → 아무 출력 없음
3. `systemctl is-active docker` → `inactive` 또는 `not-found`
4. `ls /var/lib/docker` → `No such file or directory`
5. `dpkg -l | grep docker` → 패키지 없음
- **Expected:** Docker 엔진, 소켓, 데이터 디렉토리, 패키지 모두 제거됨

### TS2: 백엔드 systemd 서비스 정상 동작
1. `systemctl is-active mindbreeze-backend` → `active`
2. `curl http://localhost:8000/health` → `{"status":"ok","service":"mindbreeze-api"}`
3. `sudo journalctl -u mindbreeze-backend -n 5` → `Application startup complete`
- **Expected:** 백엔드가 systemd로 자동 시작, health check 정상

### TS3: LiveKit systemd 서비스 정상 동작
1. `systemctl is-active livekit` → `active`
2. `ss -tlnp | grep 7880` → `LISTEN`
- **Expected:** LiveKit이 systemd로 자동 시작, 포트 바인딩 완료

### TS4: Nginx API 프록시
1. `curl http://18.183.86.88/health` → `{"status":"ok","service":"mindbreeze-api"}`
2. `curl -s -o /dev/null -w "%{http_code}" https://dev-api.mindbreeze.looxidlabs.com/health` → `200`
- **Expected:** Nginx가 80번 포트에서 8000번으로 정상 프록시

### TS5: CloudFront 프론트엔드 배포
1. `curl -s -o /dev/null -w "%{http_code}" https://dni8zwhsh1zb1.cloudfront.net` → `200`
2. 브라우저에서 `https://dev.mindbreeze.looxidlabs.com` (DNS 전파 후) → MIND BREEZE 랜딩 페이지
3. `curl -s https://dni8zwhsh1zb1.cloudfront.net | grep -o 'dev-api.mindbreeze.looxidlabs.com'` → API URL 포함
- **Expected:** CloudFront에서 정적 파일 정상 서빙, SPA 라우팅 동작

### TS6: RDS PostgreSQL 연결
1. EC2에서 `PGPASSWORD='***' psql -h mindbreeze-dev.cqiucz9c6j63.ap-northeast-1.rds.amazonaws.com -U mindbreeze -d mindbreeze_dev -c 'SELECT 1'` → `1`
2. 백엔드 health check에 DB 연결 정보 포함 여부 (optionally)
- **Expected:** 백엔드가 RDS에 정상 연결됨

### TS7: ElastiCache Redis 연결
1. EC2에서 `redis-cli -h mindbreeze-dev-redis2-s4mtrg.serverless.apne1.cache.amazonaws.com -p 6379 ping` → `PONG`
- **Expected:** 백엔드가 ElastiCache에 정상 연결됨

### TS8: Google OAuth 외부 API 통신
1. `curl -X POST https://dev-api.mindbreeze.looxidlabs.com/api/v1/auth/google -H 'Content-Type: application/json' -d '{"access_token":"invalid_test_token"}'`
2. 응답: `{"detail":"유효하지 않은 Google 인증 토큰입니다"}` (401)
- **Expected:** 401 응답 = 백엔드가 Google API에 실제로 HTTP 호출 성공. 이전에는 DNS/NAT 실패로 timeout 또는 500 에러였음.

### TS9: Coturn TURN 서버 유지
1. `systemctl is-active coturn` → `active`
2. `ss -tuln | grep 3478` → UDP+TCP 리스닝
- **Expected:** 기존 coturn 설정 그대로 유지

### TS10: SSH 안정성
1. EC2 Instance Connect 또는 SSH 키로 3회 연속 접속 시도
2. 3회 모두 5초 이내 접속 성공
- **Expected:** Docker 제거로 인한 iptables 충돌 해소 → SSH 안정적

### TS11: 프론트엔드 API URL 검증
1. CloudFront에서 서빙되는 JS 파일에서 `dev-api.mindbreeze.looxidlabs.com` 확인
2. `curl -s https://dni8zwhsh1zb1.cloudfront.net/assets/index-*.js | grep -o 'dev-api.mindbreeze.looxidlabs.com'`
- **Expected:** 프론트엔드 빌드가 올바른 API URL로 설정됨

## Edge Cases

- [ ] EC2 재부팅 후 모든 systemd 서비스 자동 시작 확인 (`systemctl is-enabled` → `enabled`)
- [ ] RDS 인스턴스 재부팅/장애 시 백엔드 graceful degradation (DB 연결 재시도)
- [ ] ElastiCache 장애 시 Redis 의존 기능 graceful degradation (세션, 캐시)
- [ ] CloudFront 캐시 무효화 (`aws cloudfront create-invalidation`) 정상 동작
- [ ] Python venv 패키지 업데이트 시 systemd 재시작 절차
- [ ] LiveKit 바이너리 업데이트 절차 (GitHub Release → 다운로드 → systemd 재시작)
- [ ] 로그 로테이션: `journalctl --vacuum-size=500M` 설정
- [ ] `!` 문자 포함 비밀번호 URL 인코딩 (RDS 마스터 비밀번호)

## Security Review

- [ ] RDS: `publicly-accessible: false`, VPC 내부 통신만 허용
- [ ] ElastiCache: VPC 내부 통신만, transit encryption 검토 (추후)
- [ ] S3: CloudFront OAC로 직접 접근 제한 (현재는 퍼블릭 → 추후 OAC로 강화)
- [ ] 보안그룹: 22번 포트는 Brian IP만 허용 (현재 0.0.0.0/0 → 축소 필요)
- [ ] `.env.dev`: API 키, 비밀번호 포함 → EC2 파일 권한 `600`
- [ ] 시스템 패키지: `unattended-upgrades` 활성화 확인
- [ ] LiveKit API 키/시크릿 순환 절차 문서화
