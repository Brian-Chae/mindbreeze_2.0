# SDD-258 — 구현 계획

| # | 파일 | 변경 |
|---|---|---|
| 1 | backend/app/schemas/org.py | `CounselorInviteRequest.role` 추가 |
| 2 | backend/app/services/org_service.py | `invite_counselor(role)` 분기, `resend_counselor_invite` org_admin 허용·역할별 메일 |
| 3 | backend/app/services/org_invite_service.py | `issue_membership_invite(role)`, 수락 시 org_admin 미러 role 동기 |
| 4 | backend/app/tasks/email.py | 소속 초대 메일 `role` 분기(org_admin일 때만 kwarg) |
| 5 | backend/app/api/v1/org.py | role 전달, 응답 role=멤버십 역할 |
| 6 | backend/app/services/org_service.py | `set_counselor_suspension` org_admin 허용 + 최소 1명 가드 |
| 7 | frontend/src/lib/api/org.ts, components/org/counselor-invite-section.tsx, pages/org/OrgCounselorsPage.tsx | 기관관리자 초대 버튼·팝업 |
| 8 | backend/tests/test_sdd258_org_admin_invite.py | verify 시나리오 |

마이그레이션 없음(기존 user_org_memberships.role 사용).
