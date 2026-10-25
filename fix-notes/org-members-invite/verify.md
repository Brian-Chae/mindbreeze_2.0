# 구현 전 검증 계획 — 기관 구성원 페이지 상담사 초대

## 현행
- 초대 UI(CounselorInviteSection)는 OrgDashboardPage 내부 함수. /org/counselors(OrgCounselorsPage)에는 없음.
- 구성원 목록(listCounselors)은 이미 대기(pending) 초대를 '대기' 배지로 포함 → 초대 성공 후 refresh만 하면 보임.
- 백엔드(POST /orgs/{id}/counselors/invite, resend) 변경 불필요. 라우트는 org_admin 전용 그대로.

## 설계
- 공용 컴포넌트 frontend/src/components/org/counselor-invite-section.tsx로 폼·현황·재발송·배지 이동(대시보드 문구·동작 불변).
- 구성원 페이지: 상단 액션(rightSlot, data-header-action=primary) '상담사 초대' → 모달에 초대 폼(showList=false) → 성공 시 목록 refresh.

## 검증 항목
- [ ] 구성원 페이지에 '상담사 초대' 버튼, 클릭 시 폼 노출
- [ ] 이름·이메일 입력 후 발송 → inviteCounselor(orgId,{name,email}) 호출 + listCounselors 재호출
- [ ] 잘못된 이메일은 API 호출 없이 오류 문구
- [ ] 대시보드 초대 폼/현황/재발송 동작 불변 (테스트)
- [ ] 전체 vitest(기준선 17건 8파일 실패와 비교), tsc, eslint, build
