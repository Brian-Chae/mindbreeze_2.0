## 상태 전이 모델

### 현재 코드 근거

- `User`는 `email` unique, `role`, `status`, `org_id`, `invited_at`, `invite_expires_at`만 갖고 있으며 `deleted_at`, `deleted_by`, `disabled_at`, `status_reason`은 없다. 근거: `backend/app/models/user.py:35-49`
- 기관 상담사 목록은 `GET /org/{org_id}/counselors`이고, 응답은 `id/name/email/role/status/invited_at/invite_expires_at`이다. 근거: `backend/app/api/v1/org.py:35-44`, `backend/app/api/v1/org.py:162-171`
- org_admin 변경 API는 `PUT /org/{org_id}/counselors/{user_id}` 하나가 `body: dict`에서 `role`만 꺼낸다. 근거: `backend/app/api/v1/org.py:217-230`
- org_admin 삭제 API로 보이는 `DELETE /org/{org_id}/counselors/{user_id}`는 실제로 `remove_counselor()`를 호출해 `user.org_id = None`으로 만든다. 근거: `backend/app/api/v1/org.py:233-242`, `backend/app/services/org_service.py:313-336`
- platform_admin의 `DELETE /admin/users/{user_id}`는 FK 자식 레코드를 삭제한 뒤 `db.delete(user)`를 수행하는 hard delete이다. 근거: `backend/app/api/v1/admin.py:164-175`, `backend/app/services/admin_service.py:360-413`

### 통합 상태 정의

`User.status`를 단일 계정 생명주기 상태로 유지하되, soft delete 추적 컬럼을 추가한다. `status='deleted'`만으로는 누가 언제 어떤 사유로 삭제했는지, 이메일 재사용 가능 시점을 판단할 수 없으므로 충분하지 않다.

- `pending`: 초대 또는 가입 신청 이후 비밀번호 미설정/초대 미수락 상태. 로그인, refresh, 일반 서비스 접근 불가. 초대 재발송 가능.
- `active`: 정상 사용 가능. 상담사 공개 노출, 세션 생성/참여, 리포트/채팅 등 도메인 기능 가능.
- `inactive`: org_admin이 기관 운영 목적으로 비활성화한 상태. 계정은 삭제되지 않고 기관 소속도 유지한다. 로그인은 막거나 허용하더라도 상담사 업무 권한은 막아야 하는데, 권한 단순성을 위해 로그인/refresh 모두 차단하는 쪽을 권고한다.
- `suspended`: platform_admin이 보안/정책 위반으로 정지한 상태. 전역 차단이며 org_admin이 해제할 수 없다.
- `deleted`: platform_admin 또는 향후 계정 삭제 정책에 의해 soft delete된 상태. 기본 조회/로그인/API/초대 대상에서 제외한다. hard delete 전까지 FK 데이터는 보존한다.

추가 컬럼 권고:

- `deleted_at TIMESTAMPTZ NULL`
- `deleted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL`
- `disabled_at TIMESTAMPTZ NULL`
- `disabled_by UUID NULL REFERENCES users(id) ON DELETE SET NULL`
- `status_reason TEXT NULL`
- `status_changed_at TIMESTAMPTZ NULL`
- `status_changed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL`

최소 구현으로 줄이려면 `deleted_at/deleted_by/status_reason/status_changed_at/status_changed_by`만 먼저 넣고, org_admin 비활성화 이력은 `VerificationAudit`로 보완할 수 있다. 다만 UI에서 "비활성화 일시/처리자"를 자주 보여줄 가능성이 높으므로 별도 컬럼을 두는 편이 실제 구현 비용을 줄인다.

### 상태 전이 규칙

