# SDD-176 — 중(중) 백엔드 17건 (7차)

## 배경

7차 전수조사 중(중) 백엔드 17건 — Celery 3 · S3 7 · 에러/로깅 7.

## 대상

| 군 | 건수 | 내용 |
|---|---|---|
| Celery | 3 | outbox 행단위 commit·autoretry 실효·watchdog 승인게이트 |
| S3 | 7 | 유니크 충돌 정리·병합 원본 정리·endpoint_url·dev 스텁·스트리밍·청크 검증·prod 폴백 제거 |
| 에러 | 7 | 예외 삼킴·WS guard·OAuth 5xx·업로드 상한·병합 실패·전역 핸들러 |
