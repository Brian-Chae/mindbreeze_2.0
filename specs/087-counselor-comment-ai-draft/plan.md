# SDD-087 Plan — 상담사 코멘트 + AI(Gemini) 초안

> Stage ② — spec.md 확정 결정(Brian) 기반 구현 계획.
> FE vitest(F5)는 코디네이터 결정으로 이번 범위 제외(인프라 부재 — 별도 구축 예정). FE는 build 검증만.

## 아키텍처 결정

- **저장 위치**: client 리포트 `content["counselor_comment"]` (JSONB, string | null). 마이그레이션 불필요, 리포트(참가자) 단위 → 그룹 격리 자동 충족.
- **LLM**: Gemini `gemini-2.5-flash` — Google Generative Language API `generateContent`를 httpx 로 직접 호출 (타임아웃 15s). 실패·키 부재 시 규칙 템플릿 폴백 (`source: "rule"`). 캐시 없음(세션별 1회성).
- **자동 승인(auto_approve_report)**: 승인 직전에 코멘트 없으면 AI 초안 자동 생성·저장 후 승인 (Brian 결정 #1). 발송 경로(SDD-066: 승인≠발송)는 변경하지 않음 — 발송되는 메일·열람 페이지에 코멘트가 포함되는 것으로 "발송" 요건 충족.
- **counselor 리포트 코멘트 표시** (Brian 결정 #2): 코멘트 원본은 client 리포트에만 저장. counselor 리포트 상세 조회(`get_report`) 시 같은 세션 client 리포트들의 코멘트를 `content["client_comments"] = [{participant_id, participant_name, comment}]` 로 파생 주입(저장 안 함) — 그룹 세션 다중 코멘트 대응.
- **counselor_notes(내부 메모) 분리 유지**: 코멘트 API·노출 경로 어디에도 counselor_notes 를 섞지 않는다. AI 초안 프롬프트 소재로만 사용(원문 인용 금지 지시, 그룹 세션은 record 자체 제외 — report_task 와 동일 격리 규칙).

## Task 목록

### Phase 1 — BE 코멘트 저장·노출
| # | 내용 | 파일 |
|---|------|------|
| B1 | `PATCH /reports/{id}/comment` — client·pending_review 한정, 1000자(422), null=삭제 | `api/v1/reports.py`, `schemas/report.py`, `services/report_comment_service.py`(신규) |
| B2 | `normalize_report_content()` counselor_comment 패스스루(null 보존) | `services/report_service.py` |
| B3 | `generate_report_inline()` content 교체 시 코멘트 이월 가드 | `tasks/report_task.py` |
| B4 | 메일 열람 HTML 코멘트 섹션 (escape + pre-wrap) | `services/report_email_service.py` |
| B5 | counselor 리포트 상세에 client_comments 파생 주입 | `services/report_service.py` |

### Phase 2 — BE AI 초안(Gemini)
| # | 내용 | 파일 |
|---|------|------|
| B6 | `POST /reports/{id}/comment-draft` — 세션 메타 수집 → Gemini(15s) → 규칙 폴백 | `api/v1/reports.py`, `services/report_comment_service.py` |
| B7 | 프롬프트(가드레일: 진단·치료 단정 금지, 미측정 항목 날조 금지, 존댓말 3~5문장) + 규칙 폴백 | 동일 |
| B8 | auto_approve 경로에서 코멘트 없으면 AI 초안 자동 생성·저장 후 승인 | `services/report_service.py` |
| B9 | `gemini_api_key` 설정 추가 | `app/config.py` |

### Phase 3 — FE
| # | 내용 | 파일 |
|---|------|------|
| F1 | `updateReportComment()`, `generateCommentDraft()` | `lib/api/reports.ts` |
| F2 | `CounselorCommentCard.tsx` (textarea+AI 초안+저장, 1000자 카운터) — pending_review·client·counselor 권한 시 | `components/reports/`, `ReportDetailView.tsx` |
| F3 | 데이터 없음 배너(eeg not_measured + ai_record not_available) + 승인 confirm(데이터無+코멘트無 / 미저장 코멘트) | `ReportDetailView.tsx` |
| F4 | 내담자 뷰 "상담사 코멘트" 섹션(있을 때만, completed 읽기 전용 카드 포함) + counselor 리포트 client_comments 섹션 | `ReportDetailView.tsx` |

### 테스트
- `backend/tests/test_sdd087_counselor_comment.py` — Q1~Q8 시나리오 + B3 이월 + B8 자동 생성 (Gemini 는 `_call_gemini` monkeypatch 모킹)
- 완료 게이트: `venv/bin/pytest` 전체 통과(기존 686 유지) + `npm run build` 0 error
