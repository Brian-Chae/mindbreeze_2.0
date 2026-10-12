# SDD-079 Summary — 상담사 다중 기관 소속 P0

> Stage ⑥ — 구현 결과·설계 결정·테스트 정리. 구현: claude(fable).

## 구현 결과

### T1. membership 테이블 (완료)
- `backend/app/models/user_org_membership.py` — `user_org_memberships` 신설.
- partial unique index 2종: `UNIQUE(user_id, org_id) WHERE status != 'left'`(재가입 허용),
  `UNIQUE(user_id) WHERE is_primary AND status='active'`(주 소속 1개).
  postgresql_where/sqlite_where 병기로 테스트(SQLite)에서도 제약 동작.
- Alembic `e036a0000011` (revises e036a0000010).

### T2. 백필 (완료)
- 마이그레이션 내 Python 백필: org_id 보유 counselor/org_admin 전원 →
  active 계정 = membership(active, is_primary=True, joined_at=created_at 근사),
  pending 초대 계정 = membership(invited, invited_at/expires 이관, is_primary=False).

### T3. membership_service (완료)
- `backend/app/services/membership_service.py` — is_member / get_active_org_ids /
  require_membership / get_membership / add_membership / activate_membership /
  leave_membership / set_primary. flush만 하고 commit은 호출자 책임.
- User.org_id 미러 동기화는 `_sync_primary_mirror` 한 곳: 미러 = is_primary·active 소속.
  예외 — pending 계정은 생성 시점 org_id 유지(SDD-017 초대 관리 호환), 단 해당 기관
  초대까지 사라지면 미러를 비운다.
- 쓰기 경로 전환: invite_counselor / set-password 수락(consume_invite) / 가입 승인
  (handle_join_request) / 소속 해제(remove_counselor·change_counselor) / 역할 변경 /
  기관 생성(create_organization·create_org_with_admin) / 개인 상담사 가입 신청
  (signup_application_service) / dev 사용자 생성(dev_user_service).

### T4. invite_counselor 분기 (완료 — 409 문제 해결)
- 신규 이메일: 기존 동일(User pending + CounselorProfile) + membership(invited).
- 기존 이메일 + counselor: 이 기관 active/invited면 409 "이미 이 기관에 소속(초대)된
  상담사입니다", 아니면 membership(invited)만 생성 + **소속 초대 메일**(계정·프로필 생성 없음).
- 기존 이메일 + non-counselor: 409 "상담사 계정이 아닌 이메일입니다".
- 응답 형태는 두 경로 동일(단일 문구 원칙) — FE 성공 메시지도 기존 단일 문구 유지.
- 새 토큰 타입 `membership_invite` (org 클레임 + Redis "user:org" 검증, 일회용).
  **set-password 화이트리스트 제외** — 소속 초대 토큰으로 비밀번호 변경 불가(탈취 차단, 테스트 검증).
- 수락: `POST /org/membership-invites/accept` (무인증 — 이메일 링크 소유 = 본인 수락,
  set-password와 동일 신뢰 모델). FE `/membership-invite` 수락 페이지 신설.
- 재발송: membership invited 대상 — pending 계정은 set-password 링크, 기존 상담사는
  membership 링크로 분기.

### T5. 구성원 목록 membership 기반 (완료)
- `org_service.get_counselors` → memberships(active/invited) JOIN users.
  목록 status는 membership 기준(invited→"pending"), `invite_type` 추가
  (new_account=신규 가입 초대 / org_membership=소속 추가 초대).
- FE 초대·가입 현황에 "유형" 열(신규 가입/소속 추가 뱃지) — 데스크톱 테이블 + 모바일 카드.
- `org_management_service.deactivation_impact` member_ids → membership ∪ org_id 미러 합집합
  (기관 소속 내담자 등 미러만 있는 계정 누락 방지).
- `change_counselor`(admin)·`counselor_info_service` 대상 조회 → membership 기반
  (다중 소속 상담사를 비주소속 기관 관리자도 관리 가능).

## 설계 결정 (spec 외 판단)

1. **membership_invite 토큰의 set-password 차단** — 보안상 필수 (계정 탈취 벡터 차단).
2. **change_counselor에 org_id 미러 폴백** — membership 없는 기관 소속 계정(예: client)의
   기존 422 계약 유지 ("당장 깨지지 않아야 함" 원칙).
3. **deactivation_impact 합집합** — membership 단독 전환 시 기관 소속 내담자가 영향 계산에서
   빠지는 회귀를 막음.
4. **수락 무인증(토큰만)** — 이메일 소유 증명 = 본인 수락. 로그인 강제 대비 P0 흐름 단순화.

## 테스트

- 신규 `backend/tests/test_sdd079_multi_org_membership.py` 12건 — verify.md TS1~TS7
  (신규/기존 분기, 409 2종, 수락·재사용·탈취 차단, 주 소속 승격, left 이력·재초대, 목록 유형, 재발송 분기).
- 기존 테스트 정합: `test_sdd017` TS4 문구 갱신, `test_sdd074` org_data 픽스처에
  백필 불변식(membership) 반영, `conftest.create_test_counselor` membership 생성.
- 결과: **backend pytest 633 passed / 12 skipped**, **frontend `npm run build` 0 error**
  (frontend는 test 스크립트 없음), alembic heads = e036a0000011 단일.

## 남은 것 (P1/P2 — 범위 외)

- 토큰 org_ids + X-Org-Context 헤더, 46곳 조회 전환, 기관 전환 드롭다운·주 소속 설정 UI,
  소속 초대 "거절" 명시 액션, User.org_id 제거(Phase 3).
