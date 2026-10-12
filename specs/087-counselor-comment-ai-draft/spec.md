# SDD-087 — 데이터 없는 세션 상담사 코멘트 + AI 초안

> 상세 기획: `docs/report-counselor-comment-ai-draft-기획.md` (반드시 먼저 읽고 구현)
> 데이터(음성·뇌파) 없는 세션도 상담사가 코멘트를 작성해 내담자에게 전달. AI(Gemini)가 초안 생성.
> **claude(fable) 위주 개발**.

## 1. 확정 결정 (Brian)
1. **자동 승인(auto_approve_report) 상담사**: AI 코멘트를 **자동 생성해서 그냥 발송** (초안 단계 없음)
2. **counselor 리포트에도 코멘트 표시** (상담사가 자기가 쓴 코멘트를 counselor 리포트에서도 확인)
3. **LLM 벤더 = Gemini** (기존 Deepseek 아님 — AI_STACK_DECISION.md 요약 스택)
4. **코멘트 길이 = 1000자** 제한

## 2. 핵심 설계 (기획서 요약)
- 저장: client 리포트 `content["counselor_comment"]` (JSONB 필드, null 보존)
- AI 초안: 상담사 요청 시(버튼) 세션 메타 기반 생성, LLM 실패 시 규칙 템플릿 폴백
- 승인·발송: 데이터 유무와 무관하게 승인 가능 (코멘트가 전달 콘텐츠)
- 기존 `counselor_notes`(내부 메모)와 분리 — 내담자 노출 방지

## 3. 구현 범위 (기획서 §8)

### Phase 1 — BE 코멘트 저장 + 노출
- B1: `PATCH /reports/{report_id}/comment` — client 리포트, pending_review만, content.counselor_comment 갱신 (1000자 제한)
- B2: `normalize_report_content()`에 counselor_comment 패스스루 (null 보존)
- B3: `generate_report_inline()` content 교체 시 counselor_comment 이월 가드
- B4: 메일 열람 HTML에 코멘트 섹션 (escape + pre-wrap)
- B5: pytest (Q3/Q4/Q6/Q7)

### Phase 2 — BE AI 초안 (Gemini)
- B6: `POST /reports/{report_id}/comment-draft` — 세션 메타 수집 → Gemini 호출(타임아웃 15s) → 규칙 폴백
- B7: 프롬프트 구성(계층 입력 + 가드레일: 진단 단정 금지·측정 없는 항목 지어내지 않음) + 규칙 폴백 함수
- B8: **자동 승인 시 AI 코멘트 자동 생성 + 발송** — `approve_report`(또는 auto_approve 경로)에서 코멘트 없으면 Gemini 초안을 자동 생성해 저장 후 발송
- B9: pytest (Q2/Q5/Q8, LLM 모킹)

### Phase 3 — FE
- F1: API 클라이언트 `updateReportComment()`, `generateCommentDraft()`
- F2: `CounselorCommentCard.tsx` (textarea + AI 초안 버튼 + 저장) — ReportDetailView에 추가
- F3: 데이터 없음 안내 배너 + 승인 confirm(데이터無+코멘트無)
- F4: 내담자 뷰 "상담사 코멘트" 섹션 (있을 때만) + **counselor 리포트에도 코멘트 표시**
- F5: vitest

## 4. 주의
- null 보존: 코멘트 미작성 = None (빈 문자열 치환 금지)
- LLM 안전 폴백: Gemini 실패/타임아웃 시 규칙 템플릿 반환 (버튼 죽지 않음)
- 프라이버시: 코멘트는 상담 내용에 준하는 민감 정보 — 기존 접근 제어 재사용
- 그룹 격리: 코멘트는 리포트(참가자) 단위 — 타 참가자 노출 금지
- 자동 승인 + 데이터無 + 코멘트無 → Gemini 초안 자동 생성 후 발송 (빈 리포트로 발송하지 않음)
- 코멘트 1000자 초과 시 422

## 5. 완료 기준
- 상담사 코멘트 작성/저장/노출 (client + counselor 리포트)
- AI(Gemini) 초안 생성 + 규칙 폴백
- 자동 승인 시 AI 코멘트 자동 생성·발송
- BE pytest 통과(신규 포함), FE build 0 error
