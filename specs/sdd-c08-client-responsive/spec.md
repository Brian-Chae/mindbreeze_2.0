# SDD-C08: 내담자 앱 반응형 전환

> **상태:** spec 작성 완료 → plan 작성 → Worker 구현
> **생성:** 2026-05-26
> **목표:** 내담자용 앱 서비스 페이지들을 모바일 + 데스크탑 반응형으로 전환

---

## 1. 목표

현재 내담자 앱(`/app/*`)의 모든 페이지는 **모바일 전용**으로 디자인되어 있다. 상담사 앱 페이지들처럼 **데스크탑과 모바일 모두 대응하는 반응형**으로 전환한다.

## 2. 현황

### 2.1 현재 상태

| 페이지 | 파일 | 반응형 상태 |
|---|---|---|
| ClientAppPage | `pages/client/ClientAppPage.tsx` | ❌ 모바일 전용 (라우팅 래퍼) |
| ClientHomePage | `pages/client/ClientHomePage.tsx` | ❌ 모바일 전용 |
| ClientChatListPage | `pages/client/ClientChatListPage.tsx` | ❌ 모바일 전용 |
| ClientChatRoomPage | `pages/client/ClientChatRoomPage.tsx` | ❌ 모바일 전용 (`max-w-lg`) |
| ClientSessionListPage | `pages/client/ClientSessionListPage.tsx` | ❌ 99% 모바일 전용 |
| ClientSessionDetailPage | `pages/client/ClientSessionDetailPage.tsx` | ❌ 모바일 전용 |
| ClientReportListPage | `pages/client/ClientReportListPage.tsx` | ❌ 모바일 전용 (`grid-cols-1`) |
| ClientProfilePage | `pages/client/ClientProfilePage.tsx` | ❌ 모바일 전용 |
| ClientReportDetailPage | `pages/client/ClientReportDetailPage.tsx` | ✅ 일부 반응형 (`md:grid-cols-2` 등) |

### 2.2 ClientShell vs AppShell

- **ClientShell** (`components/client/ClientShell.tsx`): 모바일 전용 — `pt-14 pb-14`, `BottomTabBar`, 데스크탑 레이아웃 없음
- **AppShell** (`components/layout/AppShell.tsx`): 완전 반응형 — `md:grid md:grid-cols-[240px_1fr]`, 데스크탑 사이드바, 모바일 햄버거 메뉴, BottomTabBar

## 3. 범위

### 3.1 포함 (In-scope)

1. **ClientShell → 반응형 업그레이드** (`components/client/ClientShell.tsx`)
   - 데스크탑: 좌측 네비게이션 (240px) + 중앙 콘텐츠 영역 + 우측 여백
   - 모바일: 기존 BottomTabBar 유지
   - `max-w-5xl mx-auto` 중앙 정렬

2. **7개 페이지 반응형 전환** (ClientReportDetailPage 제외)
   - 모든 페이지에 `md:` 브레이크포인트 추가
   - 데스크탑에서 콘텐츠 최대 너비 제한 해제
   - 그리드 레이아웃: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` 등

3. **ClientChatRoomPage** → 데스크탑에서 상담사 ChatPage처럼 좌측 목록 + 우측 채팅 split-pane

### 3.2 제외 (Out-of-scope)

- ClientReportDetailPage (이미 반응형)
- 상담사 페이지들 (이미 반응형)
- 새로운 기능 추가
- 디자인 시스템 변경 (기존 컬러/폰트 유지)

## 4. 디자인 원칙

- **참고 패턴:** 상담사 `SessionListPage.tsx`의 `MobileSection`/데스크탑 분리 패턴
- **데스크탑 레이아웃:**
  - ClientShell: `md:grid md:grid-cols-[200px_1fr] max-w-6xl mx-auto`
  - 카드 그리드: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`
  - 채팅: 좌측 채팅방 목록 (320px) + 우측 채팅 영역
- **모바일 레이아웃:** 기존과 동일하게 유지
- **중단점:** `md:` (768px+), `lg:` (1024px+)

## 5. QA 체크리스트

- [ ] 데스크탑(1920px)에서 모든 페이지가 중앙 정렬되고 좌우 여백 있음
- [ ] 모바일(375px)에서 기존과 동일하게 작동
- [ ] 태블릿(768px)에서 레이아웃이 자연스럽게 전환
- [ ] ClientChatRoomPage 데스크탑에서 좌측 목록 + 우측 채팅
- [ ] 모든 페이지에서 가로 스크롤 없음
- [ ] BottomTabBar는 모바일에서만 표시
- [ ] 데스크탑에서 좌측 네비게이션 또는 상단 네비게이션 표시
- [ ] `npm run build` 통과
