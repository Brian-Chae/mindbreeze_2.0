# SDD-020 연구 브리프 — 플랫폼 관리자 회원(내담자) 관리

## Brian 요구 (원문)
> "플랫폼 관리자 로그인시 회원관리도 넣어주자. 회원의 수동 추가 (상담사 배정 필요), 비활성화, 삭제 관련 기능 넣어서 상담사 관리 페이지처럼 구현. SDD 로 편성. 멀티에이전트"

## 목표
- 플랫폼 관리자(platform_admin) 콘솔에 "회원 관리"(내담자/client) 메뉴를 추가한다.
- 상담사 관리 페이지와 동일한 UX/구조로, 회원 목록·수동 추가(상담사 배정)·비활성화·삭제를 제공한다.

## 확정 사실 (코드 근거)
1. 플랫폼 관리자 사이드바(`SidebarNav.tsx` ADMIN_NAV_ITEMS) = 기관 관리(`/admin/orgs`) + 상담사 관리(`/admin/users`) 2개.
2. `/admin/users`는 `UserManagementPage`("상담사 관리" 라벨). `listUsers({ role, q, page, size })`로 **role 필터가 이미 있음** — 현재 role 기본값 `counselor`, 옵션에 client도 존재.
3. 백엔드 `admin.py`:
   - `GET /admin/users`(role/q/page/size) → `admin_service.list_users` (role 필터 O)
   - `POST /admin/users/{id}/suspend` / `POST /admin/users/{id}/unsuspend` / `DELETE /admin/users/{id}` (hard delete, FK 자식 정리)
   - 전부 `require_platform_admin`
4. `admin_service.list_users` 응답: id/email/name/role/status/suspended/verified_tier/created_at.
5. 회원 수동 추가 API는 **없다**. 상담사 배정은 `client_service.link_invited_client`(초대 토큰) 또는 `client_portal.add_counselor_by_code`(수동 코드)가 `ClientCounselorLink`를 생성.
6. `ClientCounselorLink(client_id, counselor_id, status)` 모델 존재. `user.role == "client"` = 회원(내담자).

## 반드시 답해야 할 쟁점
1. 별도 페이지 `/admin/clients`(회원 관리) vs 기존 `/admin/users`에 탭/필터로 분리 — 어느 쪽이 적절한가.
2. 회원 수동 추가 방식: (a) 이메일+이름+임시 비밀번호, (b) 초대 메일, (c) 관리자가 비밀번호 직접 지정. 어느 쪽.
3. 상담사 배정: 수동 추가 시 상담사 선택 UI + ClientCounselorLink 생성. 상담사 목록 조회 API 재사용 여부.
4. "비활성화" 의미: 기존 `suspend`(정지)와 동일하게 쓸지, SDD-018에서 기획한 `inactive` 상태를 쓸지. (SDD-018 soft delete는 아직 구현 안 됨 — 현재는 active/suspended만)
5. 삭제: 기존 hard delete(연쇄 삭제) 재사용 여부, 데이터 보존 이슈.
6. client 계정 생성 시 필요한 필수값(password_hash, verified_tier, consents, onboarding_progress)과 검증 생략 범위.
7. 기존 상담사 관리 페이지와 코드/컴포넌트 공유 여부.

## 검토 대상 파일
- backend/app/api/v1/admin.py
- backend/app/services/admin_service.py
- backend/app/services/client_service.py (link_invited_client, ClientCounselorLink)
- backend/app/api/v1/client_portal.py (add_counselor_by_code)
- backend/app/models/client_counselor_link.py
- frontend/src/pages/admin/UserManagementPage.tsx
- frontend/src/lib/api/admin.ts
- frontend/src/components/layout/SidebarNav.tsx

## 산출물 규칙
- 코드 수정 금지, 설계 문서만. 한국어. 코드 근거 인용.
- 무비판 동의 금지. 누락/리스크 명시. 최소 5개 이상 구체 리스크.
