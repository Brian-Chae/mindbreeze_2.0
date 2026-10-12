# Client Layout Unification — 상담사 레이아웃으로 통일

## 목표

회원용(Client) 전체 페이지 레이아웃과 채팅 화면을 상담사(Counselor) 페이지와 완전히 동일한 구조로 통일한다.

## 현재 상태 분석

### 상담사 (기준 / Target)
- `AppShell` + `SidebarNav` (240px, bg-[#F5EDFC])
- 데스크탑: `grid-cols-[240px_1fr]`
- 콘텐츠 영역: `section.flex.flex-col.flex-1.min-w-0.min-h-0` (overflow 없음)
- 각 페이지가 자체 스크롤 관리
- 채팅: `ChatPage` → 좌측 채팅방 목록 + 우측 ChatRoom (side-by-side)

### 회원 (현재 / Source)
- `ClientShell` (자체 구현, w-[200px] nav, 다른 스타일)
- 데스크탑: `flex flex-1` (nav 200px + main flex-1)
- main에 `overflow-y-auto pt-14 pb-14` 강제 → 중첩 스크롤 문제
- 채팅: 별도 페이지들 (ClientChatListPage → ClientChatRoomPage, portal overlay)
- 각 페이지가 독립 라우트

## 요구사항

### R1. 사이드바 통일
- 회원용 사이드바를 상담사 `SidebarNav`와 동일한 디자인으로 변경
- 240px 너비, bg-[#F5EDFC], 동일 아이콘/메뉴 구성
- 단, 메뉴 항목은 회원용으로 변경 (홈, 채팅, 세션, 리포트, 프로필)

### R2. 레이아웃 쉘 통일
- `ClientShell`을 `AppShell` 패턴으로 변경
- `grid-cols-[240px_1fr]`, `noScroll` 기본, overflow는 각 페이지가 관리
- 하단탭바(BottomTabBar)는 유지 (모바일 전용)

### R3. 채팅 화면 통일
- 회원 채팅도 좌측 채팅방 목록 + 우측 채팅창 side-by-side 레이아웃
- `ChatPage`와 동일한 구조 사용
- Portal overlay 제거, 자연스러운 flex 레이아웃 사용

### R4. 스크롤 통일
- 쉘 레벨에서 overflow 제거
- 각 페이지가 자체적으로 스크롤 관리
- ChatRoom의 단일 스크롤 구조 유지

## 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `components/client/ClientShell.tsx` | AppShell 패턴으로 재구현, SidebarNav 공유 |
| `components/layout/SidebarNav.tsx` | 회원용 메뉴 추가 (role 기반 분기) |
| `pages/client/ClientChatRoomPage.tsx` | Portal 제거, ChatPage 패턴으로 변경 |
| `pages/client/ClientChatListPage.tsx` | 좌측 패널로 통합 |
| `components/client/BottomTabBar.tsx` | 유지 (모바일) |

## QA

- [ ] 데스크탑: 좌측 사이드바 240px, bg-[#F5EDFC], 상담사와 동일 디자인
- [ ] 데스크탑: 콘텐츠 영역에 불필요한 overflow 없음
- [ ] 데스크탑: 채팅 화면 좌측 목록 + 우측 채팅창 side-by-side
- [ ] 모바일: 하단탭바 정상 동작
- [ ] 모바일: 채팅 입력창 화면 하단 고정
- [ ] 모바일: 메시지 리스트만 스크롤
- [ ] 모든 페이지: 스크롤 정상 동작
- [ ] 실시간 채팅 정상 동작
- [ ] 빌드 통과
