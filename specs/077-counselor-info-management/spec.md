# SDD-077 — 상담사 정보 관리 P0 (정보 구조 + 3자 수정)

> 기획안 `docs/counselor-info-management-기획.md`의 P0 구현. **claude(fable) 위주로 개발**.
> 상담사 정보(이름·성별·생년월일·전화·주소·이력)를 플랫폼/기관/상담사 본인이 수정한다.

## 1. 정책 확정 (Brian)
- **기관 관리자**: 소속 상담사의 성별·생년월일·전화번호·주소를 **모두 조회 + 수정 가능** (기획안 권한 매트릭스와 다름 — 기관 관리자에게 전부 허용)
- **이메일**: 아이디로 사용 → **변경하지 않음** (읽기 전용, 변경 기능 없음)
- **주 담당자**: 이름·전화 수정 포함 (담당자 교체는 아님)

## 2. 구현 범위 (claude fable)

### T1. 정보 구조
- `CounselorProfile` 확장: 신규 주소 필드 `postal_code`, `address_line1`, `address_line2` (선택) + `version`(동시 수정 충돌 검사)
- 기존 필드 재사용: gender(male/female/other/null), birth_date, years_of_experience, specialties, affiliation_type, profile_image_url, bio
- 경력 `Career`(organization/role/started_at/ended_at/is_current), 자격 `Qualification`(name/issuer/issued_at) 재사용
- User: name/phone/profile_image/bio (계정 기본). email 읽기 전용. gender/birth_date/address는 User에 두지 않음

### T2. API
- 본인: `GET/PATCH /auth/counselors/me/profile` 확장 (성별/생년월일/주소/경력/자격/version)
- 플랫폼: `GET/PATCH /admin/counselors/{user_id}/profile` + `GET /admin/counselors?org_id=&q=&status=`(미소속 포함)
- 기관: `GET/PATCH /org/{org_id}/counselors/{user_id}/profile` (동일 기관 허용 대상)
- 주 담당자: `PATCH /admin/orgs/{org_id}/primary-admin/profile` (이름/전화)
- 이메일 변경 API 없음. role/org_id/verified_tier/status는 수정 요청에서 거부(대량 할당 차단)

### T3. 권한 검사
- 플랫폼: 전체 + 미소속 상담사. 기관: 소속 상담사(성별/생년월일/전화/주소 포함 전부). 본인: 자신만
- 타 기관 대상 404, 권한 없는 필드 403, 잘못된 값 422
- 관리자 수정은 사유 필수 + 대상자에게 변경 알림(성별/생년월일/주소 원문 미포함)
- version 낙관적 잠금(409), 감사 기록 원자 저장

### T4. FE
- 플랫폼: 기관 모달 상담사 탭 행에 "정보 수정" (기본 정보/전문 이력/개인정보 패널)
- 기관: 소속 상담사 목록 정보 수정 (성별/생년월일/전화/주소 포함)
- 본인: SettingsPage 프로필 확장 (성별/생년월일/주소/경력/자격)
- 주 담당자 카드에 "담당자 정보 수정" (이름/전화)

## 3. 주의
- 이메일 변경 기능 구현 금지 (읽기 전용 표시)
- 개인정보(성별/생년월일/주소)는 기관 관리자에게도 노출·수정 허용 (정책 확정) — 단, 감사 기록
- 상담사 코드/역할/소속/상태/인증등급은 수정 불가 (별도 관리 기능)
- 온보딩 experience_years ↔ 백엔드 years_of_experience 계약 정합 확인

## 4. 완료 기준
- 플랫폼/기관/상담사 3자가 각 권한 범위에서 상담사 정보 조회·수정
- 기관 관리자가 성별/생년월일/전화/주소 조회+수정 가능
- 이메일 읽기 전용, 주 담당자 이름·전화 수정
- BE pytest 통과, FE build 0 error
