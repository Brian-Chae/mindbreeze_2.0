# SDD-175 — 상(상) 11건 (7차)

## 배경

7차 전수조사 상(상) 11건 — 세션 refresh·타임아웃, outbox 이중, 파이프라인 실패, 업로드 DoS, 고아 정리, 예외 삼킴, 테스트 보강.

## 대상

| # | ID | 이슈 | 성격 |
|---|---|---|---|
| 1 | API7-01 | refresh 실패 세션 만료 단정 | 프론트 |
| 2 | API7-02 | 타임아웃 없음 | 프론트 |
| 3 | TQ-02 | playwright 의존성 | 프론트 |
| 4 | CEL-OUTBOX-01 | 이메일 outbox 이중 | 백엔드 |
| 5 | CEL-CHAIN-01 | 리포트 autoretry·마킹 | 백엔드 |
| 6 | CEL-CHAIN-02 | published 재드라이브 | 백엔드 |
| 7 | STG-01 | 업로드 메모리·상한 | 백엔드 |
| 8 | STG-03 | 미디어 고아 스윙 | 백엔드 |
| 9 | STG-05 | 삭제 시 S3 미삭제 | 백엔드 |
| 10 | MB-ERR-001 | 태스크 등록 예외 삼킴 | 백엔드 |
| 11 | TQ-08 | OTP·로그아웃 테스트 | 백엔드 |

## 구현

- 프론트: RefreshResult 판별(invalid/network/server)·AbortController 타임아웃·playwright 의존성
- 백엔드: outbox 단일 소비자·파이프라인 재시도/재드라이브·업로드 스트리밍+상한·미디어 고아 스윙+삭제·태스크 등록 로깅·OTP/로그아웃 테스트
