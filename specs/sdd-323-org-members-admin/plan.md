# SDD-323 — Stage ② Plan: 기관 구성원 관리

- 기준: `spec.md` §9 대표 결정 3건 + 권한표 (최종 기준). 브랜치 `sdd/323-org-members-admin`.
- FE 기준 브랜치: `sdd/320-coach-pc-v2` (D안 `frontend/src/pages/org/ui-v2/*`). **BE 와 FE 는 파일이 겹치지 않으며 병렬 구현한다.**
- 디자인 시안: `~/.hermes/share/design-323-org-members/index.html`
- 조사 근거(코드 확인, 실행 검증 아님): `backend/app/api/v1/org.py`, `services/org_service.py`, `services/org_management_service.py`, `models/user_org_membership.py`, `models/organization.py`(version, primary_admin_id).

## 1. 확정 정책 (구현 기준)

| 행동 | 대표 | 일반 관리자 | 플랫폼 관리자 |
|---|---|---|---|
| 코치 초대·재초대 | ✅ | ✅ | ✅ |
| 관리자 초대·재초대 | ✅ | ✅ | ✅ |
| 코치 소속 해지 | ✅ | ✅ | ✅ |
| 관리자 소속 해지 | ✅ | ❌ | ✅ |
| 자기 자신·대표 해지 | ❌ | ❌ | 대표 해지만 ✅(대표 이전 선행 조건은 유지, §3-B7 참고) |
| 코치→관리자 승격 | ✅ | ❌ | ✅ |
| 관리자 권한 회수 | ✅ | ❌ | ✅ |
| 대표 이전 | ✅ | ❌ | ✅ |
| 계정 정지·재활성 | ❌ | ❌ | ✅ (기존 `/admin/users/{id}/suspend`) |
| 코치 개인정보 수정·가입 요청 승인/거절·조회 | ✅ | ✅ | — |

- 판정은 **서버가 매 요청** 한다(active org_admin membership + `organizations.primary_admin_id`). 화면 숨김은 UX 일 뿐.
- 일반 관리자 → 금지 행동은 **403** (에러코드 §2-2). 보호 조건(자기 자신·대표·마지막 관리자)은 **409**.
- 정지·재활성: 기관 라우터(`/org/.../suspend|unsuspend`)에서 **기관 관리자 허용 제거** → 항상 403(대표 포함). FE 버튼 제거.

## 2. API 계약 (FE 는 이 표로 BE 구현 전에도 개발)

경로는 `/api/v1/org` 기준 생략. 모든 변경 API 는 대상 membership 이 **현재 기관** 것인지 검증(타 기관 404).

### 2-1. 신규·변경 API 목록

| # | 구분 | 메서드·경로 | 권한 | 요청 | 응답 |
|---|---|---|---|---|---|
| A1 | 변경 | GET `/{org_id}/counselors` | 관리자(대표/일반) | `?role=&status=` 선택(미지정 시 전체) | `CounselorResponse[]` (§2-3 보강 필드) |
| A2 | 변경 | PUT `/{org_id}/counselors/{user_id}` (역할 변경) | **대표만**(승격·회수 모두) | `{role, reason}` — reason **필수** 로 강화 | `CounselorResponse` (membership 기준) |
| A3 | 변경 | DELETE `/{org_id}/counselors/{user_id}` (소속 해지) | 코치 대상=관리자 누구나, 관리자 대상=대표만 | body `{reason}` 필수 (DELETE+JSON body; 쿼리 `reason` 병행 허용 X) | 204 |
| A4 | 변경 | POST `/{org_id}/counselors/{user_id}/suspend`, `/unsuspend` | **기관 관리자 전원 403** | — | 403 `ORG_STATUS_PLATFORM_ONLY` |
| A5 | **신규** | PUT `/{org_id}/primary-admin` (대표 이전) | 대표만 | `{target_user_id, expected_primary_admin_id, reason}` + 헤더 `If-Match: <org.version>` | `{org_id, primary_admin_id, version}` |
| A6 | 변경 | GET `/{org_id}/counselors/{user_id}/activity` | 관리자 | — | 기관 범위 활동 + 담당 클래스/회원 요약(§2-4) |
| A7 | 변경 | POST `/{org_id}/counselors/invite` | 관리자 | `{name,email,role}` 기존 | 기존 + `counselor` 보강 필드. 기존 계정 여부 비노출 유지 |
| A8 | 변경 | POST `/{org_id}/counselors/{user_id}/resend-invite` | 관리자 | — | 기존 + 쿨다운 시 429 `INVITE_COOLDOWN`(`retry_after_sec`) |
| A9 | 변경 | GET/PUT `/{org_id}/requests`, `/{org_id}/requests/{req_id}` | 관리자 | 거절 시 `reason` 필수 | 처리 완료 요청 재처리 409 |
| A10 | 신규(플랫폼) | PUT `/admin/orgs/{org_id}/primary-admin` | 플랫폼 관리자 | A5 와 동일(If-Match 포함) | A5 와 동일. 서비스 함수는 A5 와 공용 |

