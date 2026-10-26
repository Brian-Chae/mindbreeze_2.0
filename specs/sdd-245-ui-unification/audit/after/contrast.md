# 버튼 AA 대비 (SDD-245)

## 공용 토큰 조합
| 조합 | 글자 | 배경 | 대비 | 기준 | 판정 |
|---|---|---|---:|---|---|
| primary normal | #FFFFFF | #5F0080 | 11.68 | 4.5 | 통과 |
| primary hover | #FFFFFF | #4B0066 | 14.08 | 4.5 | 통과 |
| primary inverse normal | #5F0080 | #FFFFFF | 11.68 | 4.5 | 통과 |
| primary inverse hover | #5F0080 | #F4EDF8 | 10.19 | 4.5 | 통과 |
| primary danger normal | #FFFFFF | #B3264B | 6.37 | 4.5 | 통과 |
| primary danger hover | #FFFFFF | #962041 | 8.14 | 4.5 | 통과 |
| secondary normal | #5F0080 | #F4EDF8 | 10.19 | 4.5 | 통과 |
| secondary hover | #5F0080 | #EADFF2 | 9.08 | 4.5 | 통과 |
| secondary danger normal | #B3264B | #FDECEF | 5.59 | 4.5 | 통과 |
| secondary danger hover | #B3264B | #FAD9E0 | 4.88 | 4.5 | 통과 |
| ghost on 페이지 배경 #F7F4F0 | #5F0080 | #F7F4F0 | 10.65 | 4.5 | 통과 |
| ghost on 흰 카드 | #5F0080 | #FFFFFF | 11.68 | 4.5 | 통과 |
| ghost hover | #5F0080 | #F4EDF8 | 10.19 | 4.5 | 통과 |
| ghost danger on 흰 카드 | #B3264B | #FFFFFF | 6.37 | 4.5 | 통과 |
| ghost danger hover | #B3264B | #FDECEF | 5.59 | 4.5 | 통과 |
| icon normal | #1F1F1F | #F2F3F8 | 14.87 | 4.5 | 통과 |
| icon hover | #1F1F1F | #E6E7EF | 13.38 | 4.5 | 통과 |
| 탭 활성 | #FFFFFF | #5F0080 | 11.68 | 4.5 | 통과 |
| 탭 비활성 on 페이지 배경 | #5F0080 | #F7F4F0 | 10.65 | 4.5 | 통과 |
| 칩 | #655173 | #F1EDF5 | 6.10 | 4.5 | 통과 |
| 입력 placeholder | #6F6F6F | #FFFFFF | 5.02 | 4.5 | 통과 |
| 입력 텍스트 | #1F1F1F | #FFFFFF | 16.48 | 4.5 | 통과 |

## 컨트롤 경계·포커스 (3:1)
| 조합 | 전경 | 배경 | 대비 | 판정 |
|---|---|---|---:|---|
| 입력 경계 #857E8F / 흰 | #857E8F | #FFFFFF | 3.90 | 통과 |
| focus ring #5F0080 / 흰 | #5F0080 | #FFFFFF | 11.68 | 통과 |
| focus ring #5F0080 / 페이지 배경 | #5F0080 | #F7F4F0 | 10.65 | 통과 |

## 재측정 실제 컨트롤(normal) 전체
- 검사 3676개 중 AA 미달 715개 (투명 배경은 셸 배경색과 합성; 그라데이션/이미지 위 텍스트는 별도 육안)

| 종류 | 최저 대비 | 표본 | 텍스트 |
|---|---:|---|---|
| ghost | 1.27 | client-1440-onboarding-client | 랜딩 페이지로 이동 |
| secondary | 4.40 | client-1440-playground | 30초 |
| icon | 1.80 | public-390-landing | 메뉴 열기 |
| primary | 1.80 | counselor-1440-org-search | + 기관 가입 상담 신청 |
| tab | 10.19 | client-1440-app-classes-sample-class | 개요 |

