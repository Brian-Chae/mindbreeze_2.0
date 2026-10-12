# [SDD-197] Summary — 환경 분리 Phase 0 즉시 방어

## What Was Built
| 영역 | 내용 |
|---|---|
| 관리자 우회 차단 | 서버 `ENABLE_DEV_ROLE_SIMULATION=false`, 배포 워크플로가 더 이상 true 로 강제하지 않음, 프론트 `VITE_ENABLE_ROLE_SIM` 제거. 공개 `/api/v1/dev/auth/*` → 404, 로그인 chunk에서 패널 코드 제거 확인 |
| DEBUG/로그 | 서버·코드 기본값 `DEBUG=false`(SQL echo=바인드 파라미터 로그 중단), journald 상한 300MB·14일, `/etc/logrotate.d/mindbreeze`(cron 로그 14종 회전), SQL echo가 쌓인 syslog 삭제. **디스크 69%→51%**, 최근 SQL echo 라인 0 |
| 뇌파 원본 | `eeg_raw_retention_days`(기본 0=무기한)로 만료 삭제 비활성(D5). 고아 pending/failed 정리는 유지. 음성·영상 90일 유지 |
| 헬스체크 | `/health/live`, `/health/ready`(DB·Redis, 실패 시 503·오류 상세 비노출). 배포 내부/공개 점검이 ready 사용 |
| 설정 안전장치 | `ENVIRONMENT=production` 명시 시 dev 주소·DEBUG·역할 시뮬레이션이면 기동 중단(`production_config_problems`). 업로드 실패 엄격화를 "실자격증명 존재"로 확장. LiveKit URL을 API 주소에서 유도(하드코딩 제거) |
| 배포 | `workflow_dispatch` 추가, 번들에 logrotate 포함, **롤백 상대경로 버그 수정**(`cd $BASE`) |
| AWS | RDS 삭제방지 ON, 백업 7→14일, 수동 스냅샷 `mindbreeze-dev-pre-envsplit-20261010`, SNS `mindbreeze-alerts` + 경보 5개(RDS 저장공간·CPU·커넥션, EC2 상태점검·CPU) |
| 서버 | 배포 잔재 tar 7개를 S3(`mindbreeze-dev/_server-archive-20261010/`)에 업로드·크기 검증 후 삭제 |
| Git | `archive/main-20260605` 보존 태그 |

## Test Results
- ✅ TS3~TS6 `backend/tests/test_phase0_hardening.py` 신규 + 기존 수정 1건, **backend 전체 1704 passed / 12 skipped / 실패 0**
- ✅ TS7 `frontend/tests/livekit-url.test.ts` 4건, `tsc -b`·`npm run build` 통과
- ✅ TS1 배포(`3e21b819`) 후 공개 주소: `/health/ready` 200(DB·Redis ok), `/api/v1/dev/auth/users` 404
- ✅ TS2 서버 `DEBUG=false`, 최근 2분 SQL echo 0, 디스크 51%
- ✅ TS8 RDS `DeletionProtection=true`·`BackupRetentionPeriod=14`, 경보 5개 생성(초기 INSUFFICIENT_DATA는 정상)
- ✅ 최근 10분 백엔드 ERROR/Traceback 0건

## Debugging Journey
- 1차 배포 실패: 번들 파일 목록에 logrotate 설정이 없어 `cp` 실패 → 롤백 트랩 발동 → **롤백 자체가 상대경로 오류로 복원 실패**(코드는 새 버전 유지, 서비스 정상). 번들 목록 추가 + 롤백에 `cd "$BASE"` 추가, 서버에 생긴 `backend/dist` 잔재 삭제 후 재배포 성공.
- S3 보관 업로드 실패: 버킷명을 `looxid-las`로 잘못 사용(실제는 계정/프로파일 이름). 실제 버킷은 `mindbreeze-dev`(서버 `S3_BUCKET`) — 이후 업로드·검증·삭제 성공(삭제는 7/7 크기 일치 후에만 수행).

## 새로 확인된 사실 (기획서 반영)
- 유일한 `platform_admin`이 개발용 계정(auth_provider=dev, 무작위 비밀번호) → **차단 후 관리자 화면 접근 불가**. 승계 방법 결정 필요.
- `/dev/auth` 접근 이력(보관된 nginx 로그): 사용자 목록 조회·로그인 호출이 6개 IP에서 발생(팀 사용으로 추정 — 확인 필요). **계정 생성 호출(POST /dev/auth/users)은 0건**, 전체 계정 12개·최근 7일 신규 0.
- S3: 버킷은 `mindbreeze-dev` 단일(+`mindbreeze-dev-frontend`), **prod 버킷/접두사 없음** — 기획서 A10(접두사 공유) 정정.

## Notes for Reviewer / 미완료(후속)
- SNS 이메일 구독 **확인 메일의 링크를 눌러야** 경보 메일이 옵니다(brian.chae@looxidlabs.com).
- Telegram 알림·외부 업타임 감시·CloudWatch 에이전트(디스크/메모리 지표)는 계정·봇 준비가 필요해 Phase 4로 이월. 배포의 CI 통과 의존·브랜치 보호는 CI 복구(Phase 1) 후.
- 기존 syslog 삭제로 과거 SQL 로그(개인정보 포함 가능)는 제거됨. auth.log 등은 유지.
