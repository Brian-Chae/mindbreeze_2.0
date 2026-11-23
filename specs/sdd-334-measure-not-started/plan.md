# SDD-334 Plan

## 백엔드
- `schemas/session.py` SessionLiveMetric: `measure_not_started: bool = False`, `measure_not_started_since: datetime | None = None`.
- `services/session_service.py`
  - 순수 함수 `compute_measure_not_started(*, session_status, entered_at, started_at, has_data, eeg_consented, now, threshold_s=90)` → `since | None`.
  - `get_live_metrics`: 데이터 있는 참가자 집합(feature stats 키 ∪ raw 청크 보유자, 1쿼리) 계산 후 행에 필드 추가.
  - 상수 `MEASURE_NOT_STARTED_AFTER_SECONDS = 90`.
- 테스트 `backend/tests/test_measure_not_started.py`: 경계 89/91초, 데이터 도착 해제, 미착용(consented False) 제외, 끊김(feature 있음) 구분, 입장 전·대기 제외, 회차 비진행 제외, 시작 시각 이후 기준.

## 프런트
- `lib/api/session.ts` SessionLiveMetric: 두 필드 선택 추가.
- `live-legacy-adapter.ts` presenceOf: REST 행의 두 필드를 v2 행으로 전달.
- `host-player-case.ts`: HostParticipant `measureNotStartedSince?: string|null`, `isMeasureNotStarted(p)`, `isAbnormal`에 포함, 헬퍼 `measureNotStartedMinutes`.
- `host-live-model.ts` toHostParticipant: `row.last_eeg_at`이 있으면 해제, 아니면 서버 값.
- 카드 문구: `HostParticipantGrid`(타일)·`HostPersonParts`(1:1 큰 카드) 상태 문구.
- vitest: 모델·이상 집계·문구.

## 순서
spec→plan→verify→(TDD) BE→FE→PR→CI→머지→Deploy Dev→dev 확인.
