# 명상 클래스 기준 스타일 조사

- 목록 필터/입력: `frontend/src/pages/classes/host-classes-page.tsx:24` — `rounded-xl border border-gray-200 bg-white px-4 py-2`, 선택 `aria-pressed:bg-purple-800 aria-pressed:text-white`, 입력 `min-h-11`.
- 주요/보조 버튼: `frontend/src/components/class/structure/class-create-action.tsx:21-24` — primary `rounded-xl bg-purple-800 px-4 py-2 text-sm font-semibold text-white`, secondary 흰 표면과 보라 테두리·보라 글자.
- 상세 탭: `frontend/src/pages/classes/host-class-detail-page.tsx:35` — `border-b-2 px-4 py-3`, 선택 `border-purple-800 font-semibold text-purple-800`, 비선택 투명 밑줄.
- 상세 카드: 같은 파일 `:35` — `rounded-2xl border border-gray-200 bg-white p-5`.
- 운영 버튼·입력/select: `frontend/src/components/class/structure/class-operation-state.ts:4-5` — `rounded-xl border bg-white px-4 py-2`, 입력 `w-full rounded-xl border bg-white px-3 py-2`.
- ghost/목록 이동: `frontend/src/pages/classes/host-class-detail-page.tsx:35` — 흰 표면·rounded-xl, 보조 링크는 border+bg-white. 목록/상세에는 페이지네이션 전용 공용 컴포넌트가 없으므로 같은 보조 버튼을 첫/다음 페이지에 적용한다.
- 칩·목록: `frontend/src/components/class/structure/structure-shell.css:23-25,32,50-53` — 흰 카드, 16px 모서리, 보라색 pill 칩. 데스크톱 목록은 grid 행(HTML table 컴포넌트 아님)으로 데이터 센터는 의미론적 table을 유지하면서 표면·간격·색을 정렬한다.
- 포커스/터치: 같은 파일 `:10-11` — 44px 최소 조작 영역, `outline:2px solid #7c3aed; outline-offset:2px`.
- 실제 색 토큰: `design-system/build/outputs/tailwind/preset.cjs:35-63` — purple-800 `#6e1a8c`, purple-900 `#5f0080`, purple-50 `#f5edfc`, gray-600 `#6f6f6f`, gray-700 `#404040`, gray-800 `#1f1f1f`, gray-200 `#efefef`. 일반 Tailwind 기본 팔레트와 다르다.
- 공용 토큰 연결: `frontend/tailwind.config.cjs:2,5` — 프로젝트 preset 재사용. 공용 Button/Tabs/Select 컴포넌트 대신 명상 클래스가 쓰는 Tailwind 유틸리티를 데이터 센터 CSS @apply로 재사용한다.

## 원인

기존 `.dc button:hover:not(:disabled)`의 특이도(0,3,1)가 `.dc .dc-primary:hover`(0,3,0)보다 높아, hover 시 연보라 배경으로 덮지만 흰 글자가 남는다. 버튼·탭·입력 규칙이 세 CSS에 중복되어 다운로드/측정 화면의 상태가 달랐다. 공통 버튼 상태를 한 파일로 모으고 hover 상태의 특이도는 :where로 낮춰 primary/선택 상태가 우선하게 한다.
