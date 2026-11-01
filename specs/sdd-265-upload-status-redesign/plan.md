# SDD-265 — BE 구현 계획

계약 정본: `contract.md`. 기존 SDD-261/263/264 코드는 가산만 한다.

## 변경 지도

| 파일 | 변경 |
|---|---|
| `backend/app/services/upload_metrics_service.py` (신규) | 순수 계산(`duration_min`, 도착 인원, 바이트 추정, 분 환산) + 산출물/청크 바이트 일괄 조회(`load_bytes_by_session`) + cursor 인코드/디코드 |
| `backend/app/services/upload_status_overview_service.py` | `load_overview` 에 `cursor`·`needs_attention_only`, 항목에 7개 가산 필드, `next_cursor`/`has_more`/`scan_limited`, 후보 쿼리에 keyset 조건 |
| `backend/app/services/upload_status_service.py` | 상세 최상위 7필드·참여자 `bytes_arrived`/`measured_min`, ETag 지문 |
| `backend/app/services/upload_member_service.py` (신규) | 회원 본인 목록(`/me/sessions`) |
| `backend/app/schemas/upload_status_overview.py`, `upload_status.py` | 응답 필드 |
| `backend/app/api/v1/upload_status.py` | 쿼리 파라미터, `/me/sessions` 라우트 |
| `backend/tests/sdd265/` | 단위·API·PG(PG_SMOKE=1) 시험 |

## 설계

1. **keyset cursor**: 정렬 키 `(g, eff, id)` — `g`=in_progress?0:1, `eff`=coalesce(started,scheduled,created). 토큰 = base64url(JSON `[g, eff_iso, id]`)+HMAC 없음(권한은 매 요청 재평가되므로 위조해도 자기 권한 범위 안 위치 이동일 뿐). 조건: `(g,eff desc,id asc)` 튜플 비교를 `or_` 전개. `total` 은 cursor 조건 **앞** 서브쿼리로 계산하려면 윈도우 카운트가 cursor 영향을 받으므로 별도 `count(*)` 대신 CTE 로 필터 후보를 만들고 `count() over()` 는 cursor 이전 CTE, 항목은 cursor 후 조건으로 거른다(후보 쿼리 1회 유지).
2. **limit+1 조회**로 `has_more` 판정(내부 limit+1 후 잘라냄).
3. **needs_attention_only**: 배치(50) 단위로 후보→요약→배지 필터 반복, limit 도달 또는 후보 소진 또는 4배치까지. 캐시된 요약 재사용.
4. **바이트**: 청크 `sum(size_bytes) filter uploaded` per (session, participant, signal) + 산출물 `sum(size_bytes)` per (session, participant, kind) 를 두 쿼리가 아닌 **UNION ALL 1쿼리**로 가져와 회차 요약 캐시에 포함. 기대 추정은 순수 함수(`estimate_bytes_expected`).
5. **길이**: 후보 쿼리가 이미 `started_at/ended_at/status` 를 가짐. 순수 함수 `duration_minutes(started, ended, status, as_of)`.
6. **분 합계**: `_feature_bulk` 의 참여자별 `received` 합 ÷60. 추가 SQL 없음.
7. **회원**: `SessionParticipant.user_id == me` 로 회차 후보(같은 keyset), 본인 참여 행만 요약. 요약 캐시 키 `(session_id, user_id)`.
8. ETag: 새 필드 포함해 `items` 전체를 지문으로(기존 방식) — `next_cursor` 도 포함.

## 순서 (TDD)

| # | 작업 | 시험 |
|---|---|---|
| T1 | metrics 순수 함수 | `test_metrics.py` RED→GREEN |
| T2 | cursor 코덱 | `test_cursor.py` |
| T3 | 후보 keyset + has_more (SQLite) | `test_overview_page.py` |
| T4 | 바이트 일괄 조회 + 항목 필드 | `test_overview_fields.py` |
| T5 | needs_attention_only | `test_overview_filter.py` |
| T6 | 상세 가산 | `test_detail_fields.py` |
| T7 | 회원 목록 | `test_member_list.py` |
| T8 | 회귀(260/261/263/264) | 기존 스위트 |
| T9 | PG 실DB(동시성·쿼리 수·독립 SUM) | `test_overview_pg.py` PG_SMOKE=1 |
| T10 | 금지어 검사 | `test_forbidden_words.py` |

## 위험

| 위험 | 완화 |
|---|---|
| keyset OR 전개의 인덱스 비효율 | PG EXPLAIN 으로 확인, 필요 시 `effective` 표현식 인덱스는 **제안만**(마이그레이션 금지) |
| 바이트 추정 오해 | `bytes_basis:"estimate"` 고정, 기대 근거 없으면 null |
| 회원 캐시 키 폭증 | 기존 `_CACHE_MAX` 비움 규칙 재사용 |
