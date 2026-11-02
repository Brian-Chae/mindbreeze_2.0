# SDD-275 — 비회원 웹 측정 기대량 보고 누락 수정

- 상태: Stage ① Spec
- 브랜치: `sdd/275-guest-expected-report`
- 작성일: 2026-11-02

## 1. 증상 (운영 11/2 19:20~19:35)
- 클래스 종료 후 회차 데이터 현황에 비회원 2명이 "집계 대기·전송 중"으로 남는다.
- 운영 DB 집계: 최근 8시간 비회원 9명 중 `session_ingest_expected` 보고 0명(회원 6/6). 분석 데이터·원시 청크는 서버에 정상 도착 → "도착"은 되나 폰의 "내가 만든 총량" 보고(PUT /sessions/{sid}/ingest-expected)가 한 번도 안 감.

## 2. 원인 (코드로 확정, 근거는 plan.md §1)
| # | 원인 | 영향 |
|---|---|---|
| R1 | 웹 측정 feature outbox가 운영에서 **메모리 저장소**(`MemoryOutboxStore`)로 만들어진다(`CaptureController.makeOutbox`가 `outboxStore`를 안 넘김 — 주입은 시험 코드에서만). 앱 셸 훅은 IndexedDB(`IdbOutboxStore.listScopes()`)만 훑으므로 웹 scope를 영원히 못 본다 | 게스트 + 브라우저 회원 모두 보고 0건. 복구 스윕(SDD-260)도 웹 scope를 못 봄 |
| R2 | 웹 경로는 feature 총량만 관측하고 원시(raw) 총량은 항상 생략 → 서버 규칙 `any(raw is None) → expected_unknown`(`upload_progress_service.py:157`) | R1을 고쳐도 "집계 대기"가 남음 |
| R3 | 게스트 입장 자격이 `sessionStorage`에만 있음 → 탭/앱 종료·"홈으로"(`clearEntry`)·24시간 만료 뒤에는 `resolveExpectedAuth`가 null | 화면 이탈·앱 종료 뒤 보류 값을 영영 못 보냄 |

## 3. 범위
- 웹 경로(비회원 + 브라우저 회원)의 기대량 보고를 정상화한다: feature 총량 + raw 3신호 총량 + final.
- 입장 자격을 보고 레코드에 함께 영속해 화면 이탈·앱 재실행 뒤에도 보고를 마친다(자격 만료 전까지).
- 네이티브 회원 경로, 서버 계약·판정(`upload_progress_service`, `upload_status_service`), ingest·저장 로직은 변경하지 않는다(additive만).

## 4. 비범위
- 운영에 이미 남은 지난 회차 소급(폰이 다시 열려야 보고 가능) — 하지 않음.
- 네이티브(Android/iOS) 수정 — 불필요(JS 번들만으로 해결, plan.md §5).
- 원시 청크 미업로드 복구 sweeper 신설 — 원인 추정만 보고(plan.md §4).

## 5. 금지 표현
점수·좋음/나쁨·완료·100% 단정 문구 신규 추가 금지(UI 문구 변경 없음).