### 2-2. 에러 코드 (`detail` 은 한글 문구, `code` 필드 추가)

| HTTP | code | 상황 |
|---|---|---|
| 403 | `ORG_ADMIN_REQUIRED` | 해당 기관의 active 관리자 아님 |
| 403 | `PRIMARY_ADMIN_REQUIRED` | 일반 관리자가 승격·회수·관리자 해지·대표 이전 시도 |
| 403 | `ORG_STATUS_PLATFORM_ONLY` | 기관 관리자가 정지·재활성 시도 |
| 404 | `MEMBER_NOT_FOUND` | 현재 기관 membership 없음(타 기관 포함, 존재 비노출) |
| 409 | `CANNOT_TARGET_SELF` | 자기 자신 회수·해지 |
| 409 | `CANNOT_TARGET_PRIMARY` | 대표 회수·해지(대표 이전 먼저) |
| 409 | `LAST_ADMIN` | 활성 관리자 최소 1명 위반 |
| 409 | `MEMBER_HAS_ACTIVE_WORK` | 진행·예정·대기 세션 또는 활성 내담자 연결 존재(해지 차단, 기존 가드 재사용) |
| 409 | `INDIVIDUAL_ORG_OWNER` | 개인 기관 소유자 해지·역할변경/이전(`kind=individual`) |
| 409 | `INVALID_TRANSFER_TARGET` | 대상이 자기 자신 / invited / 정지 / 비관리자 |
| 409 | `PRIMARY_CHANGED` | `expected_primary_admin_id` 불일치 |
| 412 | `VERSION_MISMATCH` | If-Match 버전 불일치 |
| 428 | `VERSION_REQUIRED` | If-Match 누락 |
| 422 | `REASON_REQUIRED` | 사유 공백(역할 변경·해지·이전·거절) |
| 429 | `INVITE_COOLDOWN` | 재발송 쿨다운 |

### 2-3. `CounselorResponse` 보강 필드 (기존 필드 유지, 추가만)

| 필드 | 타입 | 설명 |
|---|---|---|
| `is_primary_admin` | bool | `org.primary_admin_id == user.id` |
| `membership_status` | `active\|invited` | 소속 상태(계정 상태와 분리) |
| `account_status` | `active\|pending\|suspended` | 계정 상태. 기존 `status` 는 하위 호환 유지 |
| `is_self` | bool | 요청자 본인 여부 |
| `class_count` | int | 이 기관 내 담당 클래스 수 (**N+1 금지**, 단일 집계 쿼리) |
| `last_activity_at` | iso\|null | 이 기관 내 마지막 세션 시작 시각. 없으면 null(‘활동 없음’) |
| `allowed_actions` | string[] | 요청자가 이 행에서 할 수 있는 행동: `detail, edit_profile, resend_invite, promote, revoke_admin, remove, transfer_primary` (정지/재활성은 절대 포함하지 않음). **FE 는 이 목록으로 버튼을 숨김** |
| `blocked_reasons` | `{action: code}` | 숨김이 아닌 조건부 차단(마지막 관리자·진행 세션 등) 사유 |

