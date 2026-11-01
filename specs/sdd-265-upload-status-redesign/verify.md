# SDD-265 — BE 검증 시나리오 (구현 전 작성)

모든 항목은 pytest(SQLite) 또는 PG_SMOKE=1 시험으로 자동화한다. 기대값은 응답이 아니라 **독립 계산(별도 SQL/파이썬 수식)** 과 대조한다.

## A. cursor 페이지네이션

| ID | 시나리오 | 기대 |
|---|---|---|
| V-R01 | 회차 25개, `limit=10` | items 10, `has_more=true`, `next_cursor` 있음 |
| V-R02 | cursor 로 2·3번째 페이지 | 10·5개, 마지막 `has_more=false`, `next_cursor=null` |
| V-R03 | 3페이지 합집합 | 중복 0, 누락 0, 한 번에 `limit=50` 조회한 순서와 동일 |
| V-R04 | in_progress 회차가 중간 페이지 경계에 걸림 | 정렬 키(진행 중 우선) 유지, 순서 불변 |
| V-R05 | 페이지 조회 사이 새 회차 삽입(최신) | 이미 본 항목 중복 없음(offset 밀림 없음) |
| V-R06 | 동일 유효시각 회차 여러 개 | `session_id` 오름차순으로 안정, 페이지 경계에서도 중복·누락 0 |
| V-R07 | 변조·무의미 cursor | 422 `upload_status_invalid_cursor` |
| V-R08 | `total_candidates` | 모든 페이지에서 동일(cursor 무관) |
| V-R09 | `limit` 미지정 | 기본 30 유지(SDD-263 회귀) |
| V-R10 | 권한: 다른 코치의 cursor 로 접근 | 자기 권한 범위 항목만 반환(타인 회차 노출 0) |

## B. needs_attention_only

| ID | 시나리오 | 기대 |
|---|---|---|
| V-R11 | 확인 필요 회차가 전체 60개 중 8·35·55번째 | `limit=10, needs_attention_only=true` 첫 응답에 3개 모두, 나머지 회차 없음 |
| V-R12 | 확인 필요 25개, limit=10 | 10개 + `has_more`, 다음 cursor 로 10→5 |
| V-R13 | 0개 | items 빈 배열, `has_more=false` |
| V-R14 | 스캔 상한(4배치) 초과 | `scan_limited=true`, `next_cursor` 로 이어서 조회 가능 |
| V-R15 | `status` + `needs_attention_only` 동시 | 422 `upload_status_filter_conflict` |
| V-R16 | `status` 단독 | SDD-263 의미(후보 N개 내 사후 필터) 불변 |

## C. 데이터 크기

| ID | 시나리오 | 기대 |
|---|---|---|
| V-R17 | 참여자 3명 raw 청크 uploaded 합 | `bytes_arrived` = 독립 `SUM(size_bytes)` 일치 |
| V-R18 | pending/failed 청크 | 합산에서 제외 |
| V-R19 | 분석 데이터 artifact(uploaded) | 합산 포함, pending/failed 제외 |
| V-R20 | `size_bytes` NULL 청크 | 0 으로 취급, 오류 없음 |
| V-R21 | 기대 청크 보고 + 도착 평균 | `bytes_expected` = 수식과 일치, `bytes_basis="estimate"` |
| V-R22 | 기대 미보고 | `bytes_expected=null`, `bytes_basis=null` |
| V-R23 | 도착 0 바이트 | `bytes_arrived=0`, `bytes_expected=null` |
| V-R24 | 수집 제외 참여자의 도착 데이터 | 바이트 합에 포함(실제 도착), 도착 인원은 제외 |

## D. 길이·인원

| ID | 시나리오 | 기대 |
|---|---|---|
| V-R25 | 시작 10:00 종료 10:52 | `duration_min=52` |
| V-R26 | 진행 중 | `as_of − started_at` 분 |
| V-R27 | 시작 없음 | `duration_min=null` |
| V-R28 | 종료 시각 없는 완료 회차 | `null` |
| V-R29 | 참여자 3명 분석 데이터 창 3600/1800/90 | `participant_minutes_total=91`(내림 합 아님: 합계 5490초÷60) |
| V-R30 | 도착 인원/분모 | 제외 2·미도착 1·도착 N 일 때 `participants_expected=participants−excluded`, `participants_arrived` 일치 |

## E. 상세·회원

| ID | 시나리오 | 기대 |
|---|---|---|
| V-R31 | 상세 최상위 7필드 = 같은 회차의 목록 항목 값 | 일치(같은 함수) |
| V-R32 | 상세 참여자 `bytes_arrived`·`measured_min` | 독립 계산과 일치 |
| V-R33 | 상세 바이트 변화만 있어도 ETag 변경 | 변경, 같은 입력 반복은 304 |
| V-R34 | 회원 목록: 본인 참여 회차만 | 타인 회차 0, 타인 정보 0 |
| V-R35 | 회원 cursor 10→10→나머지 | V-R01~03 과 같은 성질 |
| V-R36 | 회원 `collection_state=excluded` | 반영, `status` 문제로 표기 안 함 |
| V-R37 | 회원 비로그인 | 401 |
| V-R38 | 회원 본인 `percent`/`progress_state` | SDD-264 상세의 본인 progress 와 일치 |
| V-R39 | 회원 `bytes_arrived` | 본인 청크·산출물 SUM 과 일치(타인 불포함) |

## F. 회귀·성능·표현

| ID | 시나리오 | 기대 |
|---|---|---|
| V-R40 | SDD-260/261/263/264 기존 BE 테스트 | 전부 통과(회귀 0) |
| V-R41 | 기존 필드 이름·값 | 불변(스냅샷 비교) |
| V-R42 | SQL 횟수: 목록 첫 페이지(미캐시) | 상수(≤6, 인증 제외), 회차 10→50·참여자 수 증가에도 동일 |
| V-R43 | PG 동시 20요청 | 오류 0, 값 일치 |
| V-R44 | 304: If-None-Match 일치 | 304, 헤더 4종 |
| V-R45 | 캐시 TTL | 진행 중 2s / 종료 직후 10s / 그 외 300s 유지 |
| V-R46 | 응답 JSON 문자열에 금지어 | 점수/종합점수/좋음/나쁨/보증/완료 0건(키·값, UUID 제외) |
| V-R47 | PG 대용량(회차 100·참여자 40) p95 | 50회차 p95 < 1.5s |