| 현재 상태 | 행위자 | 액션 | 다음 상태 | 허용 조건 |
|---|---|---|---|---|
| 없음 | org_admin | 상담사 초대 | `pending` | 동일 active/pending/suspended 이메일 없음, deleted 이메일 정책 통과 |
| `pending` | 초대 사용자 | 초대 수락/비밀번호 설정 | `active` | 초대 토큰 유효, `deleted_at IS NULL`, org 소속 유지 |
| `pending` | org_admin | 초대 취소 | `deleted` 또는 `inactive` | 아직 수락 전. 권고는 `deleted` soft tombstone + 초대 토큰 폐기 |
| `active` | org_admin | 비활성화 | `inactive` | 같은 org 소속, 대상이 platform_admin 아님, 마지막/primary org_admin 보호 |
| `inactive` | org_admin | 활성화 | `active` | `suspended/deleted`가 아니고 같은 org 소속 |
| `active/inactive/pending` | platform_admin | 정지 | `suspended` | 대상이 platform_admin 아님, 사유 필수 |
| `suspended` | platform_admin | 정지 해제 | `active` 또는 이전 운영 상태 | 이전 상태 저장 없으면 `active`로 복구. 권고는 `previous_status` 감사 extra에 저장 |
| `active/inactive/pending/suspended` | platform_admin | soft delete | `deleted` | 대상이 platform_admin 아님, refresh token 폐기, 초대/reset 토큰 폐기 |
| `deleted` | platform_admin | 복구 | `inactive` 또는 `active` | 이메일 unique 정책 충돌 없음, 사유 필수 |
| `deleted` | platform_admin | hard purge | 물리 삭제 | 보존기간/법무 승인/운영 사유 충족, 별도 엔드포인트 |

중요 보완 포인트:

1. org_admin의 "비활성화"와 platform_admin의 "정지"를 같은 `suspended`로 합치면 해제 권한이 충돌한다. 반드시 `inactive`와 `suspended`를 분리한다.
2. `pending` 초대도 삭제/취소 대상이다. 수락 전 계정은 `org_id`가 있으므로 목록과 이메일 unique 정책에 계속 영향을 준다.
3. `deleted`는 기본 API에서 숨기되, platform_admin 감사/복구 화면에서는 `include_deleted=true`로만 노출한다.
4. `deleted` 계정의 refresh token, password reset token, invite token은 즉시 무효화한다.
5. `suspended` 해제 시 무조건 `active`로 두면 org_admin이 비활성화한 사용자가 플랫폼 정지 해제 후 활성화되는 결함이 생긴다. `previous_status`를 감사 extra 또는 별도 컬럼으로 남긴다.
6. org_admin 자기 자신, 마지막 org_admin, `Organization.primary_admin_id` 대상은 role 변경/비활성화/소속해제에서 차단한다.
7. `org_admin`도 상담사 목록에 포함되는 현재 계약을 유지할지 분리할지 결정해야 한다. 권고는 목록은 유지하되 `role`과 `manageable_actions`로 UI 액션을 제한한다.
8. 상태값은 Python/TypeScript 양쪽에 문자열 union으로 고정한다. 현재 프론트는 `pending | active`만 허용해 `inactive/suspended/deleted` 응답을 타입상 표현하지 못한다. 근거: `frontend/src/lib/api/org.ts:35-46`

## 엔드포인트/스키마 변경안

### 의미 충돌 정리

현재 `DELETE /org/{org_id}/counselors/{user_id}`는 이름과 HTTP verb가 삭제처럼 보이지만 실제 의미는 소속 해제이다. soft delete 전환 이후 이 엔드포인트를 "삭제"로 재해석하면 기존 `removeCounselor()` 호출부가 갑자기 계정 삭제를 유발할 수 있다. 반대로 그대로 두면 사용자에게 "삭제"와 "비활성화"의 의미가 계속 섞인다.

권고안:

- 신규 명시 엔드포인트를 추가한다.
  - `PATCH /org/{org_id}/counselors/{user_id}/role`
  - `PATCH /org/{org_id}/counselors/{user_id}/status`
  - `POST /org/{org_id}/counselors/{user_id}/password-reset`
  - `POST /org/{org_id}/counselors/{user_id}/cancel-invite`
  - `POST /org/{org_id}/counselors/{user_id}/detach` 또는 `DELETE /org/{org_id}/members/{user_id}`
