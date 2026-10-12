# SDD-079 — 상담사 다중 기관 소속 P0 (membership 테이블 + 초대 분기)

> 기획안 `docs/counselor-multi-org-기획.md`의 P0(Phase 1) 구현. **claude(fable) 위주로 개발**.
> 상담사가 여러 기관에 소속될 수 있도록 `user_org_memberships` 테이블을 신설하고, 초대 시 기존 상담사는 계정 생성 없이 소속만 추가한다.

## 1. 정책 확정 (Brian)
- 열린 결정 3건은 권고안으로 진행: 활성 기관 헤더(X-Org-Context)는 Phase 2, 초대 응답 단일 문구, 무소속 세션 생성 현행 유지
- 이번 P0 범위: membership 테이블 + 백필 + 초대 분기 + 쓰기 경로 단일화

## 2. 구현 범위 (claude fable)

### T1. membership 테이블 신설
- `user_org_memberships`: id, user_id(FK users), org_id(FK organizations), role(기본 "counselor"), status(invited/active/left), is_primary(bool), invited_at, invite_expires_at, joined_at, left_at, created_at/updated_at
- 제약: UNIQUE(user_id, org_id) WHERE status != 'left' (동일 기관 중복 방지, 재가입 허용), UNIQUE(user_id) WHERE is_primary AND status='active' (주 소속 1개)
- Alembic 마이그레이션 (수동 리뷰)

### T2. 백필
- User.org_id IS NOT NULL인 counselor/org_admin → membership(status=active, is_primary=True, joined_at=created_at 근사) 생성
- pending 초대 계정 → membership(status=invited) 이관

### T3. 쓰기 경로 단일화 (membership_service)
- 초대/가입승인/소속해제 로직이 membership을 쓰고 User.org_id(주 소속 미러)를 동기 갱신
- membership_service: is_member / get_active_org_ids / require_membership / add_membership / leave_membership / set_primary

### T4. invite_counselor 분기 (§5.2)
- 신규 이메일 → 기존과 동일: User(pending) + CounselorProfile + membership(invited) + 초대 메일
- 기존 이메일 + role==counselor:
  - 이미 이 기관 active/invited → 409 "이미 이 기관에 소속(초대)된 상담사입니다"
  - 아니면 → membership(invited) 생성 + "소속 초대" 메일 (계정·프로필 생성 없음), 수락 시 active
- 기존 이메일 + role != counselor → 409 "상담사 계정이 아닌 이메일입니다"
- 초대 응답은 단일 문구("초대를 발송했습니다")로 계정 존재 여부 노출 최소화

### T5. 기관 구성원 목록 membership 기반
- org_management_service: member_ids 조회를 `memberships WHERE org_id=X AND status='active'` JOIN users로 전환
- 초대 목록에 "유형" 열 (신규 가입 초대 / 소속 추가 초대)

## 3. 주의
- email = 계정 식별자 유지 (unique), CounselorProfile/counselor_code = 계정당 1개 유지
- 소속 해제 = status='left' + left_at (행 삭제/데이터 삭제 없음)
- 기존 상담사 소속 추가는 반드시 본인 수락 (관리자 일방 배정 금지)
- User.org_id(주 소속)는 membership과 항상 동기화 — 쓰기는 membership_service 한 곳으로 단일화
- 기존 46곳 조회 코드는 당장 깨지지 않도록 User.org_id 미러 유지

## 4. 완료 기준
- membership 테이블 + 백필 (기존 상담사/기관관리자 소속 이관)
- invite_counselor가 기존/신규 이메일 자동 분기 (기존 상담사 소속 추가 가능)
- 기관 구성원 목록 membership 기반
- BE pytest 통과, FE build 0 error
