# SDD-077 — Verify (Stage ③, 구현 전 QA 체크리스트)

## A. 본인 (상담사)
- [x] A1. `GET /auth/counselors/me/profile` 응답에 gender/birth_date/postal_code/address_line1/address_line2/version 포함
- [x] A2. `PATCH /auth/counselors/me/profile`로 성별/생년월일/주소 저장·삭제(null) 가능, version 증가
- [x] A3. 이메일은 응답에 있으나 수정 전송 시 403
- [x] A4. role/org_id/verified_tier/status/counselor_code 전송 시 403, 미지 필드 422
- [x] A5. 잘못된 생년월일(형식·미래) 422, 잘못된 성별 422, 음수 경력연수 422
- [x] A6. 낡은 version 전송 시 409, version 미전송(구 클라이언트)은 통과(하위 호환)

## B. 플랫폼 관리자
- [x] B1. `GET /admin/counselors` — 전체+미소속(org_id=none) 필터, q(이름/이메일/코드), status 필터
- [x] B2. `GET/PATCH /admin/counselors/{id}/profile` — 미소속 상담사 포함 조회·수정
- [x] B3. PATCH 사유(reason) 누락 422
- [x] B4. 수정 성공 시 VerificationAudit + 대상자 인앱 알림 생성(성별/생년월일/주소 원문 미포함), 동일 트랜잭션
- [x] B5. 비관리자 403, 미인증 401, 대상이 상담사/기관관리자가 아니면 404

## C. 기관 관리자
- [x] C1. `GET/PATCH /org/{org_id}/counselors/{id}/profile` — 소속 상담사의 성별/생년월일/전화/주소 **조회+수정 모두 가능**
- [x] C2. 타 기관 URL 403(본인 기관 아님), 동일 URL에 타 기관 대상 404
- [x] C3. 대상이 기관 관리자(org_admin)면 PATCH 403 (조회는 허용)
- [x] C4. 사유 필수, 감사+알림 생성, version 낙관적 잠금 409
- [x] C5. 비활성화된 기관에서는 수정 409

## D. 주 담당자
- [x] D1. `PATCH /admin/orgs/{org_id}/primary-admin/profile` — 이름/전화 수정, 사유 필수
- [x] D2. 상담사 프로필 없는 담당자도 수정 가능(프로필 자동 생성 안 함)
- [x] D3. 기관 연락처(Organization.phone/address)와 primary_admin_id 불변
- [x] D4. expected_user_id 불일치(저장 중 교체) 409, 담당자 미지정 404

## E. 공통/계약
- [x] E1. 이메일 변경 API 부재 — 어떤 경로로도 User.email 변경 불가
- [x] E2. 온보딩 FE가 years_of_experience로 전송(계약 정합), 저장 확인
- [x] E3. `cd backend && venv/bin/pytest` 전체 통과
- [x] E4. `cd frontend && npm run build` 0 error

## F. FE 시나리오 (빌드 + 코드 검토 기준)
- [x] F1. 기관 모달 상담사 탭 행 "정보 수정" → 기본/전문 이력/개인정보 패널, 이메일 읽기 전용
- [x] F2. 주 담당자 카드 "담당자 정보 수정" (이름/전화+사유)
- [x] F3. 기관 OrgManagementPage 상담사 목록 테이블+검색/상태필터+정보 수정
- [x] F4. SettingsPage 개인정보 섹션(성별/생년월일/주소) + 저장 시 version 전달