- 기존 `PUT /org/{org_id}/counselors/{user_id}`는 1개 릴리스 동안 role 변경 alias로 유지하되 응답 헤더에 `Deprecation: true`와 `Link: <.../role>; rel="successor-version"`를 붙인다.
- 기존 `DELETE /org/{org_id}/counselors/{user_id}`는 계정 삭제로 바꾸지 않는다. 1개 릴리스 동안 `detach` alias로 유지하거나, UI 교체가 끝난 뒤 `410 Gone`으로 폐기한다.
- org_admin은 계정 삭제 API를 갖지 않는다. org_admin UI의 위험 액션 문구는 "삭제"가 아니라 "비활성화", "초대 취소", "소속 해제"로 분리한다.
- platform_admin의 기존 `DELETE /admin/users/{user_id}`는 soft delete로 의미를 바꾸고, hard delete는 `DELETE /admin/users/{user_id}/hard-delete` 또는 `POST /admin/users/{user_id}/purge`로 새로 격리한다.

### org_admin 엔드포인트

`PATCH /org/{org_id}/counselors/{user_id}/role`

```json
{
  "role": "counselor | org_admin",
  "reason": "선택"
}
```

- 응답: `CounselorResponse`
- 보호: 같은 org 소속, `status != deleted`, 자기 자신 강등 금지, 마지막 org_admin 강등 금지, primary_admin 강등 금지.
- 기존 `PUT`의 `body: dict`를 Pydantic 스키마 `CounselorRoleUpdate`로 대체한다. 현재 dict는 오타/불필요 필드를 조용히 받아 계약 검증이 약하다. 근거: `backend/app/api/v1/org.py:217-230`

`PATCH /org/{org_id}/counselors/{user_id}/status`

```json
{
  "status": "active | inactive",
  "reason": "필수: inactive 전환 시"
}
```

- org_admin은 `active/inactive`만 설정 가능하다.
- `pending`은 이 엔드포인트로 `active` 전환하지 않는다. 초대 수락만 `active`로 만든다.
- `suspended/deleted` 대상은 409로 거부한다. platform_admin 상태를 org_admin이 덮어쓰면 안 된다.
- 비활성화 시 `refresh_token_service.revoke_all_user_tokens()`를 호출한다.
- 활성화 시 초대 미수락 `pending`은 409로 거부하고 재초대 액션을 안내한다.

`POST /org/{org_id}/counselors/{user_id}/password-reset`

- org_admin이 같은 기관의 `active/inactive` 상담사에게 재설정 메일 발송을 요청한다.
- 내부적으로 `password_reset_service.initiate_reset()`을 재사용하되, 이메일만 받는 공개 흐름과 달리 org/user/org_admin 권한 검증, 레이트리밋, 감사로그를 감싼 서비스 메서드를 둔다.
- `pending`은 password reset이 아니라 `resend-invite`만 허용한다.
- `suspended/deleted`는 409로 거부한다.

`POST /org/{org_id}/counselors/{user_id}/cancel-invite`

- `pending` 전용. 초대 Redis key를 직접 찾기 어렵기 때문에 설계상 `invite_jti`를 저장하지 않는 현재 구조에서는 새 토큰 발급 이후 이전 토큰이 살아남을 수 있다.
- 보완안: 초대 발급 시 `invite_generation` 또는 `invite_token_version`을 `User`에 저장하고 JWT에도 넣어 consume 시 일치 검증한다. 취소 시 version 증가 + `status='deleted'`, `deleted_at` 기록.

`POST /org/{org_id}/counselors/{user_id}/detach`

