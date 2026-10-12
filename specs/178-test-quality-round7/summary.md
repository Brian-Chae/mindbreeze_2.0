# SDD-178 — 중(중) 테스트 8건 요약

## 구현 결과

8건 완료. 신규 31건 테스트 추가.

| 영역 | 변경 |
|---|---|
| 픽스처 | eager 제어·Redis 격리 정밀화 |
| WS | 실제 AsyncServer 계약 검증 |
| 커버리지 | 내담자/조직/가입/OTP 경로 추가 |
| 단언 | status_code 위주에서 핵심 값 검증 보강 |

## 검증

- 백엔드 `pytest -q` **1364 passed / 12 skipped / 0 failed**