### 미달 목록(상위 40)
| 표본 | 종류 | 텍스트 | 대비 | 기준 | 글자색 | 배경 |
|---|---|---|---:|---:|---|---|
| client-1440-app-profile | ghost | 로그아웃 | 4.5 | 4.5 | rgb(119, 109, 123) | rgba(0, 0, 0, 0) |
| client-1440-onboarding-client | ghost | 랜딩 페이지로 이동 | 1.27 | 4.5 | rgb(31, 31, 31) | rgba(0, 0, 0, 0) |
| client-1440-playground | secondary | 30초 | 4.4 | 4.5 | rgb(111, 111, 111) | rgb(245, 237, 252) |
| client-1440-playground | secondary | 5분 | 4.4 | 4.5 | rgb(111, 111, 111) | rgb(245, 237, 252) |
| client-390-app-audit-unknown | ghost | 홈 | 1.63 | 4.5 | rgb(201, 190, 207) | rgba(0, 0, 0, 0) |
| client-390-app-audit-unknown | ghost | 내 클래스 | 1.63 | 4.5 | rgb(201, 190, 207) | rgba(0, 0, 0, 0) |
| client-390-app-audit-unknown | ghost | 상담 | 1.63 | 4.5 | rgb(201, 190, 207) | rgba(0, 0, 0, 0) |
| client-390-app-audit-unknown | ghost | 리포트 1건 | 1.63 | 4.5 | rgb(201, 190, 207) | rgba(0, 0, 0, 0) |
| client-390-app-audit-unknown | ghost | 설정 | 1.63 | 4.5 | rgb(201, 190, 207) | rgba(0, 0, 0, 0) |
| counselor-1440-classes-sample-class-members | ghost | 개요 | 2.29 | 4.5 | rgb(162, 163, 173) | rgba(0, 0, 0, 0) |
| counselor-1440-classes-sample-class-members | ghost | 회차 | 2.29 | 4.5 | rgb(162, 163, 173) | rgba(0, 0, 0, 0) |
| counselor-1440-classes-sample-class-members | ghost | 설정 | 2.29 | 4.5 | rgb(162, 163, 173) | rgba(0, 0, 0, 0) |
| counselor-1440-classes-sample-class-schedule | ghost | 멤버 | 2.29 | 4.5 | rgb(162, 163, 173) | rgba(0, 0, 0, 0) |
| counselor-1440-clients-invite | ghost | ← 목록으로 | 4.18 | 4.5 | rgb(111, 111, 111) | rgba(0, 0, 0, 0) |
| counselor-1440-credentials | ghost | Mind Breeze | 1.27 | 4.5 | rgb(31, 31, 31) | rgba(0, 0, 0, 0) |
| counselor-1440-design-app | ghost | 27 | 1.41 | 4.5 | rgb(194, 195, 206) | rgba(0, 0, 0, 0) |
| counselor-1440-design-app | ghost | 28 | 1.41 | 4.5 | rgb(194, 195, 206) | rgba(0, 0, 0, 0) |
| counselor-1440-design-app | ghost | 29 | 1.41 | 4.5 | rgb(194, 195, 206) | rgba(0, 0, 0, 0) |
| counselor-1440-design-app | ghost | 30 | 1.41 | 4.5 | rgb(194, 195, 206) | rgba(0, 0, 0, 0) |
| counselor-1440-design-homepage | ghost | Mind Breeze | 1.27 | 4.5 | rgb(31, 31, 31) | rgba(0, 0, 0, 0) |
| counselor-1440-design-homepage | ghost | 서비스 | 1.8 | 4.5 | rgb(95, 0, 128) | rgba(0, 0, 0, 0) |
| counselor-1440-design-homepage | ghost | AI 리포트 | 1.27 | 4.5 | rgb(31, 31, 31) | rgba(0, 0, 0, 0) |
| counselor-1440-design-homepage | ghost | 고객 사례 | 1.27 | 4.5 | rgb(31, 31, 31) | rgba(0, 0, 0, 0) |
| counselor-1440-design-homepage | ghost | 고객센터 | 1.27 | 4.5 | rgb(31, 31, 31) | rgba(0, 0, 0, 0) |
| counselor-1440-design-homepage | ghost | 지도사 로그인 | 1.27 | 4.5 | rgb(31, 31, 31) | rgba(0, 0, 0, 0) |
| counselor-1440-design-user-app | ghost | 클래스 | 2.02 | 4.5 | rgb(162, 163, 173) | rgba(0, 0, 0, 0) |
| counselor-1440-design-user-app | ghost | 리포트 | 2.02 | 4.5 | rgb(162, 163, 173) | rgba(0, 0, 0, 0) |
| counselor-1440-design-user-app | ghost | 프로필 | 2.02 | 4.5 | rgb(162, 163, 173) | rgba(0, 0, 0, 0) |
| counselor-1440-onboarding-counselor | ghost | 나중에 하기 | 4.4 | 4.5 | rgb(111, 111, 111) | rgba(0, 0, 0, 0) |
| counselor-1440-org-sample-org | ghost | 소속 해제 | 3.3 | 4.5 | rgb(179, 38, 75) | rgba(0, 0, 0, 0) |
| counselor-1440-org-search | primary | + 기관 가입 상담 신청 | 1.8 | 4.5 | rgb(95, 0, 128) | rgba(0, 0, 0, 0) |
| counselor-1440-sessions-sample-session-class-report | ghost | 01오늘 수업 한 줄 | 3.14 | 4.5 | rgb(99, 88, 107) | rgba(0, 0, 0, 0) |
| counselor-1440-sessions-sample-session-class-report | ghost | 02함께한 사람들 | 3.14 | 4.5 | rgb(99, 88, 107) | rgba(0, 0, 0, 0) |
| counselor-1440-sessions-sample-session-class-report | ghost | 03수업 흐름 | 3.14 | 4.5 | rgb(99, 88, 107) | rgba(0, 0, 0, 0) |
| counselor-1440-sessions-sample-session-class-report | ghost | 04몸과 마음의 변화 | 3.14 | 4.5 | rgb(99, 88, 107) | rgba(0, 0, 0, 0) |
| counselor-1440-sessions-sample-session-class-report | ghost | 05참여자별로 이어보기 | 3.14 | 4.5 | rgb(99, 88, 107) | rgba(0, 0, 0, 0) |
| counselor-1440-sessions-sample-session-live | ghost | 06이제 할 일 | 3.14 | 4.5 | rgb(99, 88, 107) | rgba(0, 0, 0, 0) |
| counselor-390-chat | ghost | 클래스 | 1.63 | 4.5 | rgb(201, 190, 207) | rgba(0, 0, 0, 0) |
| counselor-390-classes-sample-class-members | ghost | 대화 1건 | 1.63 | 4.5 | rgb(201, 190, 207) | rgba(0, 0, 0, 0) |
| platform_admin-390-admin-applications | ghost | 사용자 | 1.63 | 4.5 | rgb(201, 190, 207) | rgba(0, 0, 0, 0) |
