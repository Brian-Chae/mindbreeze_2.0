## 수정 파일/지점 목록

1. `backend/app/api/v1/admin.py`
   - `ClientCreateRequest`, `ClientCreateResponse`, `ClientCounselorSummary` 또는 동등한 Pydantic 스키마 추가.
   - `POST /admin/clients` 신규 엔드포인트 추가.
   - `GET /admin/users`는 이미 `role` 쿼리 필터를 받으므로 목록 조회는 신규 라우트보다 `GET /admin/users?role=client` 재사용을 우선한다.
   - `POST /admin/users/{user_id}/suspend`, `POST /admin/users/{user_id}/unsuspend`, `DELETE /admin/users/{user_id}`는 그대로 노출하되, 프론트 회원 관리에서는 `role=client` 목록에서만 호출하도록 제한한다.

2. `backend/app/services/admin_service.py`
   - `create_client(...)` 신규 함수 추가.
   - `list_users(...)` 응답 확장: client 화면에 필요한 `status`, `verified_tier`, `phone`, `counselors` 또는 `primary_counselor`를 포함할지 결정해야 한다. 현재는 `status`, `verified_tier`를 반환하지만 프론트 타입은 일부를 버린다.
   - `suspend_user(...)`, `unsuspend_user(...)`, `delete_user(...)`는 재사용하되, client 관리 정책상 삭제 전 역할 검증 옵션을 서비스 레벨에 추가하는 것을 권장한다. 예: `delete_user(user_id, admin_id, db, allowed_roles={"client"})`.

3. `backend/app/schemas/admin.py` 신규 생성 권장
   - 현재 `admin.py` 내부에 `ReviewActionRequest`, `BatchReviewRequest`, `SuspendRequest`가 정의되어 있다. 회원 수동 추가까지 같은 파일에 쌓으면 라우터가 비대해진다.
   - 신규 스키마: `AdminUserListItem`, `AdminUserListResponse`, `AdminClientCreateRequest`, `AdminClientCreateResponse`, `AdminClientCounselorSummary`.
   - 기존 인라인 스키마를 즉시 전부 이동할 필요는 없지만, SDD-020 신규 스키마는 별도 파일에 두는 편이 정합적이다.

4. `backend/app/services/client_service.py`
   - `ClientCounselorLink` 생성 로직은 직접 재사용할 함수가 부족하다.
   - `link_invited_client(...)`는 초대 토큰·이메일 일치·온보딩 step4 저장까지 포함하므로 플랫폼 관리자의 수동 추가에는 그대로 쓰지 않는다.
   - 공통 함수로 `link_client_to_counselor(client_id, counselor_id, db, *, create_room=True, mark_onboarding=True)`를 추출하면 `link_invited_client`, `client_portal.add_counselor_by_code`, 신규 `admin_service.create_client`가 같은 규칙을 공유할 수 있다.

5. `backend/app/services/chat_service.py`
   - 상담사 배정 시 1:1 채팅방을 만들려면 `get_or_create_direct_room(counselor_id, client_id, db)`를 호출한다.
   - 단, 현재 함수 내부에서 `db.commit()`을 수행하므로 신규 client 생성 트랜잭션과 함께 쓰면 중간 커밋이 발생한다. SDD-020에서는 함수에 `commit: bool = True` 옵션을 추가하거나, `admin_service.create_client`에서 링크 생성 후 별도 후처리로 호출하는 방식을 결정해야 한다.

6. `frontend/src/lib/api/admin.ts`
   - `UserDto`에 `status`, `verified_tier`, `phone`, `counselors` 또는 `primary_counselor` 필드 반영.
   - `createAdminClient(payload)` 추가: `POST /admin/clients`.
   - `listUsers({ role: 'client' })`, `suspendUser`, `unsuspendUser`, `deleteUser`는 기존 함수 재사용.
   - 현재 `ActionResponse`는 `success/message`를 기대하지만 백엔드 suspend/unsuspend는 `{ id, status }`, delete는 `204`다. 실제 응답 타입을 `AdminUserActionResponse`로 분리해야 한다.

