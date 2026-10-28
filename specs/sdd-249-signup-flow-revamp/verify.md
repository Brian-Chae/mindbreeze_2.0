# SDD-249 — 검증 계획 (Stage ③ Verify, 구현 전)

> 구현 전에 작성·커밋한다. 결과는 summary.md 에 PASS/FAIL 로 기록한다. 우선순위 P0 필수 / P1 / P2.

## 기준선 (구현 전 측정)
- 프론트 `npx vitest run` 실패 파일 수 기록(`~/.hermes/cache/scratch/sdd249-baseline.log`). 대표 안내 기준선 8파일. 구현 후 **신규 실패 0**.
- `npx tsc --noEmit -p frontend/tsconfig.app.json`, `npx eslint src/` 오류 0(기준선 대비).
- 서버 변경 없음 → alembic head 단일 유지 확인(변경 시에만 pytest).

## TS1 생년월일 숫자 입력 — `BirthDateInput` (P0)
1. 빈 입력에 `19900315` 연속 입력 → 표시 `1990.03.15`, `onChange` 값 `1990-03-15`.
2. `1990` 입력 직후 표시 `1990`(구분점 대기), `19900` → `1990.0`, `199003` → `1990.03`(월 완성 후 자동 점).
3. `1990.03.15` 붙여넣기·`1990-03-15`·`19900315` 붙여넣기 → 모두 같은 표시/값.
4. 지우기: `1990.03.` 에서 백스페이스 → `1990.03`(구분점이 걸려 멈추지 않음). 전부 지우면 값 빈 문자열.
5. 9자리 이상·숫자 외 문자(`abc`, 공백) 무시.
6. `inputMode="numeric"`, `type` 은 `text`(date 아님), `autoComplete="bday"`, `maxLength` 10.
7. 검증: `20231301`(13월) → invalid, `20300101`(미래) → invalid, `19000101` 미만 → invalid, `20300229`/`19990229` 등 없는 날짜 → invalid, 만 13세 → underage(가입 규칙 모드), 오늘 기준 정확히 만 14세 생일 당일 → ok. 프로필 수정 모드(`ageRule='none'`)에서는 만 10세도 ok, 미래·존재하지 않는 날짜만 invalid.
8. 미완성(7자리 이하)에서 blur → "생년월일을 올바르게 입력해 주세요", 입력 중에는 에러 미노출. 완성되면 즉시 사라짐.
9. 초기값 `1990-03-15`(서버 형식) → 표시 `1990.03.15`, 값 변경 없이 제출 시 `1990-03-15`.
10. `lib/auth/birth-date.ts` 순수 함수 단위: `formatBirthDigits`, `toIsoBirthDate`, `fromIsoBirthDate`.

## TS2 적용 범위 grep (P0)
- `grep -rn 'type="date"' frontend/src` 결과에 생년월일 입력 0건. 남는 것은 일정·내보내기·자격 취득/시작/종료일뿐: `NormalizationPanel`, `data-center-page`, `export-dialog`, `class-settings-panel`, `class-scheduling-wizard`, `CredentialDashboardPage`, counselor-info-editor 의 취득일·시작일·종료일.
- 연/월/일 select(ClientOnboardingPage) 제거 확인.
- 적용 화면 각각 vitest 또는 렌더 테스트로 입력→제출 payload 가 `YYYY-MM-DD` 임을 확인: RegisterClient, RegisterCounselor, InviteLanding, ClientEssentials, CounselorOnboarding, ClientOnboarding, settings 4종, counselor-info-editor.

## TS3 공통 가입 정보 확인 `SignupInfoForm` + `/signup/confirm` (P0)
1. 필수 3종 + 생년월일 유효 + 성별 선택 전에는 제출 버튼 비활성(`disabled`). 충족 시 활성.
2. 선택 동의 2종은 미체크로도 제출 가능, 체크한 값만 `true` 로 전송(`toConsentPayload`).
3. 이용약관·개인정보·민감정보 항목마다 "보기" 링크 존재(새 탭 `target=_blank`, `rel=noopener`).
4. 제출 → 소셜 API 재호출 payload: `{token, birth_date:'YYYY-MM-DD', consents, role, invite_token?}`.
5. 만 14세 미만 서버 `AGE_RESTRICTED` → 표준 문구(생년월일 칸 하이라이트), `ACCOUNT_LINK_REQUIRED`(409) → "기존 계정에 연결이 필요해요" 안내+로그인 이동, `ACCOUNT_DELETION_PENDING` → 탈퇴 처리 중 안내.
6. 자격이 메모리에 없는 상태로 `/signup/confirm` 직접 진입(새로고침) → 로그인 화면으로 안내 이동(빈 화면·오류 없음).
7. 자격 값은 `localStorage`·`sessionStorage`·URL 에 저장되지 않음(코드 검색 + 테스트).

