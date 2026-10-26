# [Fix] 개인정보처리방침·약관·스토어 문안 정합 — Plan (MB261026)

## 원인 분석
- 방침 2.2·약관·설정 화면·심사 메모 문안이 서로 어긋남(console-fields.md §4 M-1·M-2·M-5·M-10).
  - 약관 "현재 AI 기능은 제공하지 않습니다" ↔ 방침/설정 "AI 요약 시 Gemini 전송" 병존.
  - 설정에서 받는 전화번호·주소·프로필 사진이 방침 수집 항목에 없음.
  - 백엔드 `CONSENT_VERSIONS["privacy"]`="1.0" 이 방침 버전(2.2)과 따로 놂.

## Brian 결정(10/26) 반영
1. AI 제공 여부 단정 문구 제거(약관·앱 문구·심사 메모 초안). AI 기능은 업데이트마다 바뀜.
2. 방침은 법정 필수 항목 중심으로 간결하게. 기능별 AI 업체 서술 삭제, 처리 위탁·국외 이전 표에 Google(Gemini) 수탁자를 사실대로 기재. 수집 항목에 전화번호·주소·프로필 사진(선택) 추가. 오디오는 "필수 동의 후 입장". 버전 2.3, 개정 이력 간결화.
3. 의료 면책: Play 전체 설명 끝 한 줄만(스토어 문안 문서). App Store 설명엔 면책 없음. 의료 효능 암시어 점검.
4. Play 타깃 13~15세 포함 시 고지·콘솔 문답 변화 문서화.

## Task
| # | 파일 | 내용 |
|---|---|---|
| 1 | `frontend/src/lib/privacy-policy.ts` | 버전 2.3, 시행일 2026-10-26, AI 서술 삭제, Google(Gemini) 수탁자 행, 수집 항목 추가, 개정 이력 간결화 |
| 2 | `frontend/src/pages/terms-page.tsx` | "현재 AI 기능은 제공하지 않습니다" 삭제 |
| 3 | `settings-content.tsx`, `session-note-prompt-toggle.tsx` | Gemini 전송 단정 문장 삭제(방침 링크로 대체) |
| 4 | `backend/app/services/signup_policy_service.py` | `CONSENT_VERSIONS["privacy"]`="2.3" |
| 5 | 테스트 | 버전 2.2→2.3 갱신, 금지어(AI 미제공 등) 시험 신설, 백엔드-프론트 버전 연동 시험 신설 |
| 6 | `~/.hermes/share/mb-store-prep-20261026/*.md` | console-fields·submission-checklist 갱신(심사 메모 AI 문장 삭제, Play 면책 1줄, 13~15세 문답) |

## 위험
- 방침 개정 → 운영 `/privacy` 는 아직 1.0. 배포 전까지 콘솔 URL 입력 금지(U-1 유지).
- Google(Gemini) 수탁 항목·보유기간은 법무 확인 필요(수탁자 공개 자료 기준 서술).
