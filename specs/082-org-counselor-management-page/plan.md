# SDD-082 — Plan (Stage ②)

> 기관 관리자 상담사 관리 페이지: BE 상태 관리·이력 API + FE 전용 페이지.

## 아키텍처 결정

1. **suspend/unsuspend는 org_service에 신설** — admin_service.suspend_user(플랫폼 전용)를 호출하지 않고
   기관 컨텍스트 검증(membership + role)을 포함한 별도 함수로 둔다. 감사 액션은
   `org_counselor_suspend` / `org_counselor_unsuspend`로 플랫폼 액션(`suspend`/`unsuspend`)과 구분한다.
2. **정지 대상은 `status == "active"`인 counselor만** — pending(초대 미수락) 계정을 정지→해제하면
   비밀번호 없이 active가 되는 버그를 막는다. org_admin·자기 자신은 403.
3. **목록 상태 표기** — `_counselor_to_response`에서 계정 `status == "suspended"`가 membership 상태보다
   우선한다 (기존 pending/active 로직은 유지, 기존 테스트 불변).
4. **검색용 counselor_code + 개인 상담소 구분** — CounselorResponse에 `counselor_code`,
   `has_personal_office`(kind=individual 소속 여부) 필드를 additive로 추가.
5. **최근 이력** — `Session.host_id == 대상` 기준 최근 10건(기존 org_dashboard와 동일 기준) +
   해당 세션들의 Report 최근 10건. 메타데이터(제목/상태/일시/참여자 수)만 노출, 내용은 노출하지 않는다.
6. **FE org_id 소스** — FE User 타입에 org_id가 없으므로 OrgDashboardPage와 동일하게
   `getOrgDashboard().org_id`를 사용한다.
7. **라우트** — `/org/counselors` (static segment가 `/org/:org_id`보다 우선 매칭됨, React Router v6 랭킹).

## Task 목록

### T1. BE — 상태 관리 API
- `app/schemas/org.py`: `CounselorStatusChangeRequest`(reason 필수), `CounselorStatusResponse`,
  activity 스키마 3종, CounselorResponse에 `counselor_code`/`has_personal_office` 추가
- `app/services/org_service.py`: `set_counselor_suspension()` — 검증 + VerificationAudit + 대상자 알림 + commit
- `app/api/v1/org.py`: `POST /{org_id}/counselors/{user_id}/suspend`, `POST .../unsuspend`

### T2. BE — 최근 이력 API
- `app/services/org_service.py`: `get_counselor_activity()` — 세션 10건 + 리포트 10건
- `app/api/v1/org.py`: `GET /{org_id}/counselors/{user_id}/activity`

### T3. BE — 목록 응답 확장
- `_counselor_to_response`: suspended 우선 표기 + counselor_code + has_personal_office
- `list_counselors`: 개인 상담소(kind=individual) 소속 user_id 집합을 1쿼리로 계산

### T4. FE — API 클라이언트
- `lib/api/org.ts`: `suspendCounselor`, `unsuspendCounselor`, `getCounselorActivity` + 타입 확장

### T5. FE — 사이드바 + 라우트 + 페이지
- `SidebarNav.tsx`: ORG_ADMIN_NAV_ITEMS에 `{ to: '/org/counselors', label: '상담사', icon: users }`
- `App.tsx`: lazy import + `<Route path="/org/counselors" element={<RoleGuard role="org_admin">...}` 
- `pages/org/OrgCounselorsPage.tsx` 신설:
  - 검색(이름/이메일/코드) + 필터(역할/상태) + 상태 배지(활성/대기/정지)
  - 행 액션: 정보 수정(CounselorInfoEditor 재사용) / 활성화·비활성화(사유 입력 다이얼로그) / 이력 보기
  - 상세 패널: 프로필 정보(getOrgCounselorProfile) + 최근 이력 탭(세션/리포트)

### T6. 테스트
- `backend/tests/test_sdd082_org_counselor_management.py` — verify.md 시나리오
- `cd backend && venv/bin/pytest` 전체 통과, `cd frontend && npm run build` 0 error

## 변경 파일

| 파일 | 변경 |
|---|---|
| backend/app/schemas/org.py | 스키마 추가/확장 |
| backend/app/services/org_service.py | suspension + activity 서비스 |
| backend/app/api/v1/org.py | 엔드포인트 3개 + 목록 응답 확장 |
| backend/tests/test_sdd082_org_counselor_management.py | 신규 |
| frontend/src/lib/api/org.ts | API 함수/타입 추가 |
| frontend/src/components/layout/SidebarNav.tsx | 메뉴 추가 |
| frontend/src/App.tsx | 라우트 추가 |
| frontend/src/pages/org/OrgCounselorsPage.tsx | 신규 페이지 |
