# SDD-169 — 하(하) 인프라 3건 요약

## 구현 결과

3건 완료 + 시크릿 교체.

| 영역 | 변경 |
|---|---|
| role sim | .env.dev 키 명시·배포 주입 |
| DB | psycopg2 통일 |
| docker | celery 서비스 4종 추가 |
| 보안 | 템플릿 Resend 키 placeholder + .gitignore negate 수정 |

## 검증

- 백엔드 `pytest -q` **1213 passed / 12 skipped / 0 failed**
- docker compose config OK