7. `frontend/src/pages/admin/UserManagementPage.tsx`
   - 페이지를 범용 컴포넌트로 분해: `AdminUserTable`, `AdminUserActionModal`, `AdminUserSearchToolbar`.
   - 현재 title/sub가 `상담사 관리`/`COUNSELOR MANAGEMENT`로 고정되어 있고 role 기본값도 `counselor`다.
   - `/admin/users`는 상담사 관리로 유지하고, `/admin/clients`에서는 동일 컴포넌트에 `fixedRole="client"`, `title="회원 관리"`, `createMode="client"`를 주입하는 구조가 비용 대비 가장 안전하다.

8. `frontend/src/pages/admin/ClientManagementPage.tsx` 신규 생성 권장
   - 얇은 wrapper 페이지로 만들고, 공통화된 사용자 관리 컴포넌트에 client 전용 props를 전달한다.
   - 회원 수동 추가 모달: 이름, 이메일, 전화번호 선택, 상담사 선택 필수, 초대 메일 재발송 상태 표시.

9. `frontend/src/components/layout/SidebarNav.tsx`
   - `ADMIN_NAV_ITEMS`에 `{ to: '/admin/clients', label: '회원 관리', icon: ICONS.users }` 추가.
   - 상담사 관리와 회원 관리를 같은 `/admin/users` 화면의 필터로 숨기지 않는다.

10. `frontend/src/App.tsx`
    - `ClientManagementPage` import.
    - `PlatformAdminRoute` 아래 `/admin/clients` 라우트 추가.

11. 테스트 파일
    - `backend/tests/test_admin_clients.py` 신규: 목록 role 필터, 수동 추가, 상담사 미존재, 이메일 중복, suspend/unsuspend/delete 권한 검증.
    - `frontend/src/pages/admin/__tests__/ClientManagementPage.test.tsx` 또는 기존 테스트 패턴에 맞춘 테스트 추가: client role 조회, 생성 모달 필수값, 액션 호출.

## 엔드포인트/스키마 설계

### 1. 회원 목록 조회

- `GET /admin/users?role=client&q={검색어}&page=1&size=20`
- 권한: `require_platform_admin`.
- 구현 상태: 이미 존재한다. `backend/app/api/v1/admin.py`의 `list_users`가 `role/q/page/size`를 받고 `admin_service.list_users`로 위임한다.
- 서비스 근거: `admin_service.list_users`는 `if role: User.role == role` 필터를 적용하고 `email/name/role/status/suspended/verified_tier/created_at`을 반환한다.
- 보완 응답:

```json
{
  "items": [
    {
      "id": "uuid",
      "email": "client@example.com",
      "name": "홍길동",
      "phone": "010-0000-0000",
      "role": "client",
      "status": "active",
      "suspended": false,
      "verified_tier": "email",
      "primary_counselor": {
        "id": "uuid",
        "name": "상담사",
        "email": "counselor@example.com"
      },
      "created_at": "2026-09-02T..."
    }
  ],
  "total": 1,
  "page": 1,
  "size": 20
}
```

목록 화면에서 상담사 배정 여부가 핵심 요구사항이므로 `ClientCounselorLink`를 조회해 `primary_counselor`를 붙이는 확장이 필요하다. 다중 상담사 연결을 허용하는 현재 모델 구조상 장기적으로는 `counselors: []`가 더 정확하지만, MVP 관리 테이블에는 첫 active 링크만 노출해도 된다. 단, API 스키마 이름은 다중 확장 가능하게 `counselors`를 권장한다.

### 2. 회원 수동 추가 + 상담사 배정

