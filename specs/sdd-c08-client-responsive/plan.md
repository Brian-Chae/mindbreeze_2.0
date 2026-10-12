# SDD-C08 구현 플랜: 내담자 앱 반응형 전환

> **For Hermes:** Use subagent-driven-development skill. Claude Code worker로 각 Task 구현 후 빌드 검증.

**Goal:** 내담자 앱 8개 페이지를 모바일+데스크탑 반응형으로 전환

**Architecture:** 
- `ClientShell`을 반응형으로 업그레이드 (데스크탑: 좌측 네비 + 중앙 콘텐츠, 모바일: BottomTabBar)
- 각 페이지에 `md:` responsive 클래스 추가
- `ClientChatRoomPage`는 데스크탑에서 split-pane (목록+채팅)

**Tech Stack:** React 18 + TypeScript, Tailwind CSS 3

**Reference:** 상담사 `SessionListPage.tsx` 패턴 (`md:hidden` MobileSection + `hidden md:block` desktop)

---

## Task 1: ClientShell 반응형 업그레이드

**Objective:** ClientShell을 `AppShell`과 동등한 반응형 레이아웃으로 전환

**File:** `frontend/src/components/client/ClientShell.tsx`

**Architecture:**
```
Desktop (md+):
┌──────────┬──────────────────────────────┐
│ Nav      │  Content Area                │
│ 200px    │  flex-1, max-w-4xl mx-auto   │
│          │                              │
└──────────┴──────────────────────────────┘

Mobile (<md):
┌────────────────────────┐
│ Top Bar (56px)         │
├────────────────────────┤
│ Content                │
│ pt-14 pb-14            │
├────────────────────────┤
│ BottomTabBar           │
└────────────────────────┘
```

**구현:**

1. 데스크탑 레이아웃: `md:flex` + 좌측 네비게이션 (200px)
   - 로고 "마인드브리즈" + 네비 링크 (홈, 채팅, 세션, 리포트, 프로필)
   - 현재 경로 기준 active 스타일
2. 모바일: 기존 TopBar + BottomTabBar 유지 (`md:hidden` 래핑)
3. 데스크탑 콘텐츠 영역: `flex-1 md:px-8 md:py-6 max-w-5xl mx-auto w-full`
4. BottomTabBar는 `md:hidden`으로 감싸서 데스크탑에서 숨김
5. `useLocation`으로 현재 경로 확인하여 네비 active 표시

**검증:**
- `npm run build` 통과
- 데스크탑 너비에서 좌측 네비게이션 표시
- 모바일 너비에서 BottomTabBar 표시

---

## Task 2: ClientHomePage 반응형

**Objective:** 홈 대시보드 카드 레이아웃을 데스크탑에서 2-3열 그리드로 전환

**File:** `frontend/src/pages/client/ClientHomePage.tsx`

**변경:**
1. 최상단 컨테이너: `px-4 md:px-8 py-4 md:py-6`
2. 요약 카드 영역: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`
3. "다음 세션" 카드: `md:col-span-2`로 강조
4. 콘텐츠 최대 너비 제한 제거 (기존 `max-w-sm` 등)
5. 섹션 간 여백: `space-y-4 md:space-y-6`

**검증:** `npm run build` 통과

---

## Task 3: ClientChatListPage 반응형

**Objective:** 채팅방 목록을 데스크탑에서 더 넓은 카드 레이아웃으로

**File:** `frontend/src/pages/client/ClientChatListPage.tsx`

**변경:**
1. 컨테이너: `px-0 md:px-4`
2. 목록 아이템: `px-4 md:px-6 py-3.5 md:py-4` (더 넓은 패딩)
3. 아바타: `w-12 h-12 md:w-14 md:h-14`
4. 검색/필터 영역 추가 (데스크탑 전용): 상단 검색바

**검증:** `npm run build` 통과

---

## Task 4: ClientChatRoomPage 반응형 → Split-Pane

**Objective:** 데스크탑에서 좌측 채팅방 목록 + 우측 채팅 영역 split-pane

**Files:** 
- `frontend/src/pages/client/ClientChatRoomPage.tsx` (기존)
- `frontend/src/pages/client/ClientAppPage.tsx` (라우팅 로직 수정)

**Architecture:**
```
Desktop: /app/chat → split-pane
┌────────────┬──────────────────────────┐
│ Chat List  │  Chat Room               │
│ 320px      │  flex-1                  │
│            │                          │
└────────────┴──────────────────────────┘

