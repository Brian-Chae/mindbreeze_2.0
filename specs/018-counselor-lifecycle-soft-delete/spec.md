# SDD-018 — 상담사 계정 생명주기 재설계

## 배경
현재 상담사 계정 관리는 초대/활성화 중심으로만 설계되어 있고, 삭제/정지/권한변경/비밀번호 재설정/로그인 차단 정책이 역할별로 일관되지 않다. 특히 플랫폼 관리자 hard delete가 세션·리포트·EEG·감사로그까지 연쇄 삭제하고, 인증 계층은 `user.status`를 강제하지 않아 `suspended`조차 실질적으로 차단되지 않는 상태다. Brian 결정에 따라 기관 관리자(`org_admin`)는 상담사를 삭제하지 않고 활성화/비활성화만 제어해야 하며, 영구 삭제는 플랫폼 관리자(`platform_admin`)만 수행해야 한다.

## 문제 정의
1. `org_admin`의 현재 DELETE 의미가 삭제가 아니라 소속 해제라 UX와 API 의미가 충돌한다.
2. `platform_admin`의 현재 삭제는 hard delete라 데이터 보존 리스크가 과도하다.
3. `login`, `refresh`, `get_current_user`, 비밀번호 재설정, 초대 수락, WebSocket 인증에 상태 강제가 없다.
4. 프론트는 `pending/active` 중심 타입에 머물러 `inactive/suspended/deleted`를 표현하지 못한다.
5. 기관/플랫폼/상담사 3개 역할의 UX가 상태모델을 공유하지 않는다.

## 목표
- 상담사 계정 상태를 `pending / active / inactive / suspended / deleted`로 재정의한다.
- soft delete를 기본 삭제 정책으로 도입하고, hard delete는 platform_admin 전용 위험 액션으로 격리한다.
- org_admin은 자기 기관 소속 상담사에 대해 활성/비활성, 기본 정보 수정, 비밀번호 초기화 요청만 수행한다.
- 플랫폼 관리자 UX를 계정 생명주기 콘솔로 재구성한다.
- 상담사에게 상태별 로그인 차단 및 복구 안내 UX를 제공한다.

## 비목표
- 이번 단계에서 일반 사용자(client) 계정의 동일 정책 확장까지는 포함하지 않는다.
- 이번 단계에서 이메일 변경 자체를 org_admin 기능으로 열지 않는다.
- 실제 구현/배포는 이 문서 승인 후 수행한다.

## 권한 정책
### org_admin
- 가능: 목록/상세 조회, 이름/전화 수정, 비밀번호 초기화 메일 요청, 활성화/비활성화, 초대 재발송, 초대 취소
- 불가: soft delete, hard delete, suspended 해제, platform 제재 상태 변경, 이메일 변경, 자기 자신/마지막 org_admin/primary_admin 비활성화 또는 강등

### platform_admin
- 가능: 사용자 상태 조회, suspended/unsuspended, soft delete, restore, hard delete, deleted 계정 열람
- 주의: hard delete는 soft delete 이후에만 가능하고 별도 확인 절차 필요

### counselor
- 가능: active 상태에서만 로그인/업무 수행
- 불가: inactive/suspended/deleted/pending 상태의 일반 로그인

## 상태모델
- `pending`: 초대 발송 후 수락 전
- `active`: 정상 사용 가능
- `inactive`: 기관 운영상 비활성, org_admin이 제어
- `suspended`: 플랫폼 제재 상태, platform_admin이 제어
- `deleted`: soft delete 상태, 일반 목록/인증에서 제외

보조 메타데이터:
- `deleted_at`, `deleted_by`
- `status_reason`
- `status_changed_at`, `status_changed_by`
- 필요 시 `disabled_at`, `disabled_by`

## 핵심 제품 결정
1. org_admin의 "삭제" 개념은 제거한다. 기관 UI에는 활성/비활성만 남긴다.
2. `inactive`와 `suspended`는 다른 주체/다른 해제 권한을 가지므로 별도 상태로 유지한다.
3. `deleted` 계정은 기본 목록에서 숨기되 platform_admin은 열람/복구 가능해야 한다.
4. deleted 이메일은 일반 재초대에 재사용하지 않는다. 플랫폼 복구 또는 hard delete 이후 별도 정책으로만 해소한다.

## 백엔드 변경 요구사항
1. `users.status` enum 확장 + soft delete 추적 컬럼 추가
2. org API 분리
   - `PATCH /org/{org_id}/counselors/{user_id}/role`
   - `PATCH /org/{org_id}/counselors/{user_id}/status`
   - `POST /org/{org_id}/counselors/{user_id}/password-reset`
   - `POST /org/{org_id}/counselors/{user_id}/cancel-invite`
3. 기존 `PUT /org/{org_id}/counselors/{user_id}`는 deprecated role alias
4. 기존 `DELETE /org/{org_id}/counselors/{user_id}`는 삭제 재해석 금지. 단계적으로 폐기 또는 detach alias 유지
5. `DELETE /admin/users/{user_id}`는 soft delete로 의미 변경
6. hard delete는 별도 `DELETE /admin/users/{user_id}/hard-delete` 또는 동등한 위험 엔드포인트로 분리
7. `login`, `refresh`, `get_current_user`, `set-password`, `password-reset`, WebSocket 인증에 상태 강제 추가
8. 상태 변경/삭제/비밀번호 재설정 시 refresh token 전량 폐기 + 감사로그 기록

## 프론트 변경 요구사항
### 기관 관리자
- 사이드바에 `상담사 관리` 메뉴 추가
- `OrgDashboardPage`의 상담사 운영 기능을 전용 관리 페이지로 분리
- 상태 필터/배지/행 액션 도입
- 삭제/소속 해제 UI 제거, 활성/비활성 중심으로 재구성

### 플랫폼 관리자
- `UserManagementPage`를 생명주기 콘솔로 개편
- 정지 / soft delete / hard delete를 3단계 위험 구조로 배치
- `deleted` 탭과 restore UX 추가

### 상담사
- 로그인 실패 시 `ACCOUNT_PENDING / ACCOUNT_INACTIVE / ACCOUNT_SUSPENDED / ACCOUNT_DELETED` 코드 기반 안내
- `/account-blocked` 전용 안내 흐름 추가

## 데이터 보존 원칙
- soft delete는 사용자 레코드와 과거 세션/리포트/EEG/감사로그를 보존한다.
- hard delete만 물리 삭제를 수행한다.
- `verification_audits`는 가능하면 hard delete 대상에서 제외하거나 별도 보관 원칙을 둔다.

## 성공 기준
1. org_admin은 삭제 없이 활성/비활성만 수행한다.
2. suspended/inactive/deleted/pending 사용자는 로그인과 refresh가 차단된다.
3. platform_admin은 deleted 사용자를 복구/영구삭제로 분기 관리한다.
4. 기존 상담 기록/리포트/EEG는 soft delete 후에도 보존된다.
5. 프론트와 백엔드가 동일한 상태 vocabulary를 사용한다.
