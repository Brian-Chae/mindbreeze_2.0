# SDD-265 — 데이터 현황 숫자 중심 상황판(안 3-A) 재설계

- 상태: Stage ① Spec 확정판 (대표 결정 2026-11-01: 3-A 상황판형)
- 브랜치: `sdd/265-upload-status-redesign` (SDD-264 BE 위에 스택)
- 정본 시안: `designs/sdd-265-upload-status-redesign-v2/안3-A.html`
- 선행 계약: SDD-261(회차 상세) · 263(목록) · 264(총량 대비 진행) — 모두 **불변**, 이 SDD 는 **가산만** 한다.

## 1. 왜

현행 데이터 현황 화면은 회차 수·참여자 수만큼 세로로 길어지고, 상태 숫자를 해독해야 "누가 무엇을 하나"가 보인다. 대표 결정은 **숫자로 한눈에**다.
정상 여부 · 참여자 도착 N/M명 · 데이터 크기 · 총 측정 길이(+참여자 합계 시간) · 전송 현황 % · 마지막 도착. 확인할 곳을 먼저, 정상은 접는다. 목록은 최근 10건씩 페이지.

## 2. 범위

| 구분 | 내용 |
|---|---|
| BE 포함 | ① 목록 API cursor 페이지네이션 ② `needs_attention_only` 사전 필터 ③ 회차·참여자 **데이터 크기**(도착/추정 기대) ④ **측정 길이**(회차)·참여자 합계 분 ⑤ 참여자 도착 N/M ⑥ 회원 본인용 목록 API 신설 ⑦ 회차 상세에 같은 가산 필드 |
| BE 제외 | 폰 보고(SDD-264)·기존 필드 의미 변경·알림/메일 발송·신규 테이블/마이그레이션 |
| FE | 별도 트랙(`contract.md` 기준 어댑터 1곳) |

## 3. 결정

| # | 결정 | 이유 |
|---|---|---|
| D1 | cursor = 정렬 키 `(그룹, 유효시각 desc, id asc)` 의 불투명 토큰. offset 사용 안 함 | 3초 폴링 중 목록이 변해도 행이 밀리지 않음 |
| D2 | `limit` 기본값은 **30 유지**(SDD-263 호환). FE 는 `limit=10` 을 명시 | 기존 클라이언트·테스트 회귀 0 |
| D3 | `status` 필터(기존)는 "후보 N개 안 사후 필터" 의미 **그대로**. 새 `needs_attention_only=true` 는 페이지 선정 시 **앞으로 더 스캔**해 limit 을 채움(1요청 최대 4배치×50회차 스캔) | 확인할 곳이 11번째 이후에 있어도 첫 화면에 올라옴 |
| D4 | `bytes_arrived` = 서버에 `uploaded` 인 `eeg_raw_chunks.size_bytes` + `biosignal_artifacts.size_bytes` 합(NULL=0) | 실제 저장된 용량 |
| D5 | `bytes_expected` = 신호별 도착 평균 청크 크기 × 보고 기대 청크 + 분석 데이터 용량 × (기대 창/도착 창). 근거 부족·보고 미완이면 **null**. 항상 `bytes_basis:"estimate"` 로 추정임을 표시 | 모르면 모른다고 한다. FE 는 "약" 접두 |
| D6 | `duration_min` = `ended_at − started_at`(분, 반올림), 진행 중이면 `as_of − started_at`. 시작 없음·종료 시각 없는 완료 회차 → null | 회차 길이. 계획 길이(`sessions.duration_min`)와 다름 |
| D7 | `participant_minutes_total` = 참여자별 서버 도착 분석 데이터 창 수(1창=1초) 합 ÷ 60, 분 단위 내림. 회원용은 본인 값 | 측정 길이를 서버 기록으로만 계산 |
| D8 | 참여자 도착 = 수집 대상(excluded 제외)이면서 분석 데이터 또는 측정 기록 파일이 1건 이상 서버에 도착한 사람. `participants_expected` = `participants − excluded` | "도착 N/M명" |
| D9 | 회원용 `GET /upload-status/me/sessions` 신설(본인 `SessionParticipant.user_id` 회차만, 같은 cursor) | 현재 회원 화면은 회차당 summary 2회 호출 — 10회차 20회 호출 방지 |
| D10 | 응답 어디에도 점수·종합점수·좋음/나쁨·보증·완료 값 없음. 미착용·마이크 OFF = 수집 제외(문제 아님) | AGENTS.md 리포트 원칙 |

## 4. 비기능

- SQL 횟수는 회차·참여자 수와 무관한 상수. 목록(캐시 미스): 후보 1 + 참여자 1 + feature 1 + raw 1 + 기대량 1 + 산출물 1 = **6**(+HTTP 인증 1). `needs_attention_only` 는 배치 수(≤4)×6.
- 304/ETag 유지(새 필드 포함, `as_of`·cursor 토큰 제외 아닌 `items`·`next_cursor` 포함). 회차별 캐시 TTL 규칙(2s/10s/300s) 준수.
- 신규 DB 컬럼·인덱스 없음. 정렬 키 조회는 기존 `sessions` 인덱스로 처리(PG 실측은 impl-notes).

## 5. 수용 기준

verify.md 의 V-R 전 항목 통과, SDD-260/261/263/264 BE 테스트 회귀 0, PG 실DB 시험에서 독립 SUM/COUNT 와 일치.
