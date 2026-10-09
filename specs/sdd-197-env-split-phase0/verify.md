# [SDD-197] Verification (Pre-Implementation)

## Test Scenarios
- TS1 역할 시뮬레이션: 배포 후 `GET/POST /api/v1/dev/auth/*` → 404. 로그인 화면에 패널 없음. 기존 이메일 로그인(테스트 계정)은 정상.
- TS2 DEBUG: 서버 env `DEBUG=false`; 백엔드 재시작 후 syslog 증가분에 `sqlalchemy.engine.Engine` INFO 없음; `df`/`journalctl --disk-usage` 감소.
- TS3 뇌파 보관: 91일 경과 uploaded 청크가 있어도 `sweep_stale_eeg_raw` 가 삭제하지 않음(expired_deleted=0). 고아 pending/failed는 삭제. `retention_days` 명시 시 기존 동작 유지.
- TS4 헬스: `/health` 200 유지, `/health/live` 200, `/health/ready` 정상 200·DB 장애 시 503·Redis 장애 시 503(모킹).
- TS5 운영 설정: ENVIRONMENT=production + frontend_base_url에 `dev.` 포함 → 기동 실패. dev 환경은 영향 없음.
- TS6 업로드: 실자격증명 존재 시 환경 무관하게 업로드 실패를 숨기지 않음. 스텁 환경은 폴백 유지.
- TS7 LiveKit URL: VITE_LIVEKIT_URL 우선, 없으면 API base에서 `wss://…/livekit` 유도, localhost면 기존 기본값.
- TS8 AWS: RDS `DeletionProtection=true`, `BackupRetentionPeriod=14`, 스냅샷 `available`, 경보 생성.
- TS9 회귀: backend 전체 pytest, frontend tsc/build/기존 vitest(기존 16건 실패 외 신규 0).

## Edge Cases
- [ ] 워크플로 재배포 후에도 `ENABLE_DEV_ROLE_SIMULATION=false` 유지
- [ ] 로그 정리 중 서비스 로그 기록 지속(logrotate copytruncate)
- [ ] `EEG_RAW_RETENTION_DAYS` 환경변수 설정 시 해당 일수 적용

## Security Review
- [ ] 정리 대상 로그에 파라미터(개인정보) 포함 — 삭제로 노출 면적 축소
- [ ] dev 계정(auth_provider=dev) 삭제는 하지 않음(관리자 승계 확인 후 별도)
- [ ] 비밀값을 출력·커밋하지 않음
