# SDD-264 — Verify (Stage ③, 구현 전 QA 체크리스트)

- 구현 전 작성. 사후 수정은 "추가"만 허용(삭제·완화 금지). 각 항목은 자동 시험(T) 또는 실기/수동(M) 중 검증 방식을 표기.
- 약어: BE=backend pytest, PG=임시 PostgreSQL(`PG_SMOKE=1`), FE=vitest/tsc, M=수동·실기.

## A. 정확성 (독립 COUNT 대조)

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-X1 | 참여자 1명, 기대 feature=100, DB feature 행 60 | 응답 `feature.received=60`, `expected=100`, 독립 `SELECT count(*)` 와 일치 | PG |
| V-X2 | 원시 EEG 기대 50 / DB `uploaded` 30, `pending` 10, `failed` 2 | `raw.signals[eeg].expected=50`, `uploaded=30`(pending/failed 는 수신으로 세지 않음) | PG |
| V-X3 | 신호 3종 각각 다른 기대/수신 | EEG·PPG·ACC 부족분이 서로 섞이지 않음(신호별 독립 계산) | BE |
| V-X4 | 회차 합계: 참여자 3명(기대 100/200/0, 수신 100/150/0) | `progress.feature.expected=300`, `received_capped=250`, `percent=83.3` (독립 계산과 일치) | BE |
| V-X5 | 수신이 기대를 초과(A 120/100, B 50/100) | A 는 `min(120,100)=100` 으로 상한 → 합계 `150/200 = 75.0`, 초과가 B 의 부족을 가리지 않음 | BE |
| V-X6 | 기대=수신=전부, final=true | `state=all_received`, 합계 `percent=100.0` | BE |
| V-X7 | 수신 999/1000 | `percent=99.9`(내림, 100.0 아님), `all_received` 아님 | BE |

## B. 권한 불변

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-X8 | SDD-261 권한 매트릭스(platform/org/담당·비담당 코치/타 기관/client/미인증) 전부 재실행 | 상태코드·에러 본문이 SDD-261 시험과 동일 | BE(기존 시험 회귀) |
| V-X9 | SDD-263 권한 매트릭스 재실행 | 동일, 비담당 코치 빈 목록 | BE(회귀) |
| V-X10 | 보고 엔드포인트: 호스트(상담사)가 참여자 대리 보고 | 403 | BE |
| V-X11 | 보고: 타인 participant_id / 입장 자격 불일치 / 자격 없이 participant_id 만 | 403 / 403 / 401 | BE |
| V-X12 | 보고: 대기열 참여자, EEG 수집 거부 참여자 | 403, 403 `EEG_CONSENT_REQUIRED` | BE |
| V-X13 | 응답에 새 개인정보 없음 | 추가된 키 전부 정수/불리언/시각/enum | BE(스키마 열거 단정) |

## C. 기대량 단조 · 멱등

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-X14 | 같은 보고 2회 | 둘 다 200, 2번째 `changed=false`, 행 1개 | BE |
| V-X15 | 낮은 값 재보고(feature 100→80) | 저장값 100 유지, `ignored=["feature"]` | BE |
| V-X16 | 일부 필드만 증가(feature 100→120, eeg 50→40) | feature=120, eeg=50 유지, `ignored=["eeg"]` | BE |
| V-X17 | 뒤처진 보고의 `final=true` | `final` 채택 안 됨(저장 false 유지) | BE |
| V-X18 | final 확정 후 이어올림으로 총량 증가 + `final=true` 재보고 | 값 증가, `final=true` 유지·갱신 | BE |
| V-X19 | 동시 20회 동일 보고(스레드) | 행 1개, 5xx 0건 | PG |
| V-X20 | 동시에 서로 다른 값 보고 | 최종값 = 최댓값(필드별) | PG |
| V-X21 | 음수/비정수/상한 초과(>10,000,000)/알 수 없는 필드/필드 누락 | 422 `invalid_message`+`field` | BE |
| V-X22 | 종료된(completed) 회차에 보고 | 200(사후 전송 허용) | BE |

## D. 미보고 · 미착용 · opt-out

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-X23 | 보고 없음 + 수신 있음 | `state=expected_unknown`, 수신량만, `expected=null` | BE |
| V-X24 | 기대량 미확인 참여자가 있는 회차 합계 | 분모에서 제외되지 않고 `participants.expected_unknown=K` 로 별도 집계 | BE |
| V-X25 | 마이크 OFF/EEG 수집 거부(excluded) + 수신 0 | `state=not_collected`, 분모·`expected_unknown` 어느 쪽에도 안 셈 | BE |
| V-X26 | excluded 인데 수신 기록 있음 | `not_collected` 아님(판정 계속), 기존 `collection_excluded_now` 사유 유지 | BE |
| V-X27 | 보고된 기대량이 0/0/0/0 (착용 안 함) | 분모 0 기여, `all_received`(final 시), 합계 `percent=null`(0 나누기 없음) | BE |
| V-X28 | 회차 전체 기대합 0 | `percent=null`, 응답 500 아님 | BE |