- 소속 해제가 제품상 계속 필요하면 삭제/비활성화와 분리한다.
- `user.org_id = None`을 수행하되, 기존 상담/리포트 FK 기록은 유지한다.
- org_admin 대상 보호는 role/status 변경과 동일하게 적용한다.
- 소속 해제된 사용자의 로그인 허용 여부를 별도 결정해야 한다. 권고는 `inactive`로 전환 후 `org_id=NULL` 처리하여 상담사 업무 접근을 막는다.

### platform_admin 엔드포인트

`POST /admin/users/{user_id}/suspend`

- 유지하되 `pending/active/inactive`에서만 `suspended`로 전환한다.
- `previous_status`를 감사로그 extra에 저장한다.
- refresh token 폐기.

`POST /admin/users/{user_id}/unsuspend`

- 기존처럼 무조건 `active`가 아니라 `previous_status`가 `inactive`이면 `inactive`로 복구한다. 현재 구현은 무조건 `active`로 둔다. 근거: `backend/app/services/admin_service.py:343-357`

`DELETE /admin/users/{user_id}`

- soft delete로 변경한다.
- 수행 내용: `status='deleted'`, `deleted_at=now`, `deleted_by=admin_id`, `status_reason`, `org_id` 유지 또는 별도 `deleted_org_id` 저장 결정, refresh token 폐기, 초대/reset 토큰 무효화, 감사로그 `action='delete'`.
- `org_id`는 이력 조회와 기관별 감사에 필요하므로 soft delete 직후에는 유지하는 편을 권고한다. 일반 org 목록에서는 `status != 'deleted'` 필터로 제외한다.

`DELETE /admin/users/{user_id}/hard-delete`

- 기존 `admin_service.delete_user()`의 FK 물리 삭제 로직을 이 엔드포인트로 이동한다.
- 보존 데이터 요구가 큰 상담/EEG/리포트 서비스에서는 기본 운영 API가 아니라 별도 권한/2단계 확인/사유 필수/감사로그 필수로 둔다.

### 응답 스키마

`CounselorResponse` 확장:

```python
class CounselorResponse(BaseModel):
    id: str
    name: str
    email: str
    role: Literal["counselor", "org_admin"]
    status: Literal["pending", "active", "inactive", "suspended", "deleted"]
    invited_at: str | None = None
    invite_expires_at: str | None = None
    disabled_at: str | None = None
    deleted_at: str | None = None
    manageable_actions: list[Literal["change_role", "activate", "deactivate", "resend_invite", "cancel_invite", "password_reset", "detach"]]
```

프론트 `frontend/src/lib/api/org.ts` 변경:

- `CounselorAccountStatus = 'pending' | 'active' | 'inactive' | 'suspended' | 'deleted'`
- `updateCounselor()`는 `updateCounselorRole()`로 이름 변경.
- `removeCounselor()`는 `detachCounselor()`로 이름 변경.
- `updateCounselorStatus()`, `requestCounselorPasswordReset()`, `cancelCounselorInvite()` 추가.
- `InviteCounselorResponse`는 현재 타입이 평면 구조지만 백엔드는 `{ counselor, invite_sent }`를 반환한다. 근거: `frontend/src/lib/api/org.ts:53-60`, `backend/app/api/v1/org.py:191-193` 이 불일치도 함께 고친다.

## 서비스/쿼리 영향 범위

### `org_service.py`

