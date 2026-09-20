# SDD-087 Verify — 구현 전 QA 체크리스트

> Stage ③ — 구현 전 작성. spec.md QA(Q1~Q8) + 확정 결정 반영.

## API — 코멘트 저장 (B1)
- [x] V1. pending_review client 리포트에 `PATCH /reports/{id}/comment` → 200, `content.counselor_comment` 저장·응답 반영 (Q3 전반부)
- [x] V2. 1000자 초과 → 422
- [x] V3. `comment: null` → 코멘트 삭제(키 제거/None), 빈 문자열·공백만 → null 처리(빈 문자열 저장 금지)
- [x] V4. counselor 리포트에 코멘트 PATCH → 400
- [x] V5. completed 리포트에 코멘트 PATCH → 400 (Q7)
- [x] V6. 타 상담사(비 host) → 403 (기존 접근 제어 재사용)

## 노출 (B2/B4/B5)
- [x] V7. 코멘트 저장 → 승인 → 메일 열람 HTML 에 코멘트 섹션 노출(escape + pre-wrap), 리포트 상세 content 에 포함 (Q3)
- [x] V8. 코멘트 없는 리포트 — 기존과 동일하게 승인·발송 가능, HTML 에 코멘트 섹션 미노출 (Q4)
- [x] V9. 그룹(다중 참가자): A 리포트 코멘트가 B 리포트·B 메일에 미노출 (Q6)
- [x] V10. counselor 리포트 상세에 client 코멘트 파생 표시(client_comments)
- [x] V11. 재생성(error → 재생성) 시 기존 counselor_comment 이월 (B3)

## AI 초안 (B6~B8)
- [x] V12. 데이터 전무 세션에서 comment-draft → 200, 세션 메타 기반 초안 (Q1/Q2)
- [x] V13. GEMINI 키 없음/호출 실패/타임아웃 → 규칙 템플릿 폴백, `source:"rule"`, 5xx 없음 (Q5)
- [x] V14. LLM 성공(모킹) → `source:"llm"`, 초안 1000자 이내 절단
- [x] V15. 데이터 있는 세션 → 프롬프트에 ai_summary 반영 (Q8), 그룹 세션은 record(요약·메모) 프롬프트 제외
- [x] V16. auto_approve ON + 코멘트 없음 → 승인 시 AI 코멘트 자동 생성·저장 후 completed (빈 리포트 발송 없음)
- [x] V17. auto_approve ON + 이미 코멘트 있음 → 덮어쓰지 않음

## FE (build 검증)
- [x] V18. pending_review + client + 상담사 → 코멘트 카드(입력란+AI 초안+저장) 노출 (Q1)
- [x] V19. 데이터 없음(eeg not_measured + ai_record not_available) → 안내 배너, 데이터無+코멘트無 승인 시 confirm
- [x] V20. completed client 리포트 → 코멘트 읽기 전용 표시(내담자·상담사), counselor 리포트 → client_comments 섹션
- [x] V21. `npm run build` 0 error

## 회귀
- [x] V22. 기존 pytest 686개 전체 통과 유지