### 2-4. `activity` 응답 (A6)

- 기존 필드 유지 + `classes: [{id,name,status,member_count}]`(이 기관 한정), `client_count`. 상담 본문·녹음·리포트 본문 미포함.
- 쿼리 조건에 `org_id` 필수 추가(기존 `host_id` 단독 조회 제거).

## 3. 작업 묶음 B — 백엔드 (`backend/` 만)

> 담당 경로: `backend/app/**`, `backend/alembic/**`, `backend/tests/**`. `frontend/` 수정 금지.

| Task | 파일 | 내용 |
|---|---|---|
| B1 | `app/services/org_permission_service.py` (신규) | `get_actor_org_role(db, actor, org_id)` → `primary / admin / platform / none`. 대표=membership active org_admin & `primary_admin_id`. 행동×역할 판정 함수 `can(actor_ctx, action, target)` 단일 출처. 단위 테스트 가능하게 순수 함수화 |
| B2 | `app/api/v1/org.py` | `_require_org_admin` 유지 + 행동별 가드 호출. 403 에 `code` 포함. 플랫폼 관리자 통과 경로(JWT role=admin 판정)는 B1 사용 |
| B3 | `app/services/org_management_service.py` `change_counselor` | 승격·회수·관리자 해지는 대표/플랫폼만. 자기 자신 차단(409 `CANNOT_TARGET_SELF`), 대표 차단, 마지막 관리자는 **기관 행 잠금 안에서** 재계산. reason 필수. 감사(`VerificationAudit`)에 `request_id`, 행위자 역할 기록. 다른 기관 membership·전역 role 미변경 |
| B4 | `app/services/org_service.py` `set_counselor_suspension` + `org.py` suspend/unsuspend | 기관 관리자 호출은 즉시 403 (`ORG_STATUS_PLATFORM_ONLY`). 기존 서비스 함수는 플랫폼 경로 재사용을 위해 삭제하지 않고 라우터 허용만 제거 |
| B5 | `app/services/org_management_service.py` `transfer_primary_admin` (신규) + `org.py` PUT `/{org_id}/primary-admin` + `app/api/v1/admin.py` PUT `/admin/orgs/{org_id}/primary-admin` | 기관 행 `FOR UPDATE` 후 대표·버전·대상(active org_admin membership + active 계정, 자기 자신 아님, individual 기관 차단) 재검증 → `primary_admin_id` 갱신, `org.version += 1`, 감사 저장 한 트랜잭션. 이전 대표는 org_admin 유지. 양쪽 인앱 알림(커밋 후, 실패해도 변경 유지) |
| B6 | `app/services/org_service.py` `get_counselors` / `org.py` `_counselor_to_response` / `app/schemas/org.py` | §2-3 필드 추가. `class_count`·`last_activity_at`·personal office 는 `IN` 일괄 집계 1~2쿼리. `allowed_actions`/`blocked_reasons` 는 B1 판정 재사용 |
| B7 | `org_service.remove_counselor` (`DELETE`) | 사유 body 수신, 코치 대상/관리자 대상 분기, 대표·자기 자신 거절. 플랫폼 관리자의 대표 해지는 **기관에 다른 활성 관리자가 있고 대표를 이전한 뒤에만** 허용(그 외 409). 진행 세션 가드는 **host_id + 기관 범위**로 판정(다른 기관 세션 때문에 막히지 않게 — 세션의 org 컬럼 존재 확인 후 적용) |
| B8 | `org_service.get_counselor_activity` | `org_id` 필터 필수. 담당 클래스/회원 요약 추가(§2-4). 타 기관 정보 노출 0 |
| B9 | `org_service.invite_counselor/resend_counselor_invite` | 관리자 초대·재발송을 일반 관리자에게 허용(기존 유지)임을 테스트로 고정. 쿨다운 429 `INVITE_COOLDOWN`. 응답 문구가 기존 계정 여부를 구분하지 않음을 테스트 |
| B10 | `app/api/v1/org.py` requests | 기관 관리자만, 타 기관/처리 완료 요청 409·404, 거절 사유 필수 |
| B11 | `tests/test_sdd323_org_members_authz.py` (신규) 외 | verify.md V-API 시나리오 전부 자동화. 기존 `test_sdd076/082/258/079` 회귀 통과(정지 테스트는 403 기대로 수정) |
| B12 | 마이그레이션 | **원칙적으로 없음**(기존 `version`, `primary_admin_id`, membership 사용). `class_count`/`last_activity_at` 성능을 위해 인덱스가 필요하면 `alembic` 1건만 추가 — 측정 후 결정(EXPLAIN 결과를 summary 에 기록) |

