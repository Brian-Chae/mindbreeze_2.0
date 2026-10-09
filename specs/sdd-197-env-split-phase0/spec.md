# [SDD-197] 환경 분리 Phase 0 — 즉시 방어

> 기획: `docs/개발운영_환경분리_기획.md` v1.1 §3 Phase 0 / Brian 승인(2026-10-10): 전부 클라우드(원안 A), D3~D6 확정, 나머지 추천안 동의

## Goal
실서비스 중인 dev 서버의 즉시 위험(관리자 우회·디버그 로그·삭제 정책·무보호 DB)을 비용 0·사용자 영향 없이 제거하고, 이후 운영 분리(Phase 1~)의 안전 기반을 만든다.

## Context
- 실사용자가 dev를 쓴다. 이번 점검에서 확인된 즉시 위험: ①역할 시뮬레이션 라우터(무인증 사용자 목록·계정 생성·무비번 로그인)가 켜져 있음 ②`DEBUG=true`로 모든 SQL(바인드 파라미터 포함)이 syslog/journal에 기록(약 3GB, 디스크 69%) ③뇌파 원본 90일 삭제 cron(D5: 영구 보관 결정과 충돌) ④RDS 삭제방지·충분한 백업 없음 ⑤`/health`가 DB·Redis 미점검.

## Scope
### ✅ In-scope
1. 역할 시뮬레이션 차단: 서버 `ENABLE_DEV_ROLE_SIMULATION=false`, 배포 워크플로가 이를 강제 true로 되돌리지 않게 수정, 프론트 `VITE_ENABLE_ROLE_SIM` 제거.
2. `DEBUG=false` (서버) + 코드 기본값 `debug=False`. SQL 로그 3GB 정리(journal 상한, syslog 회전), logrotate 설정을 저장소에 포함.
3. 뇌파 원본 보관: 만료 삭제 비활성(설정 `EEG_RAW_RETENTION_DAYS=0`=무기한, 기본값). pending/failed 고아 정리는 유지. 음성·영상 90일 유지.
4. `/health/live`·`/health/ready`(DB·Redis 점검) 추가, 배포 후 점검이 ready 사용.
5. 설정 안전장치: 운영 환경(ENVIRONMENT=production)에서 dev 주소·필수값 누락 시 기동 중단. 업로드 실패 엄격화를 "실자격증명 존재"로 확장. LiveKit 기본 URL을 API 주소에서 유도.
6. 배포 워크플로: `workflow_dispatch` 추가(수동 재배포).
7. AWS(읽기/저위험 변경): RDS 삭제방지 ON·자동백업 14일·수동 스냅샷, RDS·EC2 기본 경보(SNS 이메일).
8. 서버 디스크 정리(배포 잔재 tar → S3 보관 후 삭제).
9. `main` 보존 태그.

### ❌ Out-of-scope (후속 Phase)
배포의 CI 통과 의존·브랜치 보호(Phase 1: CI 복구 후), Telegram 알림·외부 업타임·CloudWatch 에이전트(Phase 4: 계정/봇 필요), prod 인프라, 컷오버.

## Acceptance Criteria
- [ ] 공개 주소 `/api/v1/dev/auth/*` 404, 로그인 화면에 역할 시뮬레이션 패널 없음
- [ ] 서버 `DEBUG=false`, 신규 syslog에 SQL 로그 없음, `/var/log`+journal 용량 감소
- [ ] 뇌파 정리 스윕이 보관기간 경과 업로드분을 삭제하지 않음(테스트), 고아 정리는 동작
- [ ] `/health/ready` 200(정상)/503(DB 또는 Redis 불가), 기존 `/health` 호환
- [ ] production 환경 + dev 주소 → 기동 실패(테스트)
- [ ] RDS 삭제방지·백업 14일·스냅샷 확인, 경보 생성
- [ ] backend 전체 pytest 회귀 0, 프론트 build·tsc 통과, dev 배포 성공 + 스모크

## Risks
| 리스크 | 대응 |
|---|---|
| 유일한 platform_admin이 dev 시뮬레이션 계정 → 차단 시 관리자 화면 접근 불가 | 사전 확인 후 Brian에게 승계 방법 제시(비밀번호는 채팅으로 주고받지 않음) |
| 업로드 엄격화로 S3 일시 오류가 사용자 오류로 노출 | 의도된 동작(무음 폴백 제거), 로그로 추적 |
| 로그 삭제 | 보관 가치 없는 SQL echo 로그만 정리, auth.log 유지 |
