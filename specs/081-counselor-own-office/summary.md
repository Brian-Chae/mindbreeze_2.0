# SDD-081 — Summary (Stage ⑥)

## 구현 결과

DB 스키마 변경 없이 기존 자원(Organization kind=individual, UserOrgMembership,
Notification, email_app Celery)을 재사용해 4개 태스크를 모두 구현했다.

### T1. 개인 상담소 자동 개설
- **신규** `backend/app/services/personal_office_service.py`
  - `ensure_personal_office` — owner_user_id 기준 조회(중복 생성 금지), 없으면
    `{이름} 개인 상담소` (kind=individual, verified=True, org_code=None) 생성 + membership active 보장
  - `fallback_to_personal_office` — 개인 상담소 외 active 소속이 없을 때만 복귀 처리
- `org_invite_service.consume_invite` — 상담사(role=counselor) 가입 완료 시 ensure 호출.
  초대 기관 membership 활성화 뒤에 호출해 **주 소속은 초대 기관 유지**, 개인 상담소는 비주 fallback.
- SDD-073 개인 신청 경로는 기존 개인 기관을 owner 기준 재사용 — 기관 1개만 존재.

### T2. 기관 해제 → 개인 상담소 복귀
- `org_service.remove_counselor`(org_admin 해제), `org_management_service.change_counselor`
  role=None(플랫폼 관리자 해제) 두 경로 모두: leave 후 기관 소속이 안 남으면 개인 상담소
  복귀(주 소속 승격 + User.org_id 미러) + `org_removed` 인앱 알림 + 안내 메일 큐 적재(commit 후).
- SDD-081 이전 가입 상담사(개인 상담소 없음)도 해제 시점에 개설해 무소속 차단.

### membership 우선순위 정합 (SDD-079 확장)
- `leave_membership` 승격 순서: 기관 소속 우선, 개인 상담소는 최후 fallback
- `add_membership`/`activate_membership`: 주 소속이 개인 상담소뿐인 상태에서 기관
  소속이 생기면 기관을 주 소속으로 승격 (`_promote_over_personal_office`)
- 기관 가입 신청(`request_join`/`handle_join_request`): 개인 상담소만 있는 상태를
  무소속과 동일하게 취급 (`_eligible_for_join`) — 가입 신청 플로우 유지

### T3. 개인 상담소 숨김
- `/org/search`, `/admin/orgs`(플랫폼 관리자 목록), org_public 조회에서 kind=individual 제외
- 본인 대시보드: `counselor_dashboard` 응답에 `org_kind` 추가 → FE "내 개인 상담소" 라벨

### T4. 안내 메일 + 로그인 팝업
- `send_org_removed_email`(email.py) + `org_removed_notice_task`(email_app worker, 아웃박스 패턴)
- **신규** `frontend/src/components/org/OrgRemovedNoticeDialog.tsx` — 미읽음 `org_removed`
  알림 → 팝업 1회 → 확인 시 read 처리(재노출 없음). DashboardPage·OrgDashboardPage 마운트.

## 테스트
- **신규** `tests/test_sdd081_personal_office.py` — TS1~TS10 (9개) 전부 통과
- 기존 테스트 3건은 SDD-081 정책 변경(무소속 → 개인 상담소 복귀, 관리자 목록 숨김)에
  맞춰 기대값 갱신: test_sdd074(목록 숨김), test_sdd076(해제 후 office 복귀 + 감사 after),
  test_sdd079 TS6(미러가 None 대신 개인 상담소)
- `venv/bin/pytest`: **645 passed, 12 skipped**
- `npm run build`: **0 error**

## 디버깅 노트
- 최초 설계의 "남은 active 소속 없음" 판정은 개인 상담소 membership 이 상시 active 라
  복귀 알림이 영영 발화하지 않는 결함이 있었음 → "개인 상담소 제외 active 소속 없음"으로
  수정하고, 승격 우선순위(기관 > 개인 상담소)를 membership_service 에 반영.
