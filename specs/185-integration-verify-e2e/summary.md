# SDD-185 — 통합 검증 E2E: 오디오 0개 → manual 정규화 요약

## 구현 결과

- `stt_task.py` G5 가드: 오디오 0개 → `manual` 마킹 + emit_status `manual`
- `test_sdd085_manual_mode.py::test_07`: `manual` 단언으로 갱신

## 검증

- backend `pytest` **1379 passed / 12 skipped / 0 failed**
