# SDD-081 — Plan (Stage ②)

## 아키텍처 요약

개인 상담소는 새 테이블 없이 기존 자원을 재사용한다.
- 기관: `Organization(kind='individual', owner_user_id, verified=True, org_code=None)` — SDD-073 경로와 동일
- 소속: `UserOrgMembership` (SDD-079) — active + (조건부) is_primary
- 팝업: `Notification(type='org_removed')` — 미읽음이면 로그인 후 1회 노출, 확인 시 read 처리
- 메일: `email_app`(Celery) 태스크 — signup_notice_task 와 동일한 아웃박스 패턴

DB 스키마 변경 없음 → Alembic 마이그레이션 불필요.

## 구현 태스크

### T1. `personal_office_service.py` (신규)
- `get_personal_office(db, user)` — `owner_user_id + kind='individual'` 조회 (중복 생성 방지 기준)
- `ensure_personal_office(db, user)` — 없으면 생성(`{이름} 개인 상담소`, 동명 존재 시 접미), 있으면 재사용.
  membership 을 active 로 보장. 주 소속 승격은 `add_membership` 규칙(다른 active 주 소속 없을 때만)에 위임.
  flush 까지만 수행 — commit 은 호출자 책임 (membership_service 와 동일 규칙).
- `fallback_to_personal_office(db, user)` — role=counselor 이고 남은 active 소속이 없을 때만
  ensure 호출 후 office 반환 (T2 복귀 판단).
- `deliver_org_removed_notice(...)` — email worker 가 호출하는 실제 발송 함수.
- `enqueue_org_removed_notice(...)` — commit 후 Celery 큐 적재 (브로커 장애 시 warning 만).

### T1 호출 지점
- `org_invite_service.consume_invite` — counselor 토큰 수락(=상담사 가입) 시 ensure 호출.
  org_admin/client 토큰은 제외 (role 기준 가드). SDD-073 개인 신청 경로는 기존 개인 기관을
  owner_user_id 로 재사용하므로 중복 생성 없음.

### T2. 기관 해제 → 복귀 (2개 해제 경로)
- `org_service.remove_counselor` (org_admin 해제)
- `org_management_service.change_counselor` role=None (플랫폼 관리자 해제)
- 두 경로 모두: `leave_membership` 후 `fallback_to_personal_office` → 복귀 시
  `Notification(type='org_removed')` 생성(같은 트랜잭션) → commit 후 안내 메일 큐 적재.

### T3. 개인 상담소 숨김
- `org_service.search_organizations` — `kind != 'individual'` 필터 (상담사 기관 검색)
- `org_service.list_organizations` — 동일 필터 (플랫폼 관리자 기관 목록)
- `org_public_service.get_org_public_page` — individual 제외 (org_code=None 이라 사실상 도달 불가, 방어적 필터)
- 본인 대시보드: `counselor_dashboard` 응답에 `org_kind` 추가 → FE 에서 individual 이면 "내 개인 상담소" 라벨

### T4. 안내 메일 + 로그인 팝업
- `app/tasks/email.py` — `send_org_removed_email` 템플릿 (기존 스타일)
- `app/tasks/report_email_task.py` — `org_removed_notice_task` (email_app)
- FE `components/org/OrgRemovedNoticeDialog.tsx` — 미읽음 `org_removed` 알림 조회 → 팝업 →
  확인 시 mark read (재노출 없음). `DashboardPage` / `OrgDashboardPage` 에 마운트.
- FE `DashboardPage` — org_kind='individual' 시 "내 개인 상담소" 라벨

## 변경 파일 목록
- backend/app/services/personal_office_service.py (신규)
- backend/app/services/org_invite_service.py
- backend/app/services/org_service.py
- backend/app/services/org_management_service.py
- backend/app/services/org_public_service.py
- backend/app/services/dashboard_service.py
- backend/app/schemas/dashboard.py
- backend/app/tasks/email.py
- backend/app/tasks/report_email_task.py
- backend/tests/test_sdd081_personal_office.py (신규)
- frontend/src/components/org/OrgRemovedNoticeDialog.tsx (신규)
- frontend/src/lib/api/dashboard.ts
- frontend/src/pages/DashboardPage.tsx
- frontend/src/pages/OrgDashboardPage.tsx
