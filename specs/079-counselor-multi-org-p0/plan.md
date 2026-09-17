# SDD-079 Plan — 상담사 다중 기관 소속 P0

> Stage ② — spec.md의 T1~T5를 구현하기 위한 아키텍처·파일 계획.

## 설계 요약

- **진실의 원천**: `user_org_memberships` (신규). `User.org_id`는 "주 소속 미러"로 유지 — 쓰기는
  `membership_service` 한 곳에서만 수행하고 미러를 동기 갱신한다.
- **미러 규칙**: `User.org_id` = active 소속 중 `is_primary=True`인 기관.
  예외: pending(신규 초대) 계정은 기존 동작대로 생성 시점에 org_id를 갖는다(membership은 invited).
- **초대 토큰 분리**: 기존 상담사 "소속 초대"는 새 토큰 타입 `membership_invite` 로 발급한다.
  set-password(`consume_invite`) 화이트리스트에는 넣지 않는다 — 소속 초대 토큰으로 기존 계정의
  비밀번호를 바꿀 수 있으면 계정 탈취 벡터가 되기 때문. 별도 `consume_membership_invite`로만 소비.
- **수락 = 이메일 소유 증명**: 소속 초대 수락 엔드포인트는 토큰만으로 동작(로그인 불요) —
  set-password 흐름과 동일한 신뢰 모델. 관리자 일방 배정은 불가능(본인 메일의 토큰 필요).

## 파일 계획 (Backend)

| # | 파일 | 작업 |
|---|---|---|
| 1 | `app/models/user_org_membership.py` | 신규 모델 + partial unique index 2개 (postgresql_where/sqlite_where 병기) |
| 2 | `app/models/__init__.py` | 모델 등록 |
| 3 | `alembic/versions/e036a0000011_sdd_079_user_org_memberships.py` | 테이블 + 인덱스 + 백필(T2). down_revision=e036a0000010 |
| 4 | `app/services/membership_service.py` | 신규 — is_member / get_active_org_ids / require_membership / get_membership / add_membership / activate_membership / leave_membership / set_primary. flush만 하고 commit은 호출자 책임 |
| 5 | `app/services/org_service.py` | invite_counselor 분기(T4), resend 분기, get_counselors membership 기반(T5), handle_join_request/remove_counselor/update_counselor_role/create_organization/create_org_with_admin의 소속 쓰기를 membership_service로 |
| 6 | `app/services/org_invite_service.py` | MEMBERSHIP_TOKEN_TYPE 발급/소비 + consume_invite 성공 시 invited membership 활성화 |
| 7 | `app/tasks/email.py` | send_membership_invite_email |
| 8 | `app/api/v1/org.py` | list/invite 응답에 membership 상태·invite_type 반영, POST /org/membership-invites/accept |
| 9 | `app/schemas/org.py` | CounselorResponse.invite_type, MembershipInviteAccept 스키마 |
| 10 | `app/services/org_management_service.py` | deactivation_impact member_ids·change_counselor 대상 조회/해제를 membership 기반으로 |
| 11 | `app/services/counselor_info_service.py` | get_target_counselor org 검사 → membership 기반(active/invited) |
| 12 | `tests/conftest.py` | create_test_counselor가 org 소속 시 membership도 생성 |

## 파일 계획 (Frontend)

| # | 파일 | 작업 |
|---|---|---|
| 1 | `src/lib/api/org.ts` | CounselorItem.invite_type, acceptMembershipInvite() |
| 2 | `src/pages/OrgDashboardPage.tsx` | 초대·가입 현황에 "유형" 열 (신규 가입 / 소속 추가) |
| 3 | `src/pages/MembershipInvitePage.tsx` | 소속 초대 수락 페이지 (신규) |
| 4 | `src/App.tsx` | `/membership-invite` 라우트 |

## API 계약 변경

- `GET /org/{org_id}/counselors`: status는 membership 기준(invited→"pending"), `invite_type` 추가
  (`new_account` = 신규 가입 초대, `org_membership` = 소속 추가 초대, active면 null).
- `POST /org/{org_id}/counselors/invite`: 분기 (spec §T4). 응답 형태 동일(단일 문구 원칙).
- `POST /org/{org_id}/counselors/{user_id}/resend-invite`: membership invited 대상 —
  신규 계정은 set-password 링크, 기존 상담사는 membership 링크 재발송.
- `POST /org/membership-invites/accept` (신규, 무인증): {token} → membership active.

## 테스트

- 신규 `tests/test_sdd079_multi_org_membership.py` — verify.md 시나리오.
- 기존 `test_sdd017_counselor_invite.py` TS4: 동일 기관 재초대 409 문구가
  "이미 이 기관에 소속(초대)된 상담사입니다"로 변경됨에 따라 갱신.
