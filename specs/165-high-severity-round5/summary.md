# SDD-165 — 상(상) 5건 요약

## 구현 결과

5건 완료.

| ID | 변경 |
|---|---|
| EEG-RAW-02 | ack S3 HEAD 검증 + failed 마킹 |
| EEG-RAW-01 | 서명 실패 예외 전파 |
| INFRA-01 | export-worker 배포 설치 |
| INFRA-06 | backend/.env 추적 제거 |
| EEG-QRY-01 | created_at 복합 인덱스 |

## 검증

- 백엔드 `pytest -q` **1169 passed / 12 skipped / 0 failed**
- alembic head `e036a0000032` 단일

## 잔여

- INFRA-06 시크릿 순환(SECRET_KEY·RESEND 키 재발급)은 사용자 확인 후 별도 진행.
