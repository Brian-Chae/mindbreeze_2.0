# SDD-323 — Stage ⑥ Summary

## BE (묶음 B, backend/ 만)

### 구현 요약
- `app/core/api_error.py` (신규): `code` 를 함께 내려주는 `ApiError(HTTPException)`. `main.py` 에 전용 핸들러 → 응답 `{detail(한글), code, ...extra}`.
- `app/services/org_permission_service.py` (신규, B1): 역할 판정(`platform/primary/admin/none`)·행동 판정 `can()`·목록 행 `compute_row_actions()` 단일 출처. 라우터 가드·서비스 재검증·`allowed_actions` 가 모두 공유.
- `org_management_service.change_counselor` (B3/B7): 기관 행 잠금 **안에서** 행위자 권한 재판정(fresh). 승격·회수·관리자 해지=대표/플랫폼만(403 `PRIMARY_ADMIN_REQUIRED`), 자기 자신 409 `CANNOT_TARGET_SELF`, 대표 409 `CANNOT_TARGET_PRIMARY`, 마지막 관리자 409 `LAST_ADMIN`(초대 대기 관리자는 활성으로 세지 않음), invited 대상 역할변경 409 `MEMBER_NOT_ACTIVE`, 개인기관 소유자 409 `INDIVIDUAL_ORG_OWNER`, 사유 필수 422 `REASON_REQUIRED`. 진행·예정 세션 가드는 **기관 범위**(`organization_id==현재 기관` 또는 귀속 미확정)로 판정 — 타 기관에서 귀속 확정된 세션은 해지를 막지 않음. 감사에 `actor_role`, `request_id` 추가.
- `transfer_primary_admin` (B5, 신규 서비스): If-Match(428/412/422) + `expected_primary_admin_id`(409 `PRIMARY_CHANGED`) + 대상 검증(409 `INVALID_TRANSFER_TARGET`, 타 기관 404) + 개인기관 차단, `primary_admin_id` 갱신·`version+1`·감사를 한 트랜잭션, 양쪽 인앱 알림은 커밋 후 best-effort. 이전 대표는 org_admin 유지. `allow_platform` 인자로 공용화했으나 **플랫폼용 라우트는 만들지 않음**(대표 미결).
- `org.py` 라우터: 목록 보강(§2-3 전 필드, `role`/`status` 쿼리 필터), 정지/재활성 **기관 관리자 전원 403 `ORG_STATUS_PLATFORM_ONLY`**(서비스 함수는 유지), DELETE 사유 body 필수, PUT 역할변경 대표만, `PUT /{org_id}/primary-admin` 신규, 활동 조회 기관 범위+클래스/회원 요약, 초대·재초대·목록·활동은 플랫폼 관리자도 허용, 가입 요청·개인정보 수정은 기관 소속 관리자만.
- `org_service`: 집계 `aggregate_member_stats`(class_count·last_activity_at 일괄 2쿼리), 활동 조회 `org_id` 필수, 가입 요청 거절 사유 필수·처리 완료 409.
- 재발송 쿨다운: 429 `INVITE_COOLDOWN` + `retry_after_sec` + `Retry-After` 헤더.
- 마이그레이션: **없음**(B12). 인덱스 필요성은 측정하지 못함(SQLite 시험 환경, EXPLAIN 미수행 → 후속 dev 실측 필요).

### 시험 결과
| 구분 | 결과 |
|---|---|
| 신규 `tests/test_sdd323_org_members_authz.py` | 48 통과 (V1~V14·E1~E4·E6~E11·E14·E16~E18·E22~E28·V-LIST·N+1) |
| 기관 회귀 (sdd016/017/074/075/076/079/082/093/230/248/258/321, test_org*, chat_org_admin_members) | 289 통과 (신규 포함) |
| 백엔드 전체 `pytest` | **5446 통과 / 567 skip / 0 실패** (561초) |
| N+1 | 구성원 4→34명(+30)일 때 SELECT 증가 ≤2 (`selectinload` 로 코치 프로필 일괄 로딩) |

### 기존 시험 수정 (정책 변경 반영, 사유 기록)
- 082/258 정지 시험 → 기관 경로 403 `ORG_STATUS_PLATFORM_ONLY` 기대로 교체(대표 확정 ②).
- mb2_auth4_mid_fixes(행위자를 실제 플랫폼 관리자로), mb2_func_fixes_3rd(사유 없는 역할변경 → 422 기대로 교체), sdd081_personal_office(해지 시 사유 body).
- 076/079/082/093: 해지·역할변경에 사유 body 필수화, 076 은 초대 대기 관리자 비활성 집계(E6)에 맞춰 픽스처 membership 을 active 로, 093 은 승격을 대표가 수행하도록 대표 지정, 082 activity 세션에 기관 귀속 부여, 074 은 플랫폼 관리자 목록 조회 200(V14).

### 한계·미검증
- **E5 동시성(서로를 회수하는 병렬 2건)** 은 SQLite 시험 환경에서 행 잠금(FOR UPDATE)이 동작하지 않아 자동화하지 못함. 로직은 `require_active_org`(FOR UPDATE) 아래에서 재계산하도록 구현됨 — dev(PostgreSQL) 에서 독립 스크립트로 재확인 필요.
- E15(개인상담소 복귀)·E19(만료 재발송)·E20 쿨다운 실제 Redis TTL·E21(메일 실패 주입)은 기존 시험(079/258/017)이 커버하는 범위 외 추가 자동화를 하지 않음.
- 실제 DB(dev)·메일 발송은 수행하지 않음.

### 프론트가 맞춰야 할 계약 변화 (plan 대비)
1. `PUT /org/{id}/counselors/{uid}` — `reason` 이 이제 **필수**(누락/공백 422 `REASON_REQUIRED`). 응답은 membership 기준 `CounselorResponse`(보강 필드 없이 기본 필드; 보강 필드는 목록에서만 채워짐).
2. `DELETE /org/{id}/counselors/{uid}` — body `{ "reason": "..." }` 필수(JSON body).
3. 정지/재활성 라우트는 남아 있으나 항상 403 — FE 는 호출 제거.
4. 에러 응답은 `{detail, code}` (+429 는 `retry_after_sec`). FE 는 `code` 로 분기.
5. `allowed_actions` 에 `invite`/`handle_request` 는 없음(행 단위 행동만): `detail, edit_profile, resend_invite, promote, revoke_admin, remove, transfer_primary`. 초대 대기 행의 `remove` 는 초대 철회(소속 해지)로 취급.
6. 대표 이전: `PUT /org/{id}/primary-admin`, 헤더 `If-Match`. 기관 버전은 `GET /org/{id}/counselors` 응답 헤더 `ETag: "<version>"` 으로 받아 그대로 If-Match 에 넣으면 된다(`"3"`/`3`/`W/3` 허용). body: `target_user_id`, `expected_primary_admin_id`(= 목록의 `is_primary_admin` 행 id), `reason`. 응답 `{org_id, primary_admin_id, version}`.
7. 가입 요청 처리(`PUT /requests/{id}`): 거절 시 `reason` 필수. 플랫폼 관리자는 처리 불가(권한표 '—').