- `POST /admin/clients`
- 권한: `require_platform_admin`.
- 권장 방식: 이메일+이름+상담사 ID로 pending client 계정을 만들고, 비밀번호 설정 초대 메일을 발송한다. 관리자가 임시 비밀번호를 직접 지정하거나 응답으로 받는 방식은 금지한다.

요청:

```json
{
  "name": "홍길동",
  "email": "client@example.com",
  "phone": "010-0000-0000",
  "counselor_id": "uuid",
  "send_invite": true
}
```

응답:

```json
{
  "client": {
    "id": "uuid",
    "email": "client@example.com",
    "name": "홍길동",
    "phone": "010-0000-0000",
    "role": "client",
    "status": "pending",
    "verified_tier": "unverified",
    "counselors": [
      {
        "id": "uuid",
        "name": "상담사",
        "email": "counselor@example.com",
        "status": "active"
      }
    ],
    "created_at": "2026-09-02T..."
  },
  "invite_sent": true
}
```

서비스 처리:

1. 이메일 `.strip().lower()` 정규화.
2. `User.email` 중복 시 `409`.
3. `counselor_id`가 존재하고 `User.role == "counselor"`이며 `User.status in ("active", "pending")` 중 어느 상태를 허용할지 정책화. 권장 기본값은 `active`만 허용.
4. `User(role="client", status="pending", verified_tier="unverified", password_hash=hash_password(secrets.token_urlsafe(32)))` 생성.
5. `ClientProfile(user_id=client.id, concerns=[], interests=[])` 생성.
6. `ClientCounselorLink(client_id=client.id, counselor_id=counselor.id, status="active")` 생성. 중복은 신규 생성에서는 발생하지 않아야 하나 unique 제약 충돌을 `409`로 처리한다.
7. `get_or_create_direct_room(counselor.id, client.id, db)` 호출 여부 결정. 기존 가입/연결 플로우와 맞추려면 생성하는 것이 정합적이다.
8. 초대 토큰 발급과 메일 발송은 SDD-016/017의 초대 기반 비밀번호 설정 흐름을 재사용한다. client 전용 token type이 없으면 `org_invite_service`에 `CLIENT_INVITE_TOKEN_TYPE`을 추가하거나, 별도 `admin_client_invite_service.py`를 만든다.

### 3. 회원 비활성화

- `POST /admin/users/{user_id}/suspend`
- 요청: `{ "reason": "사유" }`
- 응답 권장: `{ "id": "uuid", "status": "suspended" }`
- 구현 상태: 이미 존재한다.
- 정합 판단: SDD-020의 “비활성화”는 현 코드 기준 `status="suspended"`로 정의한다. 브리프의 `inactive`는 아직 구현되지 않았고, `User.status`의 운영 로직도 `active/suspended/pending` 중심이다. 여기서 `inactive`를 새로 넣으면 로그인/권한/목록/배지/필터 전체에 상태 분기 마이그레이션이 필요해 비용이 커진다.

### 4. 회원 비활성화 해제

- `POST /admin/users/{user_id}/unsuspend`
- 요청 body 없음.
- 응답 권장: `{ "id": "uuid", "status": "active" }`
- 구현 상태: 이미 존재한다.
- 회원 관리 UI에서 “활성화” 또는 “정지 해제” 액션으로 노출한다.

### 5. 회원 삭제

- `DELETE /admin/users/{user_id}`
- 응답: `204 No Content`.
- 구현 상태: 이미 존재한다.
- 정합 판단: 기존 hard delete를 재사용할 수는 있으나, 상담/뇌파/리포트 데이터 보존 정책과 충돌 가능성이 크다. SDD-020 MVP에서는 “삭제” 버튼은 유지하되 문구를 “영구 삭제”로 명확히 하고, 별도 확인 문구 입력 또는 2단계 확인을 요구해야 한다.
- 중기 권고: SDD-018 soft delete가 구현되기 전까지 hard delete는 플랫폼 관리자 전용 긴급 운영 기능으로 제한하고, 일반 비활성화는 suspend로 처리한다.