## 4. 작업 묶음 F — 프론트 (`frontend/` 만, 기준 `sdd/320-coach-pc-v2`)

> 담당 경로: `frontend/src/**`. `backend/` 수정 금지. 이 브랜치(`sdd/323`)는 develop 기준이라 D안 파일이 없다 → **FE 워커는 `sdd/320-coach-pc-v2` 가 develop 에 병합된 뒤 rebase 하거나, 병합 전이면 320 을 베이스로 한 별도 FE 워크트리**에서 작업한다(열린 질문 1).

| Task | 파일 | 내용 |
|---|---|---|
| F1 | `lib/api/org.ts` | §2 계약 타입: `CounselorItem` 보강 필드, `transferPrimaryAdmin()`, `removeCounselor(reason)`, `updateCounselorRole(role, reason)`. 에러 `code` 파싱 헬퍼. `suspendCounselor/unsuspendCounselor` 호출 제거 |
| F2 | `pages/org/ui-v2/ui-v2-org-members-page.tsx` (신규) | `/counselors?tab=coaches\|admins\|invites\|requests`. 탭 상태·검색·필터를 URL 쿼리에 보존, 뒤로가기 복구. 기관명·제목 31px 유지 |
| F3 | `pages/org/ui-v2/members/coaches-tab.tsx`, `admins-tab.tsx` | PC 표 + 이름/이메일 검색 + 상태 필터 + 그룹핑(상태별·개인상담소). 모바일 카드(칩 한 줄). 행 버튼은 **`allowed_actions` 에 있는 것만 렌더**(숨김). 정지/재활성 UI 제거 |
| F4 | `members/invites-tab.tsx` | `counselor-invite-section.tsx` 의 초대 폼(역할 선택: 코치/관리자)·현황 재사용·이동. 대기/만료/가입됨 필터, 재발송 쿨다운 비활성+남은 시간, 만료 정보 없음 표시 |
| F5 | `members/requests-tab.tsx` | 기관이 받은 가입 요청(`GET /org/{id}/requests`) 승인/거절(사유 입력). 기존 `ui-v2-org-requests-page`(본인 신청 내역)와 **분리 유지** |
| F6 | `members/member-detail-panel.tsx` | 상세 패널: 기관 내 클래스·담당 회원 요약, 최근 활동, 개인정보 수정(`CounselorInfoEditor` 재사용, 이메일 불변 안내·타 소속 반영 안내) |
| F7 | `members/member-action-dialogs.tsx` | 권한 변경 확인 모달(승격/회수/해지/대표 이전): 영향 설명 + 사유 필수 + 중복 제출 방지 + 실패 시 에러코드별 문구. `useDialogA11y`로 포커스 진입/복귀 |
| F8 | `pages/org/ui-v2/ui-v2-org-dashboard-page.tsx` | `CounselorInviteSection` 제거 → 요약 타일(활성 코치·활성 관리자·초대 대기·가입 요청) + 각 탭 링크(`/counselors?tab=…`). 개별 처리 버튼 없음 |
| F9 | `App.tsx`, 사이드바(`ui-v2-org-shell`) | 라우트 `/counselors`→구성원 페이지(구 `/org/counselors` 는 redirect). 센터 관리(`ui-v2-org-management-page`) 구성원 영역은 링크로 대체해 중복 제거 |
| F10 | `styles/ui-v2-org-members.css` (신규) | 토큰·그림자는 `ui-v2-elevation.css`·`ui-v2-org.css` 재사용. 1024px 기준 PC/모바일 분기, 가로 넘침 0, 칩 `white-space: nowrap`, 대비 4.5:1 |
| F11 | `*.test.tsx` (vitest) + `e2e/org-members/*` | 역할별(대표/일반) 버튼 노출 매트릭스, 탭 URL 보존, 대시보드 초대 폼 부재, 금지 표현 0 |

