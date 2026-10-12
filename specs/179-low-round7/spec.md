# SDD-179 — 하(하) 17건 (7차)

## 배경

7차 전수조사 하(하) 17건 — Celery 2 · S3 4 · 에러 6 · 테스트 1 · 프론트 API 2 · 테스트 2.

## 대상

| 군 | 건수 | 내용 |
|---|---|---|
| Celery | 2 | WS outbox 원자 선점·soft/time_limit |
| S3 | 4 | presigned 상한·stream_id 검증·key 마스킹·클라이언트 캐시 회전 |
| 에러 | 6 | 채팅/리포트/export/증빙/스윙 로깅·get_db rollback |
| 테스트(백) | 1 | 24h 스윙 wall clock 고정 |
| 프론트 API | 2 | formatErrorDetail 객체 파싱·로그아웃 세션 초기화 |
| 테스트(프) | 2 | fake timer·login-page TS 이관 |

## 검증

- 백엔드 `pytest -q` **1376 passed / 12 skipped / 0 failed**
- 프론트 tsc 0 · build ✓ 8.38s · vitest **44/323**
