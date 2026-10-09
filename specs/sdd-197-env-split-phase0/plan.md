# [SDD-197] Plan

**Architecture:** 설정/코드 변경(백엔드·프론트·워크플로) + 서버 1회성 조치(.env·journald·logrotate·디스크) + AWS CLI(RDS·경보) + git 태그.

## Files to Change
| Action | File | Description |
|---|---|---|
| Edit | `.github/workflows/deploy-dev.yml` | role sim false·DEBUG false 주입, VITE_ENABLE_ROLE_SIM 제거, `workflow_dispatch`, ready 점검, logrotate 설치 |
| Edit | `backend/app/config.py` | `debug=False`, `eeg_raw_retention_days=0`, 운영 검증 훅 |
| Edit | `backend/app/main.py` | `/health/live`·`/health/ready`, 운영 설정 검증 |
| Edit | `backend/app/services/eeg_raw_service.py` | 만료 삭제 비활성(0=무기한) |
| Edit | `backend/app/services/storage_service.py` | 업로드 실패 엄격화 조건 |
| Create | `backend/deploy/logrotate-mindbreeze` | cron 로그 회전 |
| Edit | `frontend/src/hooks/useLiveKit.ts`·`useMemberLiveKit.ts` + 신규 `lib/livekit-url.ts` | URL 유도 |
| Create | `backend/tests/test_phase0_hardening.py` | 신규 테스트 |

## Tasks
1. 서버 즉시 조치: `.env.dev` role sim·DEBUG, 백엔드 재시작(5m)
2. 워크플로 수정(10m) 3. 백엔드 코드+테스트(25m) 4. 프론트 LiveKit(10m)
5. AWS RDS·경보(10m) 6. 디스크·로그(10m) 7. 전체 검증·배포·스모크(20m) 8. main 태그·summary(10m)
