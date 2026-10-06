# SDD-183 — 통합 검증(1축) 실결함 2건 수정 요약

## 구현 결과

2건 수정.

| 영역 | 변경 |
|---|---|
| 파이프라인 상태 | record 없음/idle → manual 마감 (idle 영구 정지 방지) |
| Gemini 전사 | maxOutputTokens 32768 (긴 한글 전사 잘림 방지) |

## 검증

- 신규 `test_mb2_integration_verify.py` 3건
- 백엔드 `pytest -q` **1379 passed / 12 skipped / 0 failed**
