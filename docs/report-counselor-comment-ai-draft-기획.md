# 데이터 없는 세션의 상담사 코멘트 + AI 초안 — 상세 기획서

> 작성일: 2026-09-20
> 상태: Draft (Brian 승인 대기)
> 관련: SDD-022(단일 content 계약), SDD-027(리포트 상태머신), SDD-029(리포트 메일), SDD-066(승인·발송 분리), SDD-085(마이크 오프), SDD-086(세션 종료 시 리포트 자동 생성)

---

## 1. 개요

- **문제**: 세션에 데이터(음성 녹음, 뇌파 EEG/PPG/ACC)가 하나도 없으면 리포트가 생성되어도 내용이 사실상 비어 있음
  - AI 요약 없음(`summary: None`), 인사이트 없음(`insights: []`), EEG 섹션 숨김(`status: "not_measured"`)
  - 상태는 `pending_review`(검토중)로 전이되지만, 승인해서 발송해도 **고객에게 전달할 실질 콘텐츠가 없음**
- **해결 방향**:
  1. 상담사가 내담자 리포트에 **직접 코멘트(전달 메시지)를 작성**
  2. **AI가 코멘트 초안을 생성**(세션 메타 기반 — 음성·뇌파 없어도 동작) → 상담사는 편집만
  3. 기존 승인 게이트 유지: 코멘트 작성 → 승인 → 발송
- **비범위(Non-goal)**:
  - 리포트 생성 파이프라인(`report_task.py`)의 EEG/STT 로직 변경
  - 상담사용(counselor) 리포트의 구조 변경 (본 기획은 내담자 전달 콘텐츠가 핵심)
  - PDF 템플릿 개편 (코멘트 섹션 추가만)

---

## 2. 현황 분석 (코드 근거)

### 2.1 리포트 생성 흐름

- 세션 종료(`action == "end"`) 시 자동 생성 — `session_service.py:377-386` (SDD-086)
  - counselor 리포트 1건: `report_service.generate_report(session_id, host_id, "counselor", db)`
  - active participant별 client 리포트: `report_service.generate_client_reports_for_session(...)`
- 생성 본체는 `backend/app/tasks/report_task.py`의 `generate_report_inline()` (`report_task.py:243-293`)
  - `_build_eeg_content()` (`report_task.py:88`): EEGFeatureWindow 없으면 `{"status": "not_measured"}` 반환 → 프론트 EEG 섹션 미노출
  - `_ai_record_block()` (`report_task.py:47-57`): transcript 없으면 `{"status": "not_available", "reason": "no_transcript"}`, 마이크 오프(manual)면 `reason: "mic_off"` (SDD-085)
  - 생성 성공 시 무조건 `report.status = "pending_review"` (`report_task.py:270`) — **데이터 유무와 무관**

### 2.2 content 구조 (데이터 없는 세션 기준)

- counselor content — `_counselor_content()` (`report_task.py:184-200`)
  - `summary: None`, `sections: None`, `markers: []`, `eeg: {"status": "not_measured"}`, `ai_record: {"status": "not_available"}`
  - `counselor_notes`: SessionRecord.counselor_notes 포함 (`report_task.py:195`) — **counselor 리포트에만 포함**
- client content — `_client_content()` (`report_task.py:203-223`)
  - `summary: None`, `insights: []`, `greeting`(고정 문구), `eeg/ai_record` 동일
  - **counselor_notes 미포함** — 현재 구조상 상담사의 글이 내담자에게 전달되는 경로가 없음
  - 그룹 세션은 공통 녹음 요약의 타 참가자 내용 유출 방지를 위해 record 자체를 제외 (`report_task.py:263-264`)

### 2.3 SessionRecord.counselor_notes

- 모델: `record.py:22` — `counselor_notes: Text | None`, 세션당 1건(unique session_id)
- 수정: `record_service.py:104-106` — PATCH 시 `edit_history`에 before/after 기록
- 성격: **세션 기록지의 상담사 내부 메모**. counselor 리포트에만 노출되고 client 리포트·발송 메일에는 나가지 않음

### 2.4 상태머신·승인·발송