### FE 개발 방식

- BE 완료 전: `lib/api/org.ts` 에 §2 계약 모의 응답(vitest/MSW 수준 fixture)을 두고 개발. 실제 연결은 BE 머지 후 통합 단계에서만.
- 버튼 노출은 오직 `allowed_actions` 기준(역할 문자열로 직접 분기 금지). 서버가 바뀌어도 FE 수정 불필요.
- 금지: 점수·등급 환원 표현, 정지/재활성 문구.

## 5. 통합·순서

1. B1→B3/B4/B5→B6→B7~B10→B11 (BE 내부 순서). F1→F2~F7→F8→F9→F10→F11.
2. BE·FE 병렬 구현 → 각각 PR 단위 diff 로 **별도 검증 워커**가 verify.md 시나리오 수행(구현자≠검증자).
3. 통합: dev 배포 후 화면+API 실측(390/1440). 배포는 승인 후.

## 6. 위험·롤백

| 위험 | 대응 | 롤백 |
|---|---|---|
| 정지 라우터 차단으로 기존 운영 흐름 단절 | 기존 정지 건은 플랫폼 관리자 경로로 안내 문구 | 라우터 가드 한 줄 복원(데이터 변경 없음) |
| 마지막 관리자 동시성 | 기관 행 `FOR UPDATE` 아래 재계산 + 동시 요청 테스트 | 코드 revert, 데이터 영향 없음 |
| `allowed_actions` 와 서버 판정 불일치 | 둘 다 B1 단일 함수 사용, 테스트로 교차 확인 | 서버가 최종 거절(안전 측) |
| 활동 조회 기관 필터 도입 시 N+1/느림 | 일괄 집계, EXPLAIN 기록, 필요 시 인덱스 1건 | 인덱스 downgrade |
| 대표 이전 중 stale | If-Match + expected_primary 이중 검증 | `primary_admin_id` 는 감사 이력의 before 로 복원 가능(수동, 플랫폼 관리자) |
| 알림 실패 | 변경 성공과 분리, 재시도 상태 표시 | — |
| FE 베이스 브랜치 불일치 | 열린 질문 1 | 별도 FE 브랜치 폐기 가능 |

- DB 스키마 변경 없음(원칙) → 롤백은 코드 revert 로 충분.
- 메일은 발송 대역(mock)으로 검증, 실제 발송 금지.

## 7. 열린 질문

1. FE 구현 베이스: `sdd/320-coach-pc-v2` 병합 이후 rebase 할지, 320 기반 별도 FE 브랜치로 진행할지.
2. 플랫폼 관리자 대표 이전 API(A10, `/admin/orgs/{id}/primary-admin`)를 이번 범위에 포함할지(권한표에는 ✅, spec §5 에서는 “별도”). 기본안: 서비스 함수 공용이라 포함.