## 기존 코드 재사용 지점

1. `backend/app/api/v1/admin.py::require_platform_admin`
   - 모든 SDD-020 API의 권한 가드로 그대로 재사용한다.

2. `backend/app/api/v1/admin.py::list_users`
   - 회원 목록은 `role=client` 필터로 재사용한다. 별도 `GET /admin/clients`는 만들지 않는 것을 권장한다.

3. `backend/app/services/admin_service.py::list_users`
   - 기본 검색/페이징/role 필터를 재사용한다.
   - 단, client 관리 화면의 상담사 배정 표시를 위해 `ClientCounselorLink` 조인 또는 후속 조회 확장이 필요하다.

4. `backend/app/api/v1/admin.py::suspend` + `admin_service.suspend_user`
   - “비활성화” 기능으로 재사용한다.
   - 현재 플랫폼 관리자 정지만 차단하고 있어 client 화면에서는 프론트가 client 목록에서만 호출하도록 하고, 백엔드에도 `allowed_roles` 방어를 추가하는 편이 더 안전하다.

5. `backend/app/api/v1/admin.py::unsuspend` + `admin_service.unsuspend_user`
   - 비활성화 해제 기능으로 재사용한다.

6. `backend/app/api/v1/admin.py::delete_user` + `admin_service.delete_user`
   - 삭제 기능으로 재사용한다.
   - 이미 `client_counselor_links`, `client_profiles`, `consents`, `onboarding_progress`, `reports`, `eeg_records` 등 FK 자식 테이블을 정리한다.
   - 리스크: 실제 상담 기록/리포트/EEG까지 삭제하므로 감사·보존 정책 승인 전에는 무조건적인 UI 노출이 위험하다.

7. `backend/app/models/client_counselor_link.py::ClientCounselorLink`
   - 상담사 배정 저장 모델로 재사용한다.
   - unique 제약 `uq_client_counselor`가 있으므로 중복 배정은 DB 레벨에서 막힌다.

8. `backend/app/services/client_service.py::link_invited_client`
   - 그대로 호출하지 않고 구현 규칙만 재사용한다: 링크 중복 방지, `status="active"`, 상담사-내담자 채팅방 생성, 온보딩 step4 처리.
   - 초대 토큰 검증과 이메일 일치 검증은 수동 추가 플로우에는 맞지 않다.

9. `backend/app/api/v1/client_portal.py::add_counselor_by_code`
   - 그대로 호출하지 않는다. 현재 사용자 본인 토큰 기준으로 동작하는 client-facing API다.
   - 다만 ended 링크 재활성화, 중복 active 링크 409, 채팅방 생성 규칙은 공통 함수로 추출할 가치가 있다.

10. `frontend/src/pages/admin/UserManagementPage.tsx`
    - 테이블, 검색, 페이징, 정지/해제/삭제 모달 UX는 재사용한다.
    - title, role 기본값, role 필터 노출, 수동 추가 모달, 상담사 선택은 client 전용 wrapper 또는 props로 분리해야 한다.

11. `frontend/src/lib/api/admin.ts`
    - `listUsers`, `suspendUser`, `unsuspendUser`, `deleteUser` 재사용.
    - `createAdminClient`와 타입 확장은 신규 추가.

## 페이지 분리 vs 필터 판단

권고: 별도 `/admin/clients` 페이지를 만든다. 단, 내부 구현은 기존 `UserManagementPage`를 복제하지 말고 공통 컴포넌트로 분해해 재사용한다.

판단 근거:

1. 제품 IA 관점에서 플랫폼 관리자 메뉴는 이미 “기관 관리”와 “상담사 관리”가 별도 메뉴다. Brian 요구도 “회원관리도 넣어주자”, “상담사 관리 페이지처럼 구현”이므로 메뉴 레벨 분리가 자연스럽다.
2. 기존 `/admin/users`는 화면 제목과 기본 role이 상담사에 고정되어 있다. 필터만 `client`로 바꾸면 URL, 메뉴명, 화면 제목이 “상담사 관리”인 상태에서 내담자를 관리하게 되어 운영자 인지가 나빠진다.
3. 회원 수동 추가에는 상담사 배정 필드가 필수다. 상담사 관리의 생성/초대 플로우와 입력 폼이 다르므로 같은 화면의 role 필터 안에 넣으면 조건부 UI가 늘어난다.
4. API 비용은 낮다. 목록/정지/해제/삭제는 기존 `/admin/users`를 재사용하고, 신규 API는 `POST /admin/clients` 하나면 충분하다.
5. 프론트 비용도 중간 이하다. `/admin/clients` wrapper + 공통 테이블/모달 추출이 필요하지만, 운영 화면 정합성과 이후 확장성을 고려하면 필터 방식보다 유지보수 비용이 낮다.
6. `/admin/users?role=client`를 직접 북마크하거나 URL 쿼리로 쓰는 방식은 “회원 관리”의 독립 권한/감사/삭제 정책을 표현하기 어렵다.

대안인 `/admin/users` 필터 통합은 초기 diff가 가장 작다. 하지만 제목, 사이드바, CTA, 생성 폼, 상담사 배정, 삭제 경고 문구가 모두 role별 조건으로 갈라져 단일 컴포넌트가 빠르게 비대해진다. 따라서 구현 비용만 보면 단기적으로 필터 방식이 1차 MVP에 유리하지만, 정합성과 운영 UX까지 보면 `/admin/clients` 분리가 맞다.

## 최종 권고안

SDD-020은 “별도 페이지 + 기존 사용자 API 재사용 + client 생성 API 1개 신규”로 구현한다.

구체안:

1. `/admin/clients` 라우트와 사이드바 메뉴를 추가한다.
2. 목록은 `GET /admin/users?role=client`를 사용한다.
3. 수동 추가는 `POST /admin/clients` 신규 엔드포인트로 만든다.
4. 수동 추가 방식은 “pending 계정 + 비밀번호 설정 초대 메일”로 고정한다. 관리자 직접 비밀번호 지정과 임시 비밀번호 응답 반환은 금지한다.
5. 상담사 배정은 생성 트랜잭션 안에서 `ClientCounselorLink(status="active")`로 저장한다.
6. 상담사 선택 데이터는 플랫폼 관리자 기준 `GET /admin/users?role=counselor&size=100` 재사용으로 시작한다. 기관별 제한이 필요해지면 별도 `org_id` 필터를 추가한다.
7. 비활성화는 `suspend_user` 재사용으로 `status="suspended"`에 매핑한다. `inactive`는 SDD-018 soft delete 구현 전까지 도입하지 않는다.
8. 삭제는 기존 hard delete 엔드포인트를 재사용하되, UI 문구를 “영구 삭제”로 바꾸고 2단계 확인을 붙인다. 데이터 보존 정책이 승인되기 전까지는 기본 운영 액션은 suspend여야 한다.
9. `UserManagementPage`는 그대로 복제하지 말고, 공통 사용자 관리 테이블과 액션 모달을 추출한다.
10. 백엔드 응답 타입과 프론트 `ActionResponse` 불일치를 이번 범위에서 정리한다.

필수 보완 포인트:

1. `admin_service.list_users`에 role allowlist를 추가해야 한다. 지금은 임의 문자열도 쿼리되어 단순히 빈 결과가 나온다. API 계약상 `platform_admin|org_admin|counselor|client` 외 값은 `422`가 낫다.
2. `admin_service.list_users` 응답에 `status`가 있는데 `frontend/src/lib/api/admin.ts::UserDto`에는 없다. 타입 불일치를 정리해야 상태 배지와 pending 표시가 확장 가능하다.
3. `ActionResponse` 타입이 실제 suspend/unsuspend/delete 응답과 맞지 않는다. 현재 UI는 반환값을 거의 쓰지 않아 숨은 문제로 남아 있지만, SDD-020에서 생성 응답까지 추가하면 타입 부채가 커진다.
4. 수동 추가 시 `Consent`를 어떻게 처리할지 명시해야 한다. 관리자가 민감정보 동의를 대신 체크하는 것은 위험하므로, pending 계정 생성 단계에서는 동의 레코드를 만들지 않고 최초 로그인/온보딩에서 받는 것을 권장한다.
5. `ClientProfile` 초기 생성 여부를 결정해야 한다. 목록/상세에서 프로필 조인이 많으므로 빈 프로필을 생성하는 편이 프론트 분기를 줄인다.
6. `OnboardingProgress`를 생성 시점에 만들지, 초대 수락 후 만들지 정해야 한다. 상담사 배정은 이미 완료됐지만 필수 동의/기본정보가 남아 있으므로 `current_step=1`, `completed=false`, `steps.step4` 사전 저장은 가능하나 UX와 맞춰야 한다.
7. 상담사 배정은 active 상담사만 허용해야 한다. pending/suspended counselor에 내담자를 배정하면 세션/채팅 UX가 끊긴다.
8. `ClientCounselorLink`의 다중 상담사 허용 정책을 문서화해야 한다. 모델은 다중 링크를 허용하므로 “수동 추가 시 1명 필수, 이후 추가 배정 가능 여부”를 SDD-020 범위에서 고정해야 한다.
9. `get_or_create_direct_room`의 내부 commit이 신규 client 생성 트랜잭션을 깨뜨릴 수 있다. 링크/프로필/초대 생성 중 일부만 커밋되는 상태를 막기 위해 commit 경계를 정리해야 한다.
10. 기존 `delete_user`는 hard delete이며 `reports`, `eeg_records`, `chat_messages`, `sessions`까지 삭제한다. 상담/의료성 데이터 보존 정책 없이 “삭제”를 일반 관리 액션처럼 제공하면 감사 리스크가 있다.
11. 삭제/정지 대상이 client인지 백엔드에서 한 번 더 확인해야 한다. 프론트가 client 목록에서만 버튼을 보여도 직접 API 호출로 counselor/org_admin 계정에 같은 액션을 수행할 수 있다.
12. 초대 메일 발송 실패 상태를 응답과 UI에 표시해야 한다. 생성은 성공했지만 메일 발송이 실패한 경우 재발송 액션 없이는 운영자가 복구하기 어렵다.
13. 이메일 정규화 정책을 기존 `org_service.invite_counselor`처럼 `.strip().lower()`로 맞춰야 한다. 일반 가입의 이메일 검증 흐름과 충돌하지 않도록 중복 검사 기준도 동일해야 한다.
14. 회원 관리 화면에서 role 필터는 숨기는 것이 낫다. `/admin/clients`에서 role 변경을 허용하면 다시 범용 사용자 관리 화면이 되어 IA 분리 목적이 흐려진다.
15. 테스트는 “상담사 관리 페이지처럼 보인다”가 아니라 API 계약을 먼저 고정해야 한다. 특히 `POST /admin/clients`가 `User`, `ClientProfile`, `ClientCounselorLink`, 초대 상태를 한 트랜잭션처럼 다루는지 검증해야 한다.

최종 구현 우선순위:

1. 백엔드 스키마와 `POST /admin/clients`를 먼저 만든다.
2. `admin_service.create_client`에서 User/Profile/Link/Invite 계약을 고정한다.
3. 기존 `GET /admin/users?role=client`, suspend, unsuspend, delete 테스트를 client role 기준으로 보강한다.
4. 프론트 공통 사용자 관리 컴포넌트를 추출한다.
5. `/admin/clients` wrapper, 사이드바, 라우트를 추가한다.
6. 수동 추가 모달과 상담사 선택을 연결한다.
7. 삭제 경고와 메일 발송 실패/재발송 UX를 붙인다.