- 상태머신 (SDD-027): `pending_analysis → pending_review → completed` / `error` (`record.py:159-160`)
- 승인: `report_service.approve_report()` (`report_service.py:430-470`)
  - `pending_review` 또는 `completed`(멱등)만 승인 가능. **콘텐츠 유무 검사는 없음** — 빈 리포트도 승인 자체는 이미 가능
  - 승인 시 `content["approved"] = True`, `sent_at` 스탬프, F10 알림(회원만)
  - SDD-066: **승인이 메일을 예약하지 않음** — 발송은 별도 경로
- 발송 경로 (`report_email_service.py`):
  - 내담자 요청: `request_report_email()` — completed면 발송 큐잉, `pending_review`면 "상담사 승인 후 이메일로 발송됩니다" 반환 (`report_email_service.py:96-97`)
  - 상담사 발송/재발송: `resend_report_email()` — `status == "completed"`만 허용 (`report_email_service.py:171-172`)
  - 메일 열람 HTML `view_report_email()` (`report_email_service.py:240-320`): **title/summary/insights/eeg만 렌더링** — summary 없으면 "오늘 세션에 참여해주셔서 감사합니다." 폴백, insights 없으면 "아직 등록된 인사이트가 없습니다." → 데이터 없는 세션의 메일은 사실상 빈 껍데기

### 2.5 리포트 수정 API (기존 자산)

- `PUT /api/v1/reports/{report_id}` → `update_report()` (`report_service.py:414-427`): host 권한 확인 후 **content 전체 교체**
- 프론트 `updateReport()` 함수 존재 (`frontend/src/lib/api/reports.ts:115`) — 그러나 **UI에서 미사용** (편집 화면 없음)

### 2.6 프론트 리포트 상세

- `ReportDetailView.tsx`: Cover → 상태 배지 → 서사 → AI 요약 → 인사이트 → 마커 → EEG → 액션(승인/PDF) → 메일 발송(completed 시)
  - 승인 버튼: `canApproveReport()` — `status === 'pending_review'`일 때만 (`report-status.ts:103-111`)
  - **코멘트 작성·편집 UI 없음**
- `ReportStatusBadge.tsx`: pending_review 힌트 "상담사 승인 대기 중입니다. 검수 후 승인하고 메일 발송을 진행해 주세요." (`ReportStatusBadge.tsx:66-68`)

### 2.7 LLM 호출 기존 패턴

- `_call_narrative_llm()` (`summary_task.py:29-`): Deepseek API + `NarrativeCache`(시그니처 캐시) + 규칙 폴백(`fallback_narrative`)
- 키 누락·호출 실패 시에도 예외 없이 폴백 반환 — **AI 초안도 동일 패턴(캐시 없이 폴백만) 준용 가능**

### 2.8 현황 요약 — Gap

| # | Gap | 근거 |
|---|-----|------|
| G1 | 상담사 글이 내담자 리포트·메일에 전달되는 경로 없음 | `_client_content()`에 counselor_notes 미포함, 메일 HTML에 코멘트 슬롯 없음 |
| G2 | 리포트 상세에 코멘트 작성/편집 UI 없음 | `ReportDetailView.tsx` (updateReport 미사용) |
| G3 | AI 초안 생성 기능 없음 | 해당 서비스·엔드포인트 부재 |
| G4 | 빈 리포트 승인은 가능하나, 승인해도 전달 콘텐츠가 없어 발송 의미 상실 | `view_report_email()` 폴백 문구만 노출 |

---

## 3. 요구사항 정의

### 3.1 기능 요구사항

- **FR-1 코멘트 작성**: 상담사가 client 리포트 상세에서 내담자에게 전달할 코멘트를 작성·수정할 수 있다
  - 승인 전(`pending_review`) 작성·수정 가능. 승인 후(`completed`) 수정은 v1 비허용(발송 콘텐츠 확정 원칙)
  - 데이터 유무와 무관하게 작성 가능 (음성·뇌파 있는 세션에도 코멘트 첨부 가능)
