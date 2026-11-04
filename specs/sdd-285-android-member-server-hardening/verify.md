# SDD-285 Verify — 구현 전 QA 게이트 (Stage ③)

> 구현 전 작성. 사후 수정 금지(추가는 날짜와 사유 표기). 합격 기준은 모두 **숫자**다. 점수·종합점수·"완료/보증/100%" 표현은 신규 화면에 쓰지 않는다.

## 1. 사전 게이트
- [ ] 대표 go (spec §6-1).
- [ ] analysis.md의 묶음 C 4명 숫자(2.2절)를 다른 사람이 같은 쿼리(`queries/c1.sh`)로 재현 — 표와 일치.
- [ ] 운영 DB 쓰기 0건 확인(스냅샷/로그에 INSERT·UPDATE·DELETE 없음). 이번 조사 스크립트는 전부 `set transaction read only`.

## 2. 단위·통합 테스트 (pytest, `backend/tests`)

| ID | 대상 | 시나리오 | 합격 |
|---|---|---|---|
| V-S1-1 | 종료 정산 | artifact(feature) 행 N개, DB 0건 → 정산 실행 | `eeg_feature_windows` N행 생성, `ingest_path='artifact_reconcile'`, play_group_id=참가자 stream.id |
| V-S1-2 | 멱등 | 정산 2회 연속 실행 | 2회차 추가 행 0, 중복 오류 0 |
| V-S1-3 | 정상자 영향 | DB가 이미 3,980행인 참가자 | 변경 0행 |
| V-S1-4 | stream 없는 참가자 | `capture_stream` 0개 + artifact 있음 | 적재 0행, 경고 로그 1줄, 예외 없음 |
| V-S1-5 | 해시 충돌 | 같은 (stream, sequence)에 다른 feature_hash | 기존 보존, 충돌 건수 로그 |
| V-S1-6 | 드라이런 | `dry_run=True` | DB 쓰기 0, 적재 예정 건수만 반환 |
| V-S2-1 | capture.start 교착 | 핸들러에서 `DeadlockDetected` 주입 | ACK `retryable`(committed:false) 반환, 예외 미전파 |
| V-S2-2 | 재시도 후 성공 | 같은 command_id 재전송 | 정확히 1개 stream 생성, 중복 generation 없음 |
| V-S2-3 | 락 순서 | 동일 session에 30명 동시 `capture.start` | 교착 0건(Postgres 로그), 30개 stream |
| V-S4-1 | log_truncated | 재구축 직후 상태(stream 이력 없음)에서 `publish_pending` | `ReplayUnavailable` 전파 0, 60초 내 경고 ≤ 1줄 |
| V-S4-2 | 방송 누락 방지 | S4 적용 후 host/member 화면 | heartbeat 후 상태 일치(스냅샷 비교) |
| V-S5-1 | 로깅 | `features/batch` 1회 호출 | journald/stdout에 `[ingest-batch]` 1줄 |
| V-S6-1 | 플랫폼 기록 | 안드로이드/ios/web 헤더로 입장 | 참가자 행에 platform·app_build 저장, 헤더 없으면 null(오류 없음) |
| V-S8-1 | 403 사유 | 대기열/동의거부 참가자 presign | 본문에 구분 코드 포함, 기존 status 유지 |

## 3. 회귀
- [ ] `cd backend && pytest` 전체 통과(기존 실패 목록은 기준선 대비 증가 0).
- [ ] `features/batch` 정상 경로(3개 이상 stream) 저장 건수 변화 0.
- [ ] 비회원(코드 입장) 경로 기존 테스트 통과(이번 행사 범위 아님이나 깨지면 안 됨).

## 4. 원인 확정 시험 (dev 재현, T0-2) — 4-R
목표: 묶음 C와 같은 상태(소켓 열림 + `capture.start` 서버 적용 + 앱 `streamId==null`)를 재현.
1. dev 회차 1개, 회원 1명, 앱(또는 앱과 같은 프로토콜의 테스트 클라이언트)로 입장·동의·밴드 모의 데이터 송신.
2. 서버에서 `capture.start` 핸들러가 commit 후 ACK 직전에 예외(교착 주입) → 클라이언트는 ACK 못 받음.
3. 클라이언트 재시도(같은 command_id)가 정상 응답을 받아도 `adoptCaptureResult`가 stream을 채택하는지 확인. 소켓을 닫지 않은 채 5분 관찰.
4. 관찰: `capture.renew`/`device.changed` 발생 여부, `features/batch` 전송 여부, 앱 `outbox.log`의 귀속 전 창 수.
합격(=원인 확정): 4명 증상(ledger `applied` 1건, renew 0, device 2건, 분석 0)이 재현되거나, 재현되지 않으면 "교착만으로는 설명 불가"로 analysis.md에 기록. 어느 쪽이든 결과를 기록해야 게이트 통과.

## 5. 40명 회원 경로 부하 시험 (dev, 합격 기준)
시나리오: 가입 → 모든 동의 → 대기실에서 밴드 연결(모의) → 클래스 시작 → 20분 측정 → 종료.
- 규모: 회원 40명 동시. 입장은 10초 안에 몰리게(11/4과 같은 폭주 재현), 이후 정상 측정. 기존 부하 자산(SDD-283) 재사용 가능 여부 먼저 확인.
- 합격 기준:
  1. **분석 DB 저장률 ≥ 99%** (각 참가자 `eeg_feature_windows` 건수 ÷ 앱이 생성한 창 수, 40명 평균·최저 모두 99% 이상. 정산 S1 실행 전 값과 후 값 모두 기록).
  2. **분석 0건 참가자 = 0명.** 1명이라도 있으면 불합격.
  3. `capture.start` 실패/거절(`session_ended` 제외) 0건, 교착 로그 0건.
  4. ACK 평균 지연(start→applied) p95 ≤ 3초.
  5. `ReplayUnavailable` 로그 ≤ 5건/시간, `TimeoutError`(방송) ≤ 20건/분.
  6. 5xx 0건, `features/batch` 200 비율 ≥ 99.5%.
  7. 40명 모두 `band_connected` 서버 값과 실제(모의) 연결 상태 일치.
  8. 정산 실행 시간: 40명 기준 종료 후 3분 이내 완료.
- 불합격 시: 실패 사례별 원인(확정/가설/모름) 기록 후 재시험. 합격 전 운영 배포 금지.

## 6. 운영 사후 점검 (배포 후, 읽기 전용)
- [ ] `queries/c1.sh` 형태 조회로 첫 리허설 회차에서 "stream 있는데 분석 0건" 참가자 0명.
- [ ] `[ingest-batch]` 로그가 실제로 쌓이는지 시간당 건수 확인.
- [ ] 교착 로그(`DeadlockDetected`) 0건.

## 7. 승인 게이트
- S1 최초 운영 쓰기: 드라이런 결과(건수·대상 참가자) 대표 확인 후 별도 승인. RDS 스냅샷 선행, 롤백 = `ingest_path='artifact_reconcile'` 행 삭제 쿼리 문서화.
- 앱 수정: T0-1 또는 4-R로 앱 상태 꼬임이 확정된 경우에만 대표 승인 요청(금요일 전 심사 1회).