## TS4 소셜 로그인 → 확인 화면 연결 (P0)
1. 로그인 회원 탭 Google(웹·네이티브)·Apple: 기존 계정 → 즉시 로그인(확인 화면 없음, 회귀 없음).
2. 신규(서버 422 `BIRTH_DATE_REQUIRED`/`CONSENT_REQUIRED`) → 오류 문구 없이 `/signup/confirm` 이동.
3. 기존 인라인 생년월일·동의 입력란(`googleConsentField`)이 로그인 화면에서 제거됨. 로그인 화면 하단 코드 입장 카드와 겹침 없음.
4. 초대 랜딩 Google 신규(D4): 인증 → 확인 화면, `invite_token` 이 재호출에 포함되고 가입 후 `/onboarding/client?source=invite&code=…` 이동. #148(초대·소셜 신규 생년월일 전달) 동작 보존.
5. 422 이외 오류(401·403·409·5xx·네트워크)는 확인 화면으로 보내지 않고 표준 오류 문구.

## TS5 온보딩 역할 가드 (P0)
1. 상담사 계정이 `/onboarding/client`, `/onboarding/client/essentials` 진입 → 회원용이라는 안내 + 상담사 홈 이동 버튼(회원 화면 비노출).
2. 회원 계정이 `/onboarding/counselor` 진입 → 안내 + 회원 홈 이동.
3. 비로그인 진입 → 해당 역할 로그인으로 이동(기존 RoleGuard 동작).
4. 올바른 역할 진입 시 기존 동작 그대로.

## TS6 로그인·역할 안내 (P1)
1. 탭 역할과 계정 역할이 다를 때(403 `ROLE_MISMATCH`) 올바른 탭으로 이동하는 버튼.
2. 상담사 탭: Google·Apple 신규 시 안내 문구(D1 취지)와 `/register/counselor` 링크. 기관 탭: Google·Apple 버튼 노출 + 지정 계정 안내(D2).
3. iOS 네이티브에서 Google 버튼이 보이는 화면에는 Apple 버튼이 항상 동반(로그인 3탭·초대 랜딩), 웹·Android 에서는 Apple 비노출.

## TS7 코드 입장·앱 기관 문의·초대 상태 (P1)
1. `/join` 입장 완료 후 가입 권유 카드: 문구 "리포트를 계속 관리하고 편하게 클래스에 계속 참여하려면 가입하세요", "건너뛰고 계속 참여하기"로 해제 가능(필수 아님, D7).
2. 앱(`isNativeApp`)에서 기관 카드 대신 "기관 도입은 웹에서 문의해요" 안내 + 웹 문의 이동(D6).
3. 초대 랜딩: 404 → 무효, 410 → 만료, 이미 사용 → 사용됨 문구 구분 + 다음 행동 버튼.

## TS8 시안 대조 (모바일 390×844, P0·P1)
- Playwright(로컬 vite + API mock)로 확인 화면·초대·로그인(회원)·가입 선택·생년월일 입력 중 상태를 캡처하고 시안 `captures/*-m.png` 와 색·배치·52px pill 대조. 가로 스크롤 0, 버튼 높이 ≥44px, 금지 문구(점수·효능) 0.

## Edge Cases
- [ ] 한글 IME·붙여넣기 중 숫자 외 문자 → 무시.
- [ ] iOS WebView 에서 `inputMode=numeric` 키패드 → 구분점 입력 불필요(자동).
- [ ] 2월 29일생, 오늘이 정확히 만 14세 생일 전날/당일 경계.
- [ ] 초대 토큰의 이메일과 소셜 이메일 불일치 → 서버가 조용히 스킵(기존 동작), 화면은 일반 가입으로 진행.
- [ ] 확인 화면 더블 클릭 → 중복 제출 방지(`busy`).
- [ ] 다크/라이트 토큰 혼재 화면(`--mb-*` vs 보라 하드코딩)에서 대비 유지.

## Security Review
- [ ] 소셜 자격(access/id token)은 메모리에만, 로그·URL·스토리지 미기록. 화면 이탈·로그아웃 시 폐기.
- [ ] 클라이언트 검증은 안내용 — 서버가 최종 판정(`validate_new_account`) 유지. 서버 변경 없음.
- [ ] 역할 가드는 프론트 편의, 서버 권한(`_ensure_login_role`)이 1차 방어임을 유지.
- [ ] 상담사·기관 신규 소셜 생성은 서버 403 유지(D1 서버 허용은 별도 정책 변경, 본 SDD P2/보고).
- [ ] 약관 본문·동의 항목 수 변경 없음(D5 현행 유지).
