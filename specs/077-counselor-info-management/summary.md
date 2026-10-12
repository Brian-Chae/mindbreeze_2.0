# SDD-077 — Summary (Stage ⑥)

> 상담사 정보 관리 P0 구현 완료. 정책 확정 3건(기관 관리자 개인정보 전부 허용+감사,
> 이메일 읽기 전용, 주 담당자 이름·전화 수정) 모두 반영.

## 구현 결과

### T1. 정보 구조
- `CounselorProfile`에 `postal_code`(20)/`address_line1`(300)/`address_line2`(200)/`version`(기본 1) 추가
- 마이그레이션 `e036a0000010_sdd_077_counselor_info.py` (down_revision=e036a0000009)
- gender/birth_date/years_of_experience/specialties/affiliation_type + Career/Qualification 기존 필드 재사용
- User에는 개인정보를 두지 않음. email 변경 API 없음(전 경로 읽기 전용)

### T2. API
- 공통 서비스 `app/services/counselor_info_service.py` — 3자 공용 serialize/update + 감사 + 알림
- 본인: `GET/PATCH /auth/counselors/me/profile` 확장 (개인정보/주소/경력/자격/version)
- 플랫폼: `GET /admin/counselors?org_id=&q=&status=`(org_id=none → 미소속),
  `GET/PATCH /admin/counselors/{user_id}/profile`
- 기관: `GET/PATCH /org/{org_id}/counselors/{user_id}/profile` (동일 기관, 개인정보 포함 전부)
- 주 담당자: `PATCH /admin/orgs/{org_id}/primary-admin/profile` (이름/전화, expected_user_id 충돌 감지,
  기관 잠금(SDD-076 패턴), primary_admin_id·기관 연락처 불변, 프로필 미생성)

### T3. 권한/안전장치
- 수정 금지 필드(email/role/org_id/verified_tier/status/counselor_code) 전송 → 403, 미지 필드 → 422
- 관리자 수정 사유 필수(422) + `VerificationAudit(counselor_profile_updated)` + 대상자 인앱 알림을
  **한 트랜잭션**으로 저장. 감사 전후값·알림 본문에 성별/생년월일/주소 원문 미포함(필드명만)
- version 낙관적 잠금 409 (미전송 구 클라이언트는 생략 — 하위 호환), 성공 시 version+1
- 타 기관 대상 404, 기관 관리자 대상의 기관 경로 PATCH 403, 비활성 기관 409
- 성별/생년월일/주소 null 보존 — 미전송 유지 / null 전송 삭제 (`model_fields_set` 기반)
- 프로필 없는 대상 수정 시 기존 코드 발급 정책(`generate_counselor_code`) 재사용

### T4. FE
- 공용 편집 폼 `components/counselor/counselor-info-editor.tsx` (기본 정보/개인정보/전문 이력 3패널,
  이메일 읽기 전용, 사유 필수, 변경분만 diff 전송 + version)
- 플랫폼: 기관 모달 상담사 탭 행 "정보 수정", 주 담당자 카드 "담당자 정보 수정"(`primary-admin-edit.tsx`)
- 기관: `pages/org/OrgManagementPage` 소속 상담사 → 테이블+검색/상태필터+정보 수정(상담사만, 기관 관리자 행 안내)
- 본인: `PersonalInfoSection`(성별/생년월일/주소) 신설 + SettingsPage 저장 시 version 자동 첨부
- API 클라이언트 `lib/api/counselor-info.ts` 신설, `counselor.ts` 타입 확장

### 온보딩 계약 정합 (버그 수정)
- FE가 `experience_years`로 보내 BE(`years_of_experience`)에 저장되지 않던 문제 수정
  (`CounselorOnboardingPage`: 전송 키 교정 + 과거 저장분 양쪽 키 읽기)

## 테스트

- `backend/tests/test_sdd077_counselor_info.py` 19건 신규 — 본인 라운드트립/409/금지필드 403/검증 422,
  플랫폼 목록 필터·감사·알림 원문 미포함, 기관 전부 접근+경계(403/404/409), 주 담당자 수정/충돌/불변식
- 게이트: `venv/bin/pytest` **606 passed, 12 skipped** / `npm run build` **0 error** (tsc -b 포함)
- FE 화면은 빌드·타입 수준 + 코드 검토로 확인(브라우저 실동작 미수행). frontend의 vitest 실행 실패는
  기존 `tests/*.cjs`(node:test/playwright 스크립트) 때문이며 본 변경과 무관(기존 상태, test 스크립트 부재)

## 비고 / 후속(P1+)
- 이메일 변경(EmailChangeRequest), 관리자 개인정보 열람 감사(조회 감사), 담당자 교체는 기획대로 후속 범위
- 미소속 상담사 FE 전용 진입점은 미구현(API는 `org_id=none`으로 제공) — 브리프 T4 범위 외
- 알렘빅 헤드가 기존에 3갈래(멀티 헤드)인 상태는 본 작업 이전부터 존재 — e036a 라인에 체인함
