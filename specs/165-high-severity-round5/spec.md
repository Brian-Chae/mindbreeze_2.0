# SDD-165 — 상(상) 5건 (5차)

## 배경

5차 전수조사 상(상) 5건 — EEG 저장 무결성, 배포 누락, 시크릿 노출, 조회 성능.

## 대상

| # | ID | 이슈 |
|---|---|---|
| 1 | EEG-RAW-02 | ack S3 검증·완료 마커 부재 |
| 2 | EEG-RAW-01 | presigned PUT 실패 스텁 폴백 |
| 3 | INFRA-01 | export 큐 워커 미설치 |
| 4 | INFRA-06 | 시크릿 평문 커밋 |
| 5 | EEG-QRY-01 | created_at 인덱스 부재 |

## 구현

- EEG-RAW-02: storage_service.verify_object(S3 HEAD) 추가, ack가 검증 실패 시 failed 마킹.
- EEG-RAW-01: 자격증명 설정 환경의 서명 실패 시 StorageSigningError 예외 전파.
- INFRA-01: deploy-dev.yml에 export-worker 설치·재시작 추가.
- INFRA-06: backend/.env git 추적 제거(git rm --cached).
- EEG-QRY-01: (session_id, participant_id, created_at) 복합 인덱스 alembic `e036a0000032`.
