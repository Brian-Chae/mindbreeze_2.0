# SDD-169 — 하(하) 인프라 3건 (5차)

## 배경

5차 전수조사 하(하) 인프라 3건 — role simulation 불일치, DB 드라이버, docker Celery.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | INFRA-12 | VITE_ENABLE_ROLE_SIM 불일치 |
| 2 | INFRA-13 | asyncpg/psycopg2 불일치 |
| 3 | INFRA-14 | docker-compose Celery 부재 |

## 구현

- INFRA-12: .env.dev에 ENVIRONMENT/ENABLE_DEV_ROLE_SIMULATION 명시 + 배포 주입.
- INFRA-13: 템플릿 URL psycopg2 통일.
- INFRA-14: docker-compose에 worker/email-worker/export-worker/beat 추가.

## 부수

- .env.prod.template에 평문 Resend API 키 발견 → placeholder 교체 + .gitignore 템플릿 negate 버그 수정(추적 복구).