- **FR-2 AI 초안 생성**: 상담사가 "AI 초안" 버튼으로 코멘트 초안을 생성할 수 있다
  - 입력: 세션 메타(유형·제목·일시·시간·참가자 수·참가자 이름) — **음성·뇌파 데이터 없이도 반드시 동작**
  - 데이터가 있으면 보강: `ai_summary`(요약·인사이트), EEG 지표 요약을 프롬프트에 추가
  - 초안은 편집 가능한 텍스트로 입력란에 채워질 뿐, 저장·발송은 상담사 액션으로만
- **FR-3 승인·발송 연계**: 코멘트가 저장된 리포트를 승인하면 기존 흐름 그대로 발송 가능하고, 발송 메일·열람 페이지·리포트 상세에 코멘트가 노출된다
- **FR-4 내담자 노출**: client 리포트 상세(report-view 포함)와 발송 메일 HTML에 "상담사 코멘트" 섹션 표시. 코멘트 없으면 섹션 미노출(기존 null 보존 원칙)

### 3.2 비기능 요구사항

- **NFR-1 null 보존**: 코멘트 미작성 = `None`. 빈 문자열·placeholder 치환 금지 (SDD-022 원칙)
- **NFR-2 LLM 안전 폴백**: AI 초안 실패 시 규칙 기반 템플릿 초안 반환 — 버튼이 죽는 일 없음 (`_call_narrative_llm` 패턴)
- **NFR-3 응답 시간**: AI 초안 생성은 동기 HTTP로 허용(단건·짧은 프롬프트, 상담사 인터랙션형). 단 타임아웃(예: 15초) + 폴백 필수
  - 근거: `.claude/rules/architecture.md` "장기 작업은 Celery" — 초안은 단발 LLM 호출로 STT/요약 파이프라인과 성격이 다름. 타임아웃 초과 시 규칙 폴백으로 200ms~수 초 내 항상 응답
- **NFR-4 프라이버시**: 코멘트는 상담 내용에 준하는 민감 정보 — 기존 리포트 접근 제어(`_can_access_report`, report_view 토큰) 그대로 적용, 신규 접근 경로 추가하지 않음
- **NFR-5 그룹 세션 격리**: 코멘트는 **리포트(=참가자) 단위** — 타 참가자에게 노출 금지

### 3.3 QA 체크리스트 (수락 기준)

| # | 시나리오 | 기대 결과 |
|---|---------|----------|
| Q1 | 음성·뇌파 전무한 세션 종료 → client 리포트 pending_review | 상담사 상세에 코멘트 입력란 + AI 초안 버튼 노출 |
| Q2 | AI 초안 버튼 클릭 (데이터 전무) | 세션 메타 기반 초안이 입력란에 채워짐 (에러 없음) |
| Q3 | 코멘트 저장 → 승인 → 발송 | 메일·report-view·리포트 상세에 코멘트 섹션 노출 |
| Q4 | 코멘트 없이 승인 | 기존과 동일하게 승인·발송 가능 (코멘트 섹션 미노출) |
| Q5 | LLM 키 없음/호출 실패 상태에서 AI 초안 클릭 | 규칙 기반 템플릿 초안 반환 (5xx 없음) |
| Q6 | 그룹 세션 참가자 A 리포트에 코멘트 저장 | 참가자 B 리포트·메일에 미노출 |
| Q7 | completed 리포트에서 코멘트 수정 시도 | 400 거부 (승인 후 콘텐츠 확정) |
| Q8 | 데이터 있는 세션에서 AI 초안 | ai_summary·EEG 요약이 반영된 초안 생성 |

---

## 4. 데이터 모델 설계

### 4.1 후보 비교

| 방안 | 내용 | 장점 | 단점 |
|------|------|------|------|
| A. `SessionRecord.counselor_notes` 재사용 | 기존 필드를 내담자 전달용으로 겸용 | 스키마 변경 없음 | ① 내부 메모와 전달 메시지의 성격 충돌(기존 메모가 갑자기 내담자에게 노출되는 사고 위험) ② 세션당 1건 — 그룹 세션 참가자별 코멘트 불가(NFR-5 위반) |
| B. `Report.content["counselor_comment"]` (JSONB 내 필드) | client 리포트 content에 코멘트 키 추가 | ① 마이그레이션 불필요 ② 리포트(참가자) 단위 — 그룹 격리 자동 충족 ③ 기존 `PUT /reports/{id}`·`_serialize`·정규화 경로 재사용 ④ content 계약(SDD-022)과 일관 | content 재생성 시 보존 로직 필요(4.3) |
| C. `Report.client_comment` 신규 컬럼 | 전용 Text 컬럼 + Alembic | 쿼리·인덱스 용이 | 마이그레이션 필요, content 계약과 이원화(직렬화·정규화 경로 중복) |