## E. 비정상 종료 · 이어올림 · 시간

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-X29 | 회차 종료 30분 경과 + `final=false` | `expected_unknown`(완료 단정 금지) | BE(시계 주입) |
| V-X30 | 부족분 있고 수신이 120초 이상 멈춤 | `needs_attention`; 수신 진행 중이면 `in_progress` | BE(시계 주입) |
| V-X31 | 수신 0 + 보고 후 120초 경과 | `needs_attention`(정체) | BE |
| V-X32 | 앱 강제종료 → 재기동 이어올림 → 총량 재보고 → 수신 따라잡음 | `in_progress`→`all_received` 전이 | M(실기 QA 런북) + BE(전이 시뮬) |
| V-X33 | raw `failed>0` + 부족분 | `needs_attention`(정체 시간과 무관) | BE |

## F. 네트워크 단절 후 재전송 (FE/폰)

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-X34 | 오프라인 중 총량 증가 → 복귀 | 최신값 1건만 전송, 서버 기대량 최신 | FE |
| V-X35 | 보고 5xx/타임아웃 | full jitter 재시도, 상한 없는 무한 재시도 안 해도 다음 주기에 최신값 | FE |
| V-X36 | 401/403 | 격리(무한 재시도 금지) | FE |
| V-X37 | 값이 안 바뀐 30초 주기 | 전송 생략 | FE |
| V-X38 | `archive.counts` 에 `signals` 없음(구 네이티브) | raw 보고 생략, feature 만 보고 → 서버 `expected_unknown` 유지 | FE |

## G. 진행률 수식 · 합계 일관성

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-X39 | 상세 합계 vs 목록 `items[].progress` vs 독립 계산 | 같은 입력에서 세 값 동일(공용 `aggregate`) | BE |
| V-X40 | 참여자 `M/N`: `all_received` 인원 / (전체 활성 참여자 − `not_collected`) | 독립 계산과 일치 | BE |
| V-X41 | percent 단위·자리 | 소수 1자리, 내림, 0..100, 기대합 0 → null | BE |

## H. 금지 문구

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-X42 | API 응답 직렬화 전체에서 "점수/종합/좋음/나쁨/보증/완료" 문자열 | 0건(값·키 모두) | BE |
| V-X43 | FE 화면 텍스트 | '완료' 대신 '모두 수신', '보증'·'100% 보증' 없음, 점수·등급 없음, 0 인데 경고색 없음 | FE |

## I. 모바일 · 화면 (FE 소유, BE 는 데이터 준비 확인)

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-X44 | 390px: 상단 요약 3블록 + 진행 막대 | 가로 스크롤 없음, 막대·숫자 잘림 없음 | FE+M |
| V-X45 | 0명/0개 상태 | 중립색, 경고 아이콘 없음 | FE |
| V-X46 | 기대량 미확인 K명 | 진행률 옆에 'K명 기대량 미확인' 표시 | FE |

## J. 회귀 · 성능

| ID | 시나리오 | 기대 | 방식 |
|---|---|---|---|
| V-X47 | SDD-261 BE 시험 전체 | 기존 단정 통과(기대 미보고 상태에서 `expected=null`, `completeness="unknown"` 유지) | BE |
| V-X48 | SDD-263 BE 시험 전체 | 통과 | BE |
| V-X49 | SDD-260 `features/batch`·summary 시험 | 무변경 통과 | BE |
| V-X50 | SQL 횟수 | 상세 본문 계산 ≤ 6, 목록 본문 계산 ≤ 5, 인원·회차 수와 무관 | PG |
| V-X51 | 마이그레이션 | alembic 헤드 1개, upgrade→downgrade→upgrade 성공, 기존 테이블 무변경 | PG |
| V-X52 | ETag | 기대량만 바뀌어도 ETag 변경, 변화 없으면 동일(304) | BE |

## 완료 기준

- V-X1~V-X31, V-X33, V-X39~V-X42, V-X47~V-X52: BE 자동 시험 통과(실제 수치 보고).
- V-X34~V-X38, V-X43~V-X46: FE 트랙 시험.
- V-X32: 실기 QA 런북(`impl-notes-*.md` 에 절차) — 확인하지 못했으면 '미확인' 으로 보고.
