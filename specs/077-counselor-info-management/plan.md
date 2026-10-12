# SDD-077 — Plan (Stage ②)

> 상담사 정보 관리 P0. 정책 확정: 기관 관리자에게 성별·생년월일·전화·주소 전부 허용(감사 필수),
> 이메일 변경 없음(읽기 전용), 주 담당자 이름·전화 수정(교체 아님).

## 아키텍처 결정

1. **저장 구조**: `CounselorProfile` 확장(주소 3필드 + version). User는 name/phone/profile_image/bio만.
   Career/Qualification 재사용(전체 삭제 후 재삽입 — 기존 me/profile 패턴 유지, 단순화 우선).
2. **공통 서비스** `counselor_info_service.py`: 3자(본인/플랫폼/기관) 공용 조회·수정 로직.
   - `serialize(user)` → 공통 응답 번들(version 포함)
   - `update_profile(target, req, db, actor_id, actor_label)` → 필드 반영 + version 낙관적 잠금(409)
     + 관리자 수정 시 감사(VerificationAudit) + 인앱 알림(민감정보 원문 미포함)을 **한 트랜잭션**으로 커밋
3. **대량 할당 차단**: Update 스키마에 `email/role/org_id/verified_tier/status/counselor_code`를
   선언해두고 전송 시 403. 그 외 미지 필드는 `extra="forbid"` → 422.
4. **PATCH 의미론**: `model_fields_set` 기준 — 미전송 유지, null 전송은 삭제(선택 필드),
   name은 null/공백 불가(422). 성별/생년월일 미입력 보존(임의 기본값 없음).
5. **프로필 없는 대상**: 프로필 필드 수정 시 기존 코드 발급 정책(`onboarding_service.generate_counselor_code`)으로 생성.
6. **온보딩 계약 정합**: FE `experience_years` → `years_of_experience`로 수정(BE 스키마가 정답).

## 파일 목록

### Backend
| 파일 | 작업 |
|---|---|
| `app/models/counselor_profile.py` | postal_code/address_line1/address_line2/version 추가 |
| `alembic/versions/e036a0000010_sdd_077_counselor_info.py` | 신규 (down_revision=e036a0000009) |
| `app/schemas/counselor_info.py` | 신규 — CounselorInfoResponse/Update, 목록, 주 담당자 Patch |
| `app/services/counselor_info_service.py` | 신규 — 공통 조회/수정/감사/알림 |
| `app/api/v1/auth.py` | me/profile GET/PATCH를 공통 서비스로 확장(신규 필드+version) |
| `app/api/v1/admin.py` | `GET /admin/counselors`, `GET/PATCH /admin/counselors/{id}/profile`, `PATCH /admin/orgs/{org_id}/primary-admin/profile` |
| `app/api/v1/org.py` | `GET/PATCH /org/{org_id}/counselors/{id}/profile` |
| `app/schemas/auth.py` | CounselorProfileResponse/Update 필드 확장 |
| `tests/test_sdd077_counselor_info.py` | 신규 |

### Frontend
| 파일 | 작업 |
|---|---|
| `src/lib/api/counselor.ts` | 타입 확장(성별/생년월일/주소/version) |
| `src/lib/api/admin.ts` | 상담사 목록/프로필/주 담당자 API 추가 |
| `src/lib/api/org.ts` | 기관 상담사 프로필 API 추가 |
| `src/components/counselor/counselor-info-editor.tsx` | 신규 — 3패널(기본/전문 이력/개인정보) 공용 편집 폼(플랫폼·기관 공용, 사유 필수) |
| `src/components/admin/org-detail-modal.tsx` | 상담사 행 "정보 수정" + 주 담당자 카드 "담당자 정보 수정" |
| `src/components/admin/primary-admin-edit.tsx` | 신규 — 이름/전화 수정 폼 |
| `src/pages/org/OrgManagementPage.tsx` | 상담사 목록 테이블+검색/필터 + 정보 수정 |
| `src/components/settings/PersonalInfoSection.tsx` | 신규 — 본인 성별/생년월일/주소 |
| `src/pages/SettingsPage.tsx` | PersonalInfoSection 연결 + version 전달 |
| `src/pages/onboarding/CounselorOnboardingPage.tsx` | experience_years → years_of_experience |

## Task 순서
1. T1 모델+마이그레이션 → 2. T2 스키마/서비스 → 3. T2 API 3종+주담당자 → 4. T3 테스트(pytest)
→ 5. T4 FE API 클라이언트 → 6. T4 FE 화면 4종 → 7. 빌드/테스트 게이트
