# Summary — 개인정보처리방침·약관·스토어 문안 정합 (MB261026)

## 변경 (전 → 후)
| 위치 | 전 | 후 |
|---|---|---|
| 방침 버전/시행일 | 2.2 / 2026-10-24 | **2.3 / 2026-10-26** |
| 약관 `terms-page.tsx` | "현재 AI 기능은 제공하지 않습니다." | 삭제 |
| 설정 `settings-content.tsx`, `session-note-prompt-toggle.tsx` | "AI 요약을 사용하면 … 외부 AI(Google Gemini)로 전송" | 삭제 |
| 방침 처리 위탁 항 | "AI 요약 기능을 사용하는 경우 … Gemini로 전송" 기능 서술 | 삭제. 위탁·국외 이전 표에 **Google(Gemini API) / Google LLC / 미국 등 해외** 행 추가 |
| 방침 제2조 | "음성 자동 전사는 현재 제공하지 않으며, 수업 통계 AI 요약은…" | 해당 문장 삭제 |
| 방침 제2조 수집 항목 | 전화번호·주소·프로필 사진 없음 | "계정 설정에서 입력하는 정보(선택): 전화번호, 주소, 프로필 사진" 추가 (AccountSection/PersonalInfoSection 입력란 확인) |
| 방침 녹음 | "필수 동의한 이후 입장할 수 있습니다" | "음성 녹음·영상 녹화는 … 필수 동의한 이후에 입장 … 동의하지 않으면 입장할 수 없습니다" |
| 방침 개정 이력 | 장문 3중 이력 | 2.3 변경점 + 2.2 한 줄 + 변경 고지 문장 |
| 백엔드 `CONSENT_VERSIONS["privacy"]` | "1.0" | **"2.3"** (신규 가입 동의가 방침 버전과 연동) |

## 시험
- vitest 신규 `fix-store-policy-copy-align.test.ts`(금지 단정 문구, Gemini 위탁 표, 수집 항목, 필수 동의 입장, 법정 항목 제목) + 버전 2.2→2.3 기대값 갱신 5개 파일.
- pytest `test_sdd220_age_consents.py` 36개(연동 시험 1개 추가) + 동의 관련 154개 통과.
- tsc 0 error, eslint 0 error(기존 warning 2), 전체 vitest **17 fail / 8파일(기준선과 동일)**, 3342 pass. sdd-234 산출물 변경은 원복.

## 저장소 밖 문서 (~/.hermes/share/mb-store-prep-20261026/)
console-fields.md·submission-checklist.md 갱신: 방침 2.3, App Store 설명 면책 삭제, Play 전체 설명 끝 표준 고지 1줄, 심사 메모 AI 문장 삭제, 타깃 13–15세 주의점 6건, M-1·M-2·M-5·M-10 해소 표기, 의료 효능 암시어 점검(설명·스크린샷 문구 0건).

## 남은 일 (이 PR 범위 밖)
- 머지·운영 배포 후에야 콘솔 방침 URL 입력 가능(운영 /privacy는 아직 1.0).
- 콘솔 저장본 3건 재저장(App Store 설명, Play 전체 설명, 심사 메모) — 승인 후 입력.
- Google(Gemini) 보유기간·수탁 표현은 법무 확인. 기존 동의(1.0) 사용자의 재동의 유도는 하지 않음(신규 가입부터 2.3 기록).
