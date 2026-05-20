# SDD-R01 — AppShell 반응형 전환

> 상위 기획: `.hermes/plans/2026-05-20_responsive-mobile.md`

## 현재 상태
- AppShell: `grid-cols-[240px_1fr]` 고정 — 모바일에서 사이드바가 콘텐츠를 50% 가림
- 모든 AppShell 사용 페이지(18개)가 모바일에서 깨짐
- ChatPage만 자체적으로 `showListMobile` 패턴 있음 (불완전, AppShell과 충돌)

## 구현 범위

### 1. AppShell 구조 변경 (`components/layout/AppShell.tsx`)

**데스크톱 (md:)** — 기존 레이아웃 유지
```jsx
<div className="min-h-screen grid grid-cols-[240px_1fr]">
  <aside>...</aside>
  <section>...</section>
</div>
```

**모바일 (<md:)** — 햄버거 + 하단탭바 + 오버레이 드로어
```jsx
<div className="min-h-screen flex flex-col">
  {/* 모바일 헤더 */}
  <header className="md:hidden h-14 flex items-center justify-between px-4 border-b border-[#EFEFEF] bg-white shrink-0">
    <button onClick={openDrawer}>☰</button>
    <Logo />
    <BellButton />
  </header>
  
  {/* 콘텐츠 */}
  <main className="flex-1 overflow-auto pb-16">{children}</main>
  
  {/* 하단 탭바 */}
  <BottomTabBar />
  
  {/* 드로어 오버레이 */}
  <DrawerOverlay open={drawerOpen} onClose={closeDrawer}>
    <DrawerContent> /* 사이드바와 동일한 메뉴 */ </DrawerContent>
  </DrawerOverlay>
</div>
```

### 2. 햄버거 드로어 컴포넌트 (`components/layout/MobileDrawer.tsx`)

**신규 파일**. Props: `open: boolean`, `onClose: () => void`

- 왼쪽에서 슬라이드 인: `translate-x-0` (open) / `-translate-x-full` (closed)
- 트랜지션: `transition-transform duration-300 ease-out`
- 오버레이: `bg-black/40 fixed inset-0 z-40` → 클릭 시 onClose
- 드로어 너비: `w-72 max-w-[80vw]` → 기존 사이드바와 동일한 메뉴 구조 렌더링
- ESC 키 닫힘: `useEffect` + `keydown` 리스너
- body 스크롤 잠금: open 시 `document.body.style.overflow = 'hidden'`

### 3. 하단 탭바 컴포넌트 (`components/layout/BottomTabBar.tsx`)

**신규 파일**.

```jsx
<div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-[#EFEFEF] 
                h-14 pb-[env(safe-area-inset-bottom)] flex items-center justify-around">
  {TAB_ITEMS.map(item => (
    <NavLink to={item.to} 
      className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-[11px]">
      <Icon />
      <span>{item.label}</span>
    </NavLink>
  ))}
</div>
```

탭 항목 (5개):
| 탭 | 아이콘 | 라우트 |
|---|---|---|
| 홈 | home | `/dashboard` |
| 세션 | calendar | `/sessions` |
| 채팅 | message | `/chat` |
| 리포트 | report | `/reports` |
| 더보기 | menu (3 dots) | drawer open |

활성 탭: `text-[#5F0080]` + 상단 `w-1 h-0.5 rounded-full bg-[#5F0080]` 인디케이터

### 4. 기존 사이드바 → MobileDrawer에 재사용 가능하게 리팩토링

현재 `AppShell.tsx` 안에 인라인된 사이드바 JSX를 `SidebarNav` 컴포넌트로 추출:
- `NAV_ITEMS` + `ADMIN_NAV_ITEMS` + 사용자 카드
- `AppShell`의 데스크톱 aside와 `MobileDrawer`가 같은 컴포넌트를 공유

### 5. 기존 헤더 → 모바일에서 조건부 표시

- 데스크톱 헤더(`md:flex`): 그대로 유지
- `md:hidden` 속성 추가하여 모바일에서는 숨김

## 주의
- 기존 AppShellProps 인터페이스 변경 금지 (title, sub, rightSlot 등 유지)
- 모바일에서는 기존 Header 대신 새 모바일 헤더 사용 (title/sub은 모바일 헤더에 표시)
- `pb-16`으로 하단 탭바 높이(56px)만큼 패딩 → `pb-[calc(4rem+env(safe-area-inset-bottom))]`
- role에 따라 탭바 항목 분기 없음 (모든 역할 동일 4탭)
- `cd frontend && npm run build` 검증
