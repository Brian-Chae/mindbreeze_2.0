# 요약 — 기관 구성원 페이지 상담사 초대

## 변경
- `frontend/src/components/org/counselor-invite-section.tsx` 신설: 대시보드의 초대 폼·초대/가입 현황·재발송·배지 로직을 이동(문구·동작 불변). `showList` prop(기본 true)으로 폼만 표시 가능.
- `OrgDashboardPage.tsx`: 공용 컴포넌트 import로 교체(중복 제거).
- `pages/org/OrgCounselorsPage.tsx`: 상단 액션(rightSlot, data-header-action=primary) '상담사 초대' 버튼 → 모달에 초대 폼. 성공 시 `listCounselors` 재조회 → 목록에 '대기' 배지로 표시(기존 배지 사용). 빈 목록 안내 문구 수정.
- `tests/sdd245-admin-styles.test.tsx`: 초대 CTA 소스 검사 대상을 공용 컴포넌트로 변경.
- 백엔드 변경 없음. 권한은 기존 org_admin 라우트 그대로.

## 테스트
- 신규 `tests/org-members-invite.test.tsx` 4건 통과(버튼·폼 노출, API 호출+목록 재조회+대기 표시, 이메일 검증, 대시보드 재발송 회귀).
- 전체 vitest: 17 실패/8파일 = 기준선 동일, 3067 통과. tsc·eslint·build 통과.
- 실제 초대 메일 발송·dev 서버 접근 없음.