### 4.2 결정: **방안 B — `content["counselor_comment"]`**

- 저장 위치: client 리포트 `content.counselor_comment` (string | null)
- 부가 메타(감사 목적): `content.counselor_comment_meta = {"updated_at": ISO8601, "source": "manual" | "ai_draft_edited"}` — v1 선택 사항
- counselor 리포트에는 저장하지 않음 (상담사 내부 메모는 기존 `counselor_notes` 유지 — 역할 분리)
- `normalize_report_content()` (`report_service.py:87-107`)에 `counselor_comment` 패스스루 보강 (null 보존)

### 4.3 재생성 시 보존 (주의점)

- `generate_report_inline()`은 `report.content`를 통째로 교체 (`report_task.py:290`)
- 현재 재생성 트리거: `status in ("pending_analysis", "error")`일 때만 (`report_service.py:261`, `report_email_service.py:91`) — pending_review에서 코멘트 저장 후 자동 재생성될 일은 없음
- 다만 방어적으로: `generate_report_inline()`에서 기존 `content.counselor_comment`가 있으면 신규 content에 이월(carry-over)하는 1줄 가드 추가

---

## 5. AI 초안 생성 설계

### 5.1 생성 시점: **상담사 요청 시 (버튼 트리거)** — 권장

| 후보 | 평가 |
|------|------|
| 세션 종료 시 자동 생성 | ① 모든 리포트에 LLM 비용 발생(대부분 미사용) ② 상담사가 안 볼 초안이 content에 남음 ③ 세션 종료 훅(best-effort)에 실패 지점 추가 → **비채택** |
| **상담사 요청 시 (버튼)** | ① 필요할 때만 비용 발생 ② 초안은 서버에 저장하지 않고 응답으로만 반환 → 저장은 상담사가 편집·저장할 때 ③ 실패해도 리포트 파이프라인 무영향 → **채택** |

### 5.2 API

- `POST /api/v1/reports/{report_id}/comment-draft`
  - 권한: `require_report_host` (기존 헬퍼 재사용, `report_service.py:403-411`)
  - 응답: `{"draft": string, "source": "llm" | "rule"}`
  - **DB 저장 없음** — 순수 생성 응답 (저장은 별도 코멘트 저장 API)

### 5.3 프롬프트 입력 (계층적 — 있는 것만 사용)

- **필수(항상 존재)**: 세션 유형(임상/최면/명상), 제목, 일시(`scheduled_at`), 세션 시간, 참가자 수, (개별 리포트면) 참가자 이름·회원/게스트 여부
- **선택(있으면 보강)**:
  - `SessionRecord.ai_summary`의 summary/sections (transcript 있는 세션)
  - `content.eeg` 지표 요약 (EEG 측정 세션 — narrative 재활용 가능)
  - `SessionRecord.counselor_notes` (상담사 내부 메모 → 초안 소재로만 활용, 원문 인용 금지 지시)
- **프롬프트 가드레일** (`_call_narrative_llm` 프롬프트 원칙 준용):
  - 의료 진단·치료 효과 단정 금지 ("진단/치료 목적 아님" — `data-privacy.md`)
  - 측정 없는 항목을 지어내지 않음 (null은 "측정 없음"으로만)
  - 따뜻한 존댓말, 내담자 1인칭 수신자 관점, 3~5문장 내외
  - 출력: 순수 텍스트 (JSON 아님 — 입력란에 그대로 채움)

### 5.4 폴백 (규칙 기반 템플릿)

- LLM 키 부재·타임아웃·오류 시 세션 메타만으로 템플릿 초안 생성, `source: "rule"`
  - 예: "{날짜} {세션유형} 세션에 함께해 주셔서 감사합니다. … 다음 세션에서 뵙겠습니다."
