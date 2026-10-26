# Verify (구현 전 QA 체크리스트)

## 자동 시험
- [ ] V1 `PRIVACY_POLICY_VERSION === '2.3'`, 시행일 2026-10-26 (privacy-policy.test 외 3개 시험 갱신)
- [ ] V2 방침·약관·설정 화면·legal-copy 어디에도 "AI 미제공/AI 기능은 제공하지 않/AI 기능 없음/현재 AI" 단정 문구가 없다 (신규 vitest)
- [ ] V3 방침 본문에 기능별 "AI 요약 … Gemini로 전송" 서술이 없고, 처리 위탁 표에 Google LLC(Gemini)가 있다
- [ ] V4 수집 항목에 전화번호·주소·프로필 사진이 있고, "선택"이 명시된다
- [ ] V5 방침에 "필수 동의 후 입장"(녹음·녹화) 문장이 있다
- [ ] V6 법정 항목(수집 항목·목적·보유기간·제3자 제공·위탁·국외 이전·권리 행사·파기·보호책임자·변경 고지)이 모두 존재
- [ ] V7 백엔드 `CONSENT_VERSIONS["privacy"]` == 프론트 `PRIVACY_POLICY_VERSION` (pytest가 ts 파일 파싱)
- [ ] V8 신규 가입 시 privacy consent 에 2.3 저장(기존 pytest 갱신)
- [ ] V9 tsc 0, eslint 0, 전체 vitest 실패 ≤ 기준선 17 fail/8파일

## 문서 점검
- [ ] D1 console-fields.md: 심사 메모 "AI features are not offered" 삭제, M-2·M-10 해소 표기, 방침 2.3 반영
- [ ] D2 Play 전체 설명 끝 면책 1줄만, App Store 설명엔 면책 없음(현재 [본문 의료 면책 문장] 제거)
- [ ] D3 설명·스크린샷 문구 의료 효능 암시어(치료/개선/진단/처방/효과) 점검 결과 기록
- [ ] D4 Play 타깃 13~15세 포함 시 문답 변화·주의점 기록
- [ ] D5 submission-checklist.md 갱신

## 비범위
머지·배포·메일·삭제·콘솔 입력·서버 접속 금지.