Mobile: /app/chat/:roomId → full screen chat (기존과 동일)
```

**변경:**
1. `ClientAppPage.tsx`:
   - `/app/chat` 경로에 데스크탑 split-pane 렌더링 추가
   - `ChatPage.tsx`의 split-pane 패턴 참고
2. `ClientChatRoomPage.tsx`:
   - `max-w-lg` 제거
   - 헤더: `md:hidden`으로 뒤로가기 버튼 감싸기 (데스크탑에선 split-pane이므로 불필요)
   - 입력창: `max-w-3xl mx-auto`로 중앙 정렬 (데스크탑)
   - 메시지 영역: `max-w-3xl mx-auto`로 중앙 정렬

**검증:** 
- `npm run build` 통과
- 데스크탑 `/app/chat`에서 좌측 목록 + 우측 채팅 영역 표시
- 모바일에서 기존과 동일하게 전체화면 채팅

---

## Task 5: ClientSessionListPage 반응형

**Objective:** 세션 목록을 데스크탑에서 그리드 + 캘린더 뷰로

**File:** `frontend/src/pages/client/ClientSessionListPage.tsx`

**변경:**
1. 컨테이너: `px-4 md:px-8 py-4 md:py-6`
2. 세션 카드 그리드: `grid grid-cols-1 md:grid-cols-2 gap-4`
3. 카드 내부: `md:flex md:justify-between md:items-center`
4. 필터/탭 영역 (예정/완료): 데스크탑에서 가로 정렬

**검증:** `npm run build` 통과

---

## Task 6: ClientSessionDetailPage 반응형

**Objective:** 세션 상세 페이지를 데스크탑에서 더 넓은 레이아웃으로

**File:** `frontend/src/pages/client/ClientSessionDetailPage.tsx`

**변경:**
1. 컨테이너: `max-w-3xl mx-auto md:px-8`
2. 상세 정보 그리드: `grid grid-cols-1 sm:grid-cols-2 gap-4`
3. 액션 버튼: `flex flex-col md:flex-row gap-2`

**검증:** `npm run build` 통과

---

## Task 7: ClientReportListPage 반응형

**Objective:** 리포트 카드 그리드를 데스크탑에서 다중 열로

**File:** `frontend/src/pages/client/ClientReportListPage.tsx`

**변경:**
1. 컨테이너: `px-4 md:px-8 py-4 md:py-6`
2. 리포트 카드 그리드: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`
3. 카드 크기: `min-h-[200px]` 등 일관된 높이

**검증:** `npm run build` 통과

---

## Task 8: ClientProfilePage 반응형

**Objective:** 프로필 페이지를 데스크탑에서 2열 레이아웃으로

**File:** `frontend/src/pages/client/ClientProfilePage.tsx`

**변경:**
1. 프로필 카드 + 상담사 목록: `md:grid md:grid-cols-2 gap-6`
2. 컨테이너: `px-4 md:px-8 py-4 md:py-6`
3. 설정/로그아웃 영역: `max-w-md`로 제한

**검증:** `npm run build` 통과

---

## 실행 순서

```
Task 1 (ClientShell) ──필수 선행──→ Task 2~8 (각 페이지)
                                    ├── Task 2 (Home)
                                    ├── Task 3 (ChatList)
                                    ├── Task 4 (ChatRoom + AppPage)
                                    ├── Task 5 (SessionList)
                                    ├── Task 6 (SessionDetail)
                                    ├── Task 7 (ReportList)
                                    └── Task 8 (Profile)
```

Task 1을 먼저 완료한 후, Task 2~8은 병렬로 2개씩 진행 가능.

**최종 검증:** 모든 Task 완료 후 `npm run build` + 페이지별 데스크탑/모바일 확인
