# SDD-185 — 통합 검증 E2E: 오디오 0개 → manual 정규화

## 원인 분석

사용자 여정 E2E(클래스 생성→초대→오픈→시작→진행→종료→리포트) 중 발견.

| 항목 | 상태 |
|---|---|
| 전과정 상태 전이 | ✅ ready→open→in_progress→completed |
| 리포트 2종 자동 발행 | ✅ counselor + client |
| **결함** | ⚠️ 마이크 부재(오디오 0개) → `session_record.status="failed"` |

**근본 원인**: `stt_task.py`의 G5 가드(청크 0개)가 `failed`로 마킹.
오디오 0개는 "처리 실패"가 아니라 "기록 없음"(마이크 오프/권한 거부)이므로,
`failed`로 표기되면 UI가 "AI 기록 처리 실패"로 오해.

리포트는 이미 `no_transcript`로 정상 발행되고 있었으므로(모순),
record 상태를 `manual`로 정규화하면 리포트가 `mic_off`(마이크 오프)로 정확히 표기된다.

## 수정

- `stt_task.py`: 오디오 0개 → `record.status="manual"` + emit_status `"manual"`
- `test_sdd085_manual_mode.py::test_07`: `failed` → `manual` 단언 갱신

## 검증

- backend `pytest` **1379 passed / 0 failed**