- 프론트는 `source`와 무관하게 동일 UX (초안 채움) — 실패 개념이 사용자에게 노출되지 않음

### 5.5 구현 위치

- `backend/app/services/report_comment_service.py` (신규): 초안 생성(`build_comment_draft`) + 코멘트 저장(`update_client_comment`)
- LLM 호출은 `summary_task._call_narrative_llm`의 Deepseek 호출부를 일반화하거나 동일 패턴 별도 함수 — 캐시는 불필요(세션별 1회성, 메타가 매번 다름)

---

## 6. UX 설계

### 6.1 상담사 — 리포트 상세 (`ReportDetailView.tsx`)

- **노출 조건**: `isCounselorUser && report.type === 'client' && status === 'pending_review'`
- **위치**: 상태 배지 아래, AI 요약 섹션 위 — "내담자에게 보내는 코멘트" 카드(`SummaryCard` 스타일 재사용)
- **구성**:
  - 멀티라인 textarea (기존 코멘트 있으면 프리필, placeholder: "내담자에게 전달할 메시지를 작성해 주세요")
  - `[AI 초안 받기]` 보조 버튼 — 클릭 시 로딩 스피너 → 초안으로 textarea 채움 (기존 입력이 있으면 덮어쓰기 confirm)
  - `[코멘트 저장]` 버튼 — `PATCH /reports/{id}/comment` 호출, 저장 성공 토스트
  - 미저장 변경 상태 표시 (저장 전 승인 클릭 시 "저장하지 않은 코멘트가 있습니다" 안내)
- **데이터 없는 세션 유도**: `eeg.status === 'not_measured' && ai_record.status === 'not_available'`이면 카드 상단에 안내 배너 — "이 세션에는 측정 데이터가 없습니다. 코멘트를 작성해 내담자에게 전달해 주세요."
- **completed 상태**: 저장된 코멘트를 읽기 전용 카드로 표시 (수정 불가)

### 6.2 내담자 — 리포트 노출

- client 리포트 상세(`/report-view` 포함): `counselor_comment` 있으면 "상담사 코멘트" 섹션 렌더 (인사이트 카드 위) — 없으면 미노출
- 발송 메일 HTML (`view_report_email()`): 02 인사이트 섹션 앞에 "상담사 코멘트" 섹션 추가 — `escape()` + `white-space:pre-wrap` (기존 summary 렌더 방식과 동일)

### 6.3 목록 (`ReportListPage.tsx`)

- v1 변경 없음 (기존 `ReportStatusChip` 유지). 선택 개선: 검토중 행에 코멘트 존재 여부 dot 표시 — v2

### 6.4 상태 배지 힌트 문구 보강 (`ReportStatusBadge.tsx:66-68`)

- pending_review + 데이터 없음 조합일 때: "측정 데이터가 없는 세션입니다. 코멘트를 작성한 뒤 승인해 주세요." (선택 개선)

---

## 7. 승인·발송 정책

- **원칙: 데이터 유무와 무관하게 상담사가 승인하면 발송 가능** — 코드상 이미 충족(`approve_report`는 콘텐츠 검사 없음). 본 기획은 정책을 명문화하고 "전달할 내용"을 채우는 수단을 제공하는 것
- 정책 표:

| 케이스 | 승인 | 발송 | 내담자가 받는 것 |
|--------|------|------|------------------|
| 데이터 有 + 코멘트 有 | 허용 | 허용 | AI 요약·EEG + 코멘트 |
| 데이터 有 + 코멘트 無 | 허용 | 허용 | AI 요약·EEG (현행 동일) |
| 데이터 無 + 코멘트 有 | 허용 | 허용 | **코멘트 중심 리포트** (본 기획 핵심) |
| 데이터 無 + 코멘트 無 | 허용(차단 안 함) | 허용 | 빈 리포트 — 승인 전 확인 다이얼로그로 완화 |
- **소프트 가드(하드 블록 아님)**: 데이터 無 + 코멘트 無 상태에서 승인 클릭 시 프론트 confirm — "이 리포트에는 전달할 내용이 없습니다. 코멘트 없이 승인하시겠습니까?" (백엔드 차단은 하지 않음 — 자동 승인(`auto_approve_report`) 경로와 충돌 방지)
- 자동 승인 상담사(`auto_approve_report=True`): 데이터 없는 세션도 즉시 completed — 코멘트는 승인 후 작성 불가(FR-1)이므로, **자동 승인 사용자는 코멘트를 못 다는 문제** → v1 완화책: completed여도 `sent_at`만 있고 실제 메일 미발송(`report_email_sent_at` 없음)이면 코멘트 수정 허용. 채택 여부 Brian 결정 필요 (8.4 오픈 이슈)
- 발송 경로는 변경 없음: 내담자 `request_report_email` / 상담사 `resend_report_email` 그대로

