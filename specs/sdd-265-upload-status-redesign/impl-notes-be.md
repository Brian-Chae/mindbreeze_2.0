# SDD-265 — BE 구현 노트

계약 정본: `contract.md`. 기존 SDD-261/263/264 필드·의미는 불변(가산만).

## 변경 파일

| 파일 | 내용 |
|---|---|
| `app/services/upload_metrics_service.py` (신규) | 길이·바이트 추정·도착 인원 순수 계산, 크기 UNION ALL 1쿼리, cursor 코덱 |
| `app/services/upload_status_overview_service.py` | keyset 후보 쿼리, `limit+1` has_more, `needs_attention_only` 배치 스캔, 항목 7필드, 캐시 키 `(session_id, user_id)` |
| `app/services/upload_status_service.py` | 상세 7필드 + 참여자 `bytes_arrived`/`measured_min`, ETag 에 도착 바이트 지문 |
| `app/services/upload_member_service.py` (신규) | 회원 본인 목록 |
| `app/schemas/*`, `app/api/v1/upload_status.py` | 응답 필드·`cursor`/`needs_attention_only`·`/me/sessions` |

## 계획과 달라진 점

| 항목 | 계획 | 실제 | 이유 |
|---|---|---|---|
| 바이트 쿼리 | UNION ALL 1쿼리 | 동일 | — |
| 목록 SQL 횟수 | 6 | 6(후보1+참여자+feature+raw+기대량+크기) | SDD-264 시험의 상한 5→6 갱신 |
| 분석 데이터 용량 | `biosignal_artifacts(kind='feature')` | 동일. 기대 추정은 artifact `row_count`(창 수) 평균 사용 | 분석 데이터 파일 1개가 여러 창을 담음 |
| 도착 인원 분모 | 계획 `participants − excluded` | 동일(excluded = SDD-261 status) | 데이터가 이미 도착한 뒤 동의 철회한 사람은 분모에 남고 도착으로 센다 |
| 회원 `status` | 4값 | 수집 제외는 `no_data` + `collection_state=excluded` | 4값 배지에 excluded 없음, FE 는 `collection_state` 로 구분 |
| cursor 서명 | 없음 | 없음(권한은 매 요청 재평가) | 위조해도 자기 권한 범위 안 위치 이동뿐 |

## 시험 결과 (실제 출력)

| 묶음 | 결과 |
|---|---|
| `tests/sdd265` (SQLite) | V-R01~R46 대응 시험 통과 |
| `tests/sdd265/test_overview_pg.py` (PG16 임시 DB, 50회차×40명) | 7 passed, 50회차 목록 p95 0.92~1.17s(<1.5s) |
| 회귀 `sdd260`+`sdd264`+`test_upload_status*` | 253 passed, 20 skipped(PG 전용) |

## 한계·위험

| 항목 | 내용 |
|---|---|
| `bytes_expected` | 도착 청크 평균 × 기대 청크 추정. 신호별 크기가 균일하지 않으면 오차 가능 → `bytes_basis:"estimate"` 고정, FE 는 "약" 표기 |
| `needs_attention_only` | 1요청 최대 200 회차 스캔. 상한 도달 시 `scan_limited:true` + `next_cursor` |
| 인덱스 | 신규 인덱스·마이그레이션 없음. 정렬 키는 `coalesce(started_at, scheduled_at, created_at)` 표현식이라 후보가 수천 회차를 넘으면 느려질 수 있음(현 규모 PG 실측 p95 1.2s, 제안만: 표현식 인덱스) |
| 미확인 | dev 서버 실제 응답·실기기. 운영 규모 실측 |