- `get_counselors()`에 기본 필터 `User.status != 'deleted'`를 추가하고, `include_deleted`는 platform_admin 전용 별도 서비스에서만 허용한다. 현재는 상태 필터가 없어 `deleted` 전환 후에도 목록에 노출될 수 있다. 근거: `backend/app/services/org_service.py:270-276`
- `update_counselor_role()`은 `User.status.in_(["pending", "active", "inactive"])` 대상만 허용한다. `suspended/deleted`는 409.
- `update_counselor_role()`에 자기 자신/마지막 org_admin/primary_admin 보호를 넣는다. 현재는 대상 role만 바꾸며 보호 로직이 없다. 근거: `backend/app/services/org_service.py:280-310`
- `remove_counselor()`는 명시 `detach_counselor()`로 이름을 바꾸고 기존 함수는 deprecated wrapper로 둔다. 현재는 org_admin도 counselor로 강등 후 소속 해제한다. 근거: `backend/app/services/org_service.py:332-336`
- `invite_counselor()`의 이메일 중복 검사는 `status != 'deleted'` 기준으로 바꿀지, tombstone 때문에 deleted도 막을지 정책이 필요하다. 권고는 기본 차단 + platform_admin 복구/이메일 해제만 허용이다. 현재는 전체 `User.email` unique와 단순 중복 검사로 deleted 이메일 재초대가 불가능하다. 근거: `backend/app/models/user.py:35`, `backend/app/services/org_service.py:497-503`
- `resend_counselor_invite()`는 `pending` 외 상태의 오류 메시지를 세분화한다. 현재는 active가 아니더라도 모두 "이미 활성화된 상담사"라고 말할 수 있다. 근거: `backend/app/services/org_service.py:562-566`
- `handle_join_request()`는 승인 시 `applicant.status`와 `deleted_at`을 검사한다. deleted/suspended 사용자의 가입 승인 방지.
- `list_org_join_requests()`는 deleted 사용자 join row를 숨길지, "삭제된 사용자"로 마스킹할지 결정한다. 권고는 org_admin 목록에서는 숨기고 platform_admin 감사에서는 표시.

### `admin_service.py`

- `list_users()`에 `status` 필터와 `include_deleted` 옵션을 추가한다. 기본은 `status != 'deleted'`. 현재는 모든 사용자를 상태와 무관하게 조회한다. 근거: `backend/app/services/admin_service.py:289-319`
- 응답 키를 `items`로 유지할지 `users`로 맞출지 정리한다. 현재 백엔드는 `items`, 프론트 타입은 `users`라 실제 UI 계약이 맞지 않는다. 근거: `backend/app/services/admin_service.py:302-319`, `frontend/src/lib/api/admin.ts:68-73`
- `suspend_user()`는 `previous_status`를 저장하고 refresh token을 폐기한다. 현재는 status만 바꾸고 토큰을 그대로 둔다. 근거: `backend/app/services/admin_service.py:322-340`
- `unsuspend_user()`는 deleted 사용자 복구가 아니며, `deleted`면 409를 반환한다.
- `delete_user()`는 soft delete 함수와 hard delete 함수로 분리한다. 기존 함수명은 실제 hard delete이므로 `hard_delete_user()`로 개명하는 편이 안전하다.
- hard delete 대상 테이블 목록은 마이그레이션 이후에도 보존 요구를 재검토해야 한다. `sessions`, `reports`, `eeg_records`, `consents` 삭제는 상담 기록 보존 요구와 충돌할 가능성이 높다. 근거: `backend/app/services/admin_service.py:381-408`

### `password_reset_service.py`

- `initiate_reset()`은 `User.status.in_(["active", "inactive"])`만 허용하고 `pending/suspended/deleted`는 사용자 존재 노출 없이 조용히 통과한다.
- reset link는 `settings.frontend_base_url` 기반 절대 URL로 바꾼다. 현재 상대경로다. 근거: `backend/app/services/password_reset_service.py:49-50`
- `complete_reset()`은 토큰 검증 후 `user.status`를 다시 확인한다. deleted/suspended 상태로 바뀐 계정의 reset 완료를 차단한다.
- `complete_reset()` 성공 후 `refresh_token_service.revoke_all_user_tokens(str(user.id), db)`를 호출한다. 현재는 새 비밀번호 저장과 reset token 삭제만 한다. 근거: `backend/app/services/password_reset_service.py:110-115`
- 공개 reset 요청과 org_admin-triggered reset 요청에 Redis 레이트리밋을 추가한다. 현재 reset 요청 쿨다운은 없다. 근거: `backend/app/services/password_reset_service.py:35-50`

### 인증/권한 공통 쿼리

