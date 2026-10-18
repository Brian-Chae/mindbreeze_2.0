# [SDD-210] 운영 컷오버 결과 (빈 운영 환경 시작)

- 실행일: 2026-10-18 (KST, 약 13:50~14:05, 총 ≈ 15분) · 릴리스 `20261018-033707-c8d4d8b` (빌드 run 39094248260, git c8d4d8b)
- 방침(Brian 확정): 데이터 이전 없음(DB 복사·S3 sync·6자리 코드 세션 정리·dev 계정 정지 생략), 사용자 공지·점검창·점검 페이지 없음. dev 서버·`dev.mindbreeze…` 변경 0건. MIND BREEZE 1.0 접촉 0건.
- 값(비밀)은 기록하지 않음.

## 단계별 결과

| 단계 | 결과 |
|---|---|
| 1 릴리스 검증 | 빌드 success. sha256 OK, MANIFEST(head `e036a0000051`, destructive=false, 파일 589+MANIFEST=590 일치). `dist/` 내 `prod-check`·`dev.mindbreeze`·dev IP·`mindbreeze-dev` 0건, `https://api.mindbreeze.looxidlabs.com/api/v1` 5·`https://mindbreeze.looxidlabs.com` 2 포함, Google 클라이언트 ID(공개값) 포함. 재빌드 불필요 |
| 2 임시 설정 원복 | 저장소 변수 `PROD_WEB_HOST`/`PROD_API_HOST` = 최종 주소. SSM `CORS_ALLOWED_ORIGINS` = 운영 오리진 + 앱 WebView 2종(`capacitor://localhost`, `https://localhost`, 코드 `core/cors.py` 와 일치), `prod-check` 제거. 그 외 호스트 값(`LIVEKIT_HOST`·`FRONTEND_BASE_URL`·`REPORT_EMAIL_BASE_URL`)은 이미 최종 주소 |
| 3 Route53 | `mindbreeze.`·`api.mindbreeze.` A 13.193.100.27 TTL 60 **CREATE** 2건. 존 94→96, 추가 2·삭제 0·변경 0. 8.8.8.8·1.1.1.1 전파 확인(40초) |
| 4 서버 구성 | SSM Run Command 로 `server-config.sh <운영 호스트>` 재실행: 인증서 발급(SAN 2개, 만료 2027-01-16), nginx -t OK, `prod.env` 32키·빈 값 0·엄격 렌더 rc=0 |
| 5 배포 | deploy-prod run 39098860208, 승인(pending_deployments, `컷오버(빈 운영)`) → success, 3분 17초. current=`20261018-033707-c8d4d8b`, previous=`…232954-494c682`. 마이그레이션: 빈 DB 는 리허설에서 85개 체인이 head `e036a0000051` 까지 적용돼 있어 이번엔 추가 적용 없음(alembic 컨텍스트만 확인). `ENVIRONMENT=production`, `ENABLE_DEV_ROLE_SIMULATION=false`, `RETENTION_SWEEP_ENABLED=false`, `RESEARCH_EXPORT_ENABLED=false`. `/health/ready` 200(database·redis ok). backend·worker·email-worker·export-worker·nginx·redis·livekit·coturn 전부 active |
| 6 timer | `jobs-ctl enable jobs.tsv` → 14개 활성(retention_sweep·research_export 는 enabled=0 로 미활성) |
| 7 스모크 | 웹 200 · API `/health/ready` 200 · CORS: 운영 오리진 허용 / dev 오리진 헤더 없음 · HSTS · `/api/v1/dev/auth/users` 404 · `/privacy` 200 · 인증서 만료 2027-01-16(Let's Encrypt). 초기 계정 3개(platform_admin / counselor / client; 기관 1·상담사 코드·내담자 연결 포함)를 argon2 해시로 서버에서 생성(비밀번호 평문은 서버·SSM 명령에 전달되지 않음). 로그인 3종 200 → 상담사 클래스 생성 201 → 코드 확인 200 → 내담자 입장 200 → 클래스 취소(정리) 200. 세션·리포트 목록 200 |
| 8 업타임 감시 | Route53 health check 2개(`mb-prod-api-ready` `/health/ready`, `mb-prod-web-root` `/`) + us-east-1 SNS `mindbreeze-alerts-use1` + 경보 2개 |

## 남은 이슈
1. **SNS 이메일 구독 확인 필요**: us-east-1 토픽 `mindbreeze-alerts-use1` 구독 확인 메일의 Confirm 을 눌러야 업타임 알림 도착. 경보는 현재 INSUFFICIENT_DATA(수 분 내 해소 예상). 경보 시험 발화(`uptime-monitor.sh test-alarm`)는 미실행.
2. 초기 계정 파일: `~/.hermes/data/prod-seed.env`(0600, 로컬). 로그인 이메일은 `brian.chae+mb-…@looxidlabs.com` 형태(플러스 주소). 운영 사용 전 비밀번호 교체 권장.
3. 스모크로 만든 클래스 1건은 취소 상태로 DB 에 남음(운영 스모크 이력).
4. 미검증: 영상 업로드→리포트 생성, LiveKit 화상, 실시간 WebSocket, 푸시(FCM 미설정), Google 로그인 실제 동작(운영 오리진이 Google 클라이언트에 등록됐는지 별도 확인).
5. 임시 DNS `prod-check`/`prod-api-check` 유지(정리는 별도 판단). EIP 재부팅 유지(V-1.7) 미시험. 빈 DB 체인 vs 모델 autogenerate 차이 12건(경미) 후속.
6. 보관 스위프·연구 내보내기는 승인 전 비활성 유지.
