# SDD-336 — Summary

## What Was Built
| File | Description |
|---|---|
| backend/app/services/measure_cause_service.py (신규) | 원인 판정(우선순위)·앱 버전 비교(1.0.1 미만/기록 없음)·배치 로더·재진입 푸시 적재 |
| backend/app/services/session_service.py, schemas/session.py | `live-metrics` 행에 `measure_issue_reason` 1필드(마이그레이션 0, 후보 있을 때만 배치 조회 4쿼리) |
| backend/process_push_outbox_cron.py | 기존 1분 cron 에서 푸시 발송 직전에 넛지 적재(신규 cron·배포 변경 0) |
| backend/app/services/report_progress_service.py | `ai_record.reason=excluded`(상담사 리포트의 공통 기록 생략)는 partial 이 아니라 ready |
| backend/app/ws/session_live_namespace.py, services/live_ingest_service.py | join 중 끊긴 소켓 KeyError 흡수, 방송 TimeoutError 는 트레이스 없는 경고 1줄 |
| frontend (api 타입·어댑터·host-live-model·host-player-case·Grid/PersonParts/SoloCard) | 원인 라벨 + 행동 안내 1줄, 거절은 라벨만(이상 집계 제외) |
| backend/tests/test_measure_cause.py, frontend/tests/sdd334-measure-not-started.test.ts | 신규 시험 |

## 라벨 판정 규칙(우선순위)
1. 앱 버전 기록 없음 또는 1.0.1 미만 → `app_update_required` "앱 업데이트 필요" / "스토어에서 앱 업데이트 후 다시 입장해 주세요". 버전 출처 = session_band_devices 최신(last_seen) → 없으면 device_tokens(웹 제외) 최신.
2. 뇌파 수집 거절(eeg_collection_consented=false) 또는 연구 동의 최신 이벤트 new_consented=false → `consent_declined` "측정 거절". 이상 집계에는 세지 않고 라벨만.
3. 입장했고 유효한 presence lease(90초 TTL)가 없음 → `app_not_in_class` "앱이 수업 화면에 없음".
4. 그 외 → `not_started` "측정 시작 안 됨"(기존).

## 푸시 조건
- 진행 중 회차, 입장 후 측정 데이터(feature·raw) 0건이고 기준 시각 + 150초 초과, 로그인 회원, 거절 아님, 푸시 알림 켬(session_started), 활성 기기 토큰 있음.
- 회차·회원당 최대 2회(첫 푸시 후 5분 간격), 측정 시작되면 대상에서 빠져 자동 중단. 중복 방지·횟수 기록 = `session_reminder_logs`(channel=`push_nudge`).
- 문구 "수업이 시작됐어요. 앱을 열어 측정을 시작해 주세요", 딥링크 `/class/{id}/enter`(기존 알림 탭 → 앱 열림).

## 조사 결과: 소켓 오류 3종·partial
- KeyError None / 'Session not found': on_join 처리 중 소켓이 끊김(engineio). 핸들러에서 흡수.
- TimeoutError: 방송 5초 대기 초과(수업 시작 직후 이벤트 루프 지연). 워터마크 미전진 → heartbeat 재방송으로 복구되는 무해 오류라 트레이스만 제거(동작 불변).
- partial: 몸돌봄 4회차 참가 47명 중 17명 리포트 제외 → 상담사 리포트에서 공통 기록(ai_record)을 `excluded`로 덮음 → 상태 판정이 partial. 결함·오류 아님(운영은 STT 미제공이라 원래도 ready 대상). 오류 메시지가 없던 이유. 판정을 ready 로 수정(내담자 제외 스텁·mic_off·low_confidence 는 기존대로 partial). 운영 DB 읽기 전용 조회로 확인: 상담사 리포트 1건 partial/`excluded`, 내담자 33건 ready.

## Test Results
- backend: 신규 16 + 관련 SDD-334·푸시·알림 outbox·리포트 진행·WS·ingest·배포 템플릿 등 약 640건 통과(0 실패).
- frontend: 신규 포함 sdd334 13건 통과, eslint 0, tsc(@capacitor 모듈 미설치 오류 제외) 0. 전체 vitest 4485 통과/28 실패 — 변경 전 기준선과 실패 목록 50개 파일 동일(공유 node_modules 에 @capacitor 미설치 등 환경 기인).

## Debugging Journey
- 이 맥에서 `venv/bin/python` shim 이 the-box-os venv 로 위임되어 pytest 가 멈춤 → uv 로 MB 전용 venv(`~/.hermes/venvs/mb-v312`) 구성.
- 넛지가 측정 중 회원에게도 나가던 문제 → feature 존재 집합을 먼저 계산해 raw 조회와 합침(시험으로 확인).

## Notes for Reviewer / 운영 배포 시 주의
- 마이그레이션 없음. 푸시는 운영 FCM 설정이 켜져 있어야 실제 발송(미설정이면 outbox 행 유지).
- 푸시 대상 판정은 서버 기준이라 구 앱(1.0.0)도 푸시는 받는다(알림 탭 → 앱 열림). 구 앱 회원은 코치 화면에 "앱 업데이트 필요"로 표시.
- 12/2 수업 전 확인: 운영 push cron(process_push_outbox) 활성, session_started 푸시 알림 기본값 켬.

## dev 실측 (Deploy Dev success, 머지 d9359891, 11/26 임시 회차·시험 계정 — 모두 종료)
- `live-metrics.measure_issue_reason`: 입장 직후 null → 100초 후 앱 버전 기록 없음 = `app_update_required` → 기기 토큰 1.0.1 등록 후 `app_not_in_class`(presence 없음). 코치 카드 렌더 캡처 = `~/.hermes/share/sdd-coach-cause/coach-card-app-not-in-class-desktop.png` (카드 "미시작 · 김하늘 · 앱이 수업 화면에 없음 · 1분째", 입장 1명·이상 1명, 점수·등급 없음).
- 푸시: 입장 후 150초 초과 시 dev cron 이 `session_reminder_logs(push_nudge, -1)` + outbox 1건("수업이 시작됐어요. 앱을 열어 측정을 시작해 주세요", 딥링크 `/class/{id}/enter`) 적재. 기기 토큰이 없을 때는 0건(정상 제외). 시험 토큰은 가짜라 실제 FCM 수신은 확인하지 못했고(발송기가 '활성 토큰 없음'으로 skipped), 적재·조건·중복 제한까지만 실측.
- 미실측: 앱 업데이트 필요·측정 거절 라벨의 실화면 캡처(단위 시험으로만 검증), 모바일 폭 캡처.
- 시험 회차 5개(SDD336-*)는 종료 상태로 dev 에 남음(완료 클래스는 삭제 불가).