---

## 8. 구현 범위 및 단계

### 8.1 Phase 1 — BE (코멘트 저장 + 노출)

| # | 태스크 | 파일 |
|---|--------|------|
| B1 | `PATCH /reports/{report_id}/comment` — client 리포트 한정, `pending_review`만 허용, `content.counselor_comment` 갱신 (null 저장 = 삭제) | `api/v1/reports.py`, `services/report_comment_service.py`(신규), `schemas/report.py` |
| B2 | `normalize_report_content()`에 `counselor_comment` 패스스루 (null 보존) | `services/report_service.py` |
| B3 | `generate_report_inline()` content 교체 시 기존 `counselor_comment` 이월 가드 | `tasks/report_task.py` |
| B4 | 메일 열람 HTML에 코멘트 섹션 추가 (escape + pre-wrap) | `services/report_email_service.py` |
| B5 | pytest — Q3/Q4/Q6/Q7 시나리오 | `backend/tests/` |

### 8.2 Phase 2 — BE (AI 초안)

| # | 태스크 | 파일 |
|---|--------|------|
| B6 | `POST /reports/{report_id}/comment-draft` — 세션 메타 수집 → LLM 호출(타임아웃 15s) → 폴백 템플릿 | `api/v1/reports.py`, `services/report_comment_service.py` |
| B7 | 프롬프트 구성(계층 입력 + 가드레일) + 규칙 폴백 함수 | 동일 |
| B8 | pytest — Q2/Q5/Q8 (LLM 모킹) | `backend/tests/` |

### 8.3 Phase 3 — FE

| # | 태스크 | 파일 |
|---|--------|------|
| F1 | API 클라이언트: `updateReportComment()`, `generateCommentDraft()` | `lib/api/reports.ts` |
| F2 | 코멘트 카드 컴포넌트(textarea + AI 초안 버튼 + 저장) + 노출 조건 | `components/reports/CounselorCommentCard.tsx`(신규), `ReportDetailView.tsx` |
| F3 | 데이터 없음 안내 배너 + 승인 confirm(데이터 無+코멘트 無) | `ReportDetailView.tsx` |
| F4 | 내담자 뷰 "상담사 코멘트" 섹션 (있을 때만) | `ReportDetailView.tsx` (client type 분기) |
| F5 | vitest — 노출 조건·저장·초안 채움·confirm | `frontend/src/**/__tests__` |

### 8.4 오픈 이슈 (Brian 결정 필요)

1. **자동 승인 상담사의 코멘트 타이밍** — §7 완화책(미발송 completed는 코멘트 수정 허용) 채택 여부
2. **counselor 리포트에도 코멘트 표시 여부** — 상담사가 자기가 쓴 코멘트를 counselor 리포트에서도 볼지 (v1은 client 리포트 상세에서 확인 가능하므로 보류 제안)
3. **LLM 벤더** — 기존 Deepseek(`_call_narrative_llm`) 재사용 vs `docs/AI_STACK_DECISION.md`의 요약 스택(Claude→Gemini) 정렬. v1은 기존 Deepseek 경로 재사용 제안(신규 키·의존성 없음)
4. **코멘트 길이 제한** — 제안: 2,000자 (메일 렌더·PDF 고려)

### 8.5 SDD 진행

- 카드 태그: [SDD] — spec/plan/verify/summary 4종 작성, Stage ③ Verify 승인 후 구현
- 커밋 태그: `feat(sdd-NNN): 데이터 없는 세션 상담사 코멘트 + AI 초안` (`specs/.sdd-counter` 발번)
