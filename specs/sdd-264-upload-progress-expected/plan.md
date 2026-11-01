# SDD-264 — Plan

- 기준: spec.md D1~D8. 마이그레이션은 BE 트랙 1명이 단독 발급(헤드 `b260c0ffee01` 이후).

## 1. 트랙 · 파일 소유

| 트랙 | 소유 경로 | 비고 |
|---|---|---|
| BE | `backend/app/models/session_ingest_expected.py`(신규), `backend/alembic/versions/<rev>_264_session_ingest_expected.py`(신규), `backend/app/schemas/upload_status.py`·`upload_status_overview.py`·`ingest_expected.py`(신규), `backend/app/services/upload_progress_service.py`(신규), `ingest_expected_service.py`(신규), 수정: `upload_status_service.py`·`upload_status_overview_service.py`, `backend/app/api/v1/session.py`(엔드포인트 1개), `backend/tests/sdd264/**` | `session.py` 는 위 함수 하나만 추가 |
| 문서 | `specs/sdd-264-upload-progress-expected/**` | BE 워커 소유 |
| FE | `frontend/src/lib/biosignal/ingest-expected-reporter.ts`(신규), `frontend/src/lib/measurement-web/**` 구독 연결, `frontend/src/components/class/upload-status-*.tsx`·`upload-overview-screen.tsx`·`components/client/my-upload-status-screen.tsx`·리포트 칩, `frontend/tests/**` | 계약은 `contract.md` 만 본다 |
| 네이티브 | `frontend/android/.../SyncStatus.kt`, `frontend/ios/MeasurementKit/.../MeasurementManager.swift` | `archive.counts` 에 `signals` additive 1건. FE 트랙이 필요 시에만 |

## 2. BE Task (TDD: 각 Task 는 RED 테스트 먼저)

| # | Task | 산출 | 검증 |
|---|---|---|---|
| B1 | 모델 + 마이그레이션 | `SessionIngestExpected`(PK participant_id, session_id idx, feature/eeg/ppg/acc int, final bool, first_reported_at, reported_at, updated_at) | alembic 헤드 1개, upgrade/downgrade, V-X* |
| B2 | 보고 서비스 | `ingest_expected_service.report()` — 락 후 `max` 병합, stale final 무시, 동시 INSERT 경합(IntegrityError→재조회), 응답 `changed/ignored` | 멱등·단조·동시 20회 |
| B3 | 엔드포인트 | `PUT /sessions/{sid}/ingest-expected` — `resolve_upload_participant(allow_completed=True)`, 본문 엄격 검증(422) | 권한 매트릭스 |
| B4 | 진행 판정 모듈 | `upload_progress_service.build_progress()` 순수 함수(상태·사유·수식) + `aggregate()`(합계·percent·K) | 표 구동 단위 시험 |
| B5 | 회차 상세 통합 | `_build_participant` 에 `expected` 인자 가산, `expected` SELECT 1회, 응답 필드 가산, ETag revision 에 지문 | SDD-261 회귀 + 신규 |
| B6 | 목록 통합 | `_summaries` 에 기대량 bulk 1회, `items[].progress`, 최상위 `progress` | SDD-263 회귀 + 신규 |
| B7 | PG 시험 | 임시 PostgreSQL(`PG_SMOKE=1`)에서 독립 COUNT 대조·쿼리 수 | 성능 수치 기록 |

순서: B1→B2→B3 (보고 경로 완성, FE 보고 개발 시작 가능) → B4 → B5 → B6 → B7. B3 완료 시점에 FE 에 알린다.

## 3. 진행 판정 구현 메모

- 입력: 참여자 행, feature 통계, raw 신호별 통계, 기대량 행, 회차 scope(status/ended_at), `as_of`.
- 상수: `STALL_SEC=120`, `FINAL_GRACE_SEC=1800`(= `POST_END_ACTIVE_SEC`).
- 수신 `received_raw[sig]` = 신호별 `uploaded` (pending/failed 는 수신 아님).
- 부족분 = `max(expected - received, 0)` 컴포넌트별.
- 합계는 순수 함수 `aggregate(list[ParticipantProgress])` — 상세·목록이 같은 함수를 쓴다(화면 간 수치 불일치 방지).

## 4. 달라질 수 있는 점 (구현 중 판단 기준)

- 기존 `feature.expected` 의 pydantic 타입 `None` 고정 → `int | None`, `expected_basis` → `"unknown" | "phone_report"`, `completeness` → `"unknown" | "all_received" | "short"`. 기존 시험의 `is None`/`"unknown"` 단정은 기대량 미보고 상태에서 그대로 참.
- `phone_report`(SDD-261 `null` 고정) → 보고가 있으면 `{reported_at, final}` 객체. 없으면 `null` 유지.

## 5. 통합 · 합류

- BE/FE/네이티브 각자 브랜치 또는 커밋 경로 분리, `sdd/264-integrate` 에서 합쳐 PR 1개(감독 소관). 이 워커는 푸시·PR·배포 안 함.
- 합류 후 `python3 scripts/check-alembic-heads.py` 헤드 1개 확인.