- `get_current_user()`는 `status in ('active')`만 허용하거나, 최소한 `pending/inactive/suspended/deleted`를 401/403으로 차단해야 한다. 현재는 id만 있으면 통과한다. 근거: `backend/app/api/deps.py:30-42`
- `/auth/login`은 `pending/inactive/suspended/deleted` 로그인을 차단한다. 현재는 이메일/비밀번호만 맞으면 토큰을 발급한다. 근거: `backend/app/api/v1/auth.py:129-143`
- `/auth/refresh`는 refresh token record만 보고 새 토큰을 발급하므로 사용자 상태 재조회가 필요하다. 근거: `backend/app/api/v1/auth.py:325-349`
- `/auth/set-password`의 `org_invite_service.consume_invite()`는 deleted/suspended/pending 취소 상태를 검사해야 한다. 현재는 user 존재 후 무조건 `active`로 바꾼다. 근거: `backend/app/services/org_invite_service.py:214-229`
- WebSocket namespace의 토큰 인증도 `get_current_user()`와 동일한 상태 검사를 공유해야 한다. `decode_token()`만 직접 쓰면 deleted/suspended 사용자가 연결될 수 있다.

### 프론트 영향

- `OrgManagementPage`는 현재 role 변경과 소속 해제만 제공한다. 근거: `frontend/src/pages/org/OrgManagementPage.tsx:50-75`, `frontend/src/pages/org/OrgManagementPage.tsx:123-139`
- `OrgDashboardPage`는 초대 목록을 `pending/active/expired`로만 표시한다. inactive/suspended/deleted 배지가 필요하다. 근거: `frontend/src/pages/OrgDashboardPage.tsx:41-75`
- `SidebarNav`의 org_admin 메뉴에는 별도 "상담사" 메뉴가 없다. 근거: `frontend/src/components/layout/SidebarNav.tsx:105-113`
- platform_admin `UserManagementPage`는 `suspended` boolean만 표시하고 삭제 문구가 "영구 삭제"다. soft delete 전환 후 `status` 원문 표시와 `삭제/영구 삭제` 액션 분리가 필요하다. 근거: `frontend/src/pages/admin/UserManagementPage.tsx:25-43`, `frontend/src/pages/admin/UserManagementPage.tsx:250-267`

## 마이그레이션/호환성 전략

1. Alembic으로 `users`에 soft delete/상태 변경 추적 컬럼을 추가한다.
2. `status` 값 체크 제약을 추가한다. 초기에는 기존 데이터 호환을 위해 DB check보다 애플리케이션 검증부터 넣고, 데이터 정리 후 check constraint를 적용해도 된다.
3. 이메일 unique 정책을 결정한다.
   - 권고: `users.email` unique는 유지한다. deleted 이메일 재사용은 platform_admin의 "복구" 또는 "이메일 tombstone 해제" 전용 플로우로만 허용한다.
   - 대안: PostgreSQL partial unique index `UNIQUE(lower(email)) WHERE deleted_at IS NULL`로 바꾸면 재가입은 쉬워지지만 과거 상담 기록과 새 계정이 같은 이메일을 공유해 운영 혼동이 커진다.
