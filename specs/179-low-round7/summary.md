# SDD-179 — 하(하) 17건 요약

## 구현 결과

17건 완료.

| 영역 | 변경 |
|---|---|
| Celery | FOR UPDATE SKIP LOCKED·soft/time_limit |
| S3 | presigned 600s 상한·stream_id 정규식·key 마스킹·캐시 회전 |
| 에러 | 채팅/리포트/export/증빙/스윙 로깅·get_db rollback |
| 프론트 | formatErrorDetail 객체 파싱·sessionStore.reset·fake timer·login-page TS 이관 |

## 검증

- 백엔드 `pytest -q` **1376 passed / 12 skipped / 0 failed** (신규 12건)
- 프론트 tsc 0 · build ✓ 8.38s · vitest **44/323**
