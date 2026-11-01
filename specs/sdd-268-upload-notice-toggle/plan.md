# SDD-268 plan
1. `describeUploadProgress` 문구 치환(내부 용어 제거) + `isUploadAbnormal(view)` 노출.
2. `MemberTopBar`: 연결 표시를 버튼으로(`onConnClick`, `connExpanded`), 기존 시각·aria-label 유지.
3. `MemberClassView` props 에 `connToggle?: { expanded: boolean; onToggle: () => void }` 가산 전달.
4. `MemberClassContainer`: 상태 `uploadNoticeOpen`(기본 false), 표시 = open || 이상. 상시 렌더 제거.
5. 테스트·회귀(vitest 회원 클래스, sdd260-web, sdd26x), tsc, eslint.