4. 기존 `DELETE /org/{org_id}/counselors/{user_id}`는 soft delete로 바꾸지 않는다. 릴리스 N에서는 detach alias 유지 + deprecation header, 릴리스 N+1에서는 프론트 호출 제거 확인 후 410 또는 유지 여부 최종 결정.
5. 기존 `PUT /org/{org_id}/counselors/{user_id}`는 role alias로 유지하되 `CounselorRoleUpdate` 스키마로 검증한다. 신규 프론트는 `/role`만 호출한다.
6. `admin_service.delete_user()`는 이름을 `hard_delete_user()`로 바꾸고, 새 `soft_delete_user()`를 기본 `DELETE /admin/users/{user_id}`에 연결한다.
7. soft delete 배포 전, hard delete가 이미 수행된 사용자 데이터는 복구할 수 없다. 운영 DB에서는 배포 이후부터만 보존 정책이 적용된다는 점을 summary에 명시한다.
8. refresh token 폐기 마이그레이션은 코드 배포 후 상태 전환 시점에 수행한다. 과거 suspended 계정이 있다면 배포 직후 일괄 `revoke_all_user_tokens()`를 실행하는 운영 스크립트를 별도 검토한다.
9. 초대 토큰 취소를 구현하려면 현재 Redis jti-only 구조에 사용자별 version 검증을 추가한다. 기존 발급 토큰은 version 클레임이 없으므로 배포 후 `pending` 초대 전체 재발급 또는 legacy token 허용 기간을 정해야 한다.
10. API 응답 호환을 위해 `status` 원문을 추가하되 기존 `suspended` boolean은 platform_admin 프론트 마이그레이션 기간 동안 유지할 수 있다.
11. 감사로그는 `VerificationAudit(target_type='user')` 패턴을 재사용한다. org_admin 액션도 같은 테이블에 기록하되 `action`을 `org_deactivate`, `org_activate`, `role_change`, `detach`, `cancel_invite`, `password_reset_requested`, `soft_delete`, `hard_delete`로 구분한다.
12. OpenAPI/프론트 타입 생성 경로가 없다면, 이번 SDD에서 Python Pydantic schema와 TypeScript interface를 수동으로 같은 상태 union에 맞추는 체크리스트를 verify에 넣는다.

## 테스트 영향 범위

### 백엔드 단위/통합 테스트

- `backend/tests/test_sdd017_counselor_invite.py`
  - 초대 생성 후 `pending`
  - 초대 수락 후 `active`
  - 초대 취소 후 set-password 실패
  - deleted 이메일 재초대 정책
  - `InviteCounselorResponse` 실제 shape와 프론트 타입 정합
- `backend/tests/test_org_public.py`
  - 공개 페이지는 `active` 상담사만 노출
  - `inactive/suspended/deleted/pending` 상담사는 숨김
- `backend/tests/test_admin.py`
  - `suspend_user()`가 refresh token 폐기
  - `unsuspend_user()`가 이전 `inactive`를 보존
  - `DELETE /admin/users/{id}`가 user row를 남기고 `status='deleted'`
  - `/hard-delete`만 FK 자식 레코드 물리 삭제
  - `include_deleted` 기본 false/true
- 인증 테스트
  - `pending/inactive/suspended/deleted` 로그인 실패
  - 기존 access token으로 `deleted` 계정 API 접근 실패
  - refresh token이 사용자 상태 변경 후 실패
  - password reset 완료 직전 deleted/suspended 전환 시 실패
- org_admin 관리 테스트
  - org_admin은 `active/inactive`만 변경 가능
  - org_admin은 `suspended/deleted` 변경 불가
  - 자기 자신/마지막 org_admin/primary_admin 비활성화 및 강등 차단
  - `DELETE /org/.../counselors/...`가 삭제가 아니라 detach alias임을 고정
  - 신규 `/status`, `/role`, `/password-reset`, `/cancel-invite`, `/detach` 계약 검증
- 마이그레이션 테스트
  - 기존 users row에 새 nullable 컬럼 추가
  - 기존 `status` 값 유지
  - partial unique index를 택한 경우 deleted 이메일 재사용 시나리오

### 프론트 테스트

- `frontend/src/lib/api/org.ts`
  - status union에 `inactive/suspended/deleted` 포함
  - role/status/detach/password-reset/cancel-invite 함수 URL 검증
  - invite response shape `{ counselor, invite_sent }` 반영
- `OrgManagementPage`
  - role 변경과 status 변경 UI 분리
  - "소속 해제"와 "비활성화" 문구/확인 모달 분리
  - primary/last org_admin 관리 액션 disabled 표시
  - `pending`은 재초대/초대 취소만 표시
  - `suspended`는 플랫폼 정지 배지만 표시하고 org_admin 액션 비활성화
