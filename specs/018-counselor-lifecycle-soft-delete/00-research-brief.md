# SDD-018 연구 브리프 — 상담사 계정 생명주기 재설계

## Brian 최종 결정 (원문)
> "소프트 삭제로 처리하자. 일단 영구 삭제는 플랫폼 관리자만 할 수 있고 기관 관리자는 삭제는 아니고 활성화, 비활성화만 설정할 수 있도록 만들자. 이건 상담사 DB 의 기능을 전체적으로 변화하는 일이고 기관, 플랫폼, 상담사의 UX 및 프론트에 반영되어야할 복잡한 수정이다. 모든 에이전트를 동원해서 검토하고 수정안 기획을 만들어라"

## 확정 사실 (코드 근거)
1. 사용자 상태 모델은 `backend/app/models/user.py`에 `status: String(20)` 하나만 있고 `deleted_at`, `deleted_by`는 아직 없다.
2. 기관 관리자 상담사 목록 API는 `backend/app/api/v1/org.py`의 `GET /org/{org_id}/counselors`이며, 현재 응답은 `id,name,email,role,status,invited_at,invite_expires_at` 중심이다.
3. 기관 관리자 상담사 변경 API는 현재 두 가지뿐이다.
   - `PUT /org/{org_id}/counselors/{user_id}` → 역할 변경 (`body: dict`)
   - `DELETE /org/{org_id}/counselors/{user_id}` → 실제 의미는 계정 삭제가 아니라 소속 해제 (`org_service.remove_counselor`)
4. `org_service.get_counselors()`는 `counselor`와 `org_admin`을 함께 반환한다.
5. `org_service.remove_counselor()`는 자기 자신/마지막 org_admin/primary_admin 보호가 없다.
6. 플랫폼 관리자 하드 삭제는 `backend/app/services/admin_service.py`의 `delete_user()`이며, 세션/리포트/EEG/링크/토큰 등 자식 레코드를 삭제한 뒤 users 레코드도 제거한다.
7. 플랫폼 관리자 정지/해제는 이미 `suspend_user()` / `unsuspend_user()` + `VerificationAudit` 패턴이 존재한다.
8. 비밀번호 초기화는 `backend/app/services/password_reset_service.py`를 사용한다. 현재 문제:
   - reset link가 절대 프론트 URL이 아니라 `/auth/password/reset?...` 상대경로
   - complete_reset 후 기존 refresh token 전체 폐기가 없다
   - 초기화 요청 레이트리밋이 없다
9. 기관 관리자 프론트는 `frontend/src/pages/OrgDashboardPage.tsx`에 초대/재발송/초대·가입 현황이 들어가 있지만, 별도 상담사 관리 페이지는 없다.
10. 기관 관리자 사이드바 `frontend/src/components/layout/SidebarNav.tsx`에는 아직 "상담사" 메뉴가 없다.
11. 플랫폼 관리자 프론트는 `frontend/src/pages/admin/UserManagementPage.tsx`에서 상담사 정지/해제/삭제를 수행한다.
12. 상담사 직접가입 프론트는 이미 숨겨져 있고 초대 기반 온보딩이 기본이다.

## 이번 설계의 목표
- 상담사 계정의 생명주기를 `pending / active / suspended / deleted` 중심으로 재정의한다.
- 삭제 정책을 soft delete 기본으로 전환한다.
- 하드 삭제는 platform_admin 전용으로 남긴다.
- org_admin은 자기 기관 소속 상담사에 대해 "활성화/비활성화"만 제어하고, 회원정보 수정 및 비밀번호 초기화 요청을 수행한다.
- 기관 관리자 / 플랫폼 관리자 / 상담사 3개 역할의 UX와 정책을 함께 재설계한다.
- 데이터 보존(상담 기록/리포트/EEG), 권한 경계, 감사로그, 이메일 재사용 정책까지 포함한다.

## 검토 대상 파일
- backend/app/models/user.py
- backend/app/api/v1/org.py
- backend/app/services/org_service.py
- backend/app/services/admin_service.py
- backend/app/services/password_reset_service.py
- frontend/src/pages/OrgDashboardPage.tsx
- frontend/src/components/layout/SidebarNav.tsx
- frontend/src/pages/admin/UserManagementPage.tsx
- frontend/src/lib/api/org.ts

## 반드시 답해야 할 쟁점
1. soft delete를 `status='deleted'`만으로 표현할지, `deleted_at/deleted_by`를 함께 둘지
2. 로그인/토큰 refresh/조회 쿼리/API 목록에서 deleted 계정을 어떻게 배제할지
3. org_admin의 활성/비활성 정책과 platform_admin의 정지/삭제 정책을 어떻게 구분할지
4. org_admin이 수정 가능한 필드를 어디까지 허용할지 (이름/전화/이메일)
5. 비밀번호 초기화 메일을 어떤 서비스/토큰 흐름으로 재사용할지
6. deleted 계정의 이메일 재사용 정책을 tombstone으로 풀지, 재활성화로 풀지
7. 기관/플랫폼/상담사 UI에서 deleted/suspended 상태를 어떻게 보여줄지
8. 기존 `DELETE /org/{org_id}/counselors/{user_id}` 의미 충돌을 어떻게 정리할지
9. 감사로그/레이트리밋/세션폐기 등 보안 보강 포인트
10. SDD 문서 구조상 어떤 범위를 spec/plan/verify에 넣을지

## 산출물 규칙
- 코드 수정 금지, 설계 문서만 작성
- 한국어로 작성
- 추측하지 말고 코드 근거를 인용
- 최소 5개 이상의 구체적 리스크/결함을 포함
- 무비판 동의 금지. 기존 구현과 내 브리프의 판단이 틀렸으면 명시적으로 반박