- `OrgDashboardPage`
  - 통계는 active만 계산
  - 목록은 pending/inactive/suspended를 배지로 표시하거나 관리 페이지로 이동
  - expired는 별도 DB status가 아니라 `pending + invite_expires_at < now` 파생 상태임을 유지
- `UserManagementPage`
  - `status` 문자열 기반 표시
  - soft delete와 hard delete 문구 분리
  - `deleted` 사용자 복구/영구 삭제 액션
  - 응답 키 `items/users` 불일치 해소

### 회귀 위험

- 기존 테스트가 hard delete 후 `User`가 없어지는 것을 기대할 수 있다. soft delete 전환 테스트와 hard delete 전용 테스트를 분리해야 한다.
- `get_current_user()`에서 `inactive`를 차단하면 org_admin 자신이 비활성화된 순간 즉시 모든 화면에서 401/403이 된다. 이 동작은 의도한 보안 정책인지 verify에 명시한다.
- 공개 페이지/대시보드/세션 집계는 deleted 사용자의 과거 세션을 숨길지 이름만 마스킹할지 정책 차이가 있다. 권고는 과거 기록은 유지하되 신규 노출/예약/공개 목록에서만 제외한다.

## 최종 권고안

1. soft delete는 `status='deleted'` 단독으로 구현하지 말고 `deleted_at/deleted_by/status_reason/status_changed_at/status_changed_by`를 함께 둔다.
2. 상태머신은 `pending → active → inactive`를 기관 운영 축, `suspended`를 플랫폼 제재 축, `deleted`를 계정 생명주기 종료 축으로 정의한다. org_admin은 `active/inactive`만 바꾼다.
3. 기존 `DELETE /org/{org_id}/counselors/{user_id}`는 계정 삭제로 재해석하지 않는다. 신규 `PATCH /status`, `PATCH /role`, `POST /detach`를 만들고 기존 DELETE는 deprecated detach alias로만 둔다.
4. 기존 `PUT /org/{org_id}/counselors/{user_id}`의 `body: dict`는 즉시 Pydantic 스키마로 바꾸고, 신규 `/role`로 프론트를 이전한다.
5. platform_admin의 `DELETE /admin/users/{user_id}`는 soft delete로 바꾸고, 현재 hard delete 로직은 `/hard-delete`에 격리한다.
6. 인증 계층에서 `pending/inactive/suspended/deleted`를 차단한다. 로그인뿐 아니라 `get_current_user()`, refresh, set-password, WebSocket 인증까지 같은 정책을 적용한다.
7. 상태 전환 시 refresh token 전체 폐기, password reset/invite token 무효화, `VerificationAudit` 기록을 필수 처리로 묶는다.
8. 이메일 unique는 일단 유지한다. deleted 이메일 재사용은 일반 org_admin 초대에서 허용하지 말고 platform_admin 복구/해제 정책으로 풀어야 과거 상담 기록과 신규 계정 혼동을 피할 수 있다.
9. org_admin 보호 규칙을 먼저 구현한다. 자기 자신, 마지막 org_admin, `primary_admin_id` 대상 강등/비활성화/소속해제를 막지 않으면 기관이 관리자를 잃는다.
10. 프론트 타입 정합을 구현 범위에 반드시 포함한다. 현재 org invite response와 admin user list response는 실제 백엔드 shape와 TypeScript 타입이 맞지 않는 지점이 있어, soft delete와 함께 고치지 않으면 UI가 상태 변경을 제대로 표시하지 못한다.
11. `inactive` 사용자의 과거 세션/리포트/EEG는 보존한다. 신규 배정, 공개 노출, 로그인, 토큰 refresh만 차단한다.
12. SDD-018의 `spec.md`에는 상태/권한/데이터 보존 정책, `plan.md`에는 API 분리와 서비스 함수 분리 순서, `verify.md`에는 구현 전 위 테스트 시나리오와 destructive hard delete 격리 검증을 넣어야 한다.
