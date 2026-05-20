# SDD-R06 — 채팅 + 기록지 모바일 대응

> 상위 기획: `.hermes/plans/2026-05-20_responsive-mobile.md`
> 선행 조건: R01 (AppShell 반응형) 완료 후

## 대상 페이지 (2개)

| 페이지 | 파일 | 현재 상태 |
|---|---|---|
| ChatPage | `pages/chat/ChatPage.tsx` | 자체 `showListMobile` 패턴 있음 (불완전) |
| SessionRecordPage | `pages/records/SessionRecordPage.tsx` | AppShell 없음, 자체 레이아웃 |

## 작업 내용

### 1. ChatPage

현재 자체 모바일 대응:
- `showListMobile` 상태로 채팅방 목록 ↔ 채팅방 전환
- `hidden md:block` / `hidden md:flex` 패턴
- **[문제]**: AppShell 사이드바 + 자체 모바일 전환 → 이중 구조

**R01 AppShell 반응형 적용 후 변경**:
- AppShell이 모바일에서 사이드바를 드로어로 전환해주므로 ChatPage의 자체 모바일 전환 로직 간소화 가능
- 기존 `showListMobile` → 불필요해짐 (AppShell 탭바로 네비게이션)
- 채팅방 목록과 채팅방은 데스크톱에서 2분할, 모바일에서는 각각 별도 페이지로 분리 or 탭바/뒤로가기로 전환

**간단한 접근** (기존 코드 최소 변경):
- 데스크톱: `grid md:grid-cols-[320px_1fr]` 유지
- 모바일: 목록 페이지(`/chat`) → 채팅방(`/chat/:sessionId`)을 별도 네비게이션으로 분리
- 채팅방 헤더에 뒤로가기 버튼 추가 (모바일 전용, `md:hidden`)
- 메시지 입력창: `fixed bottom-0` → 하단 탭바 위로 배치 (`bottom-14`)

### 2. SessionRecordPage

현재 자체 레이아웃 → AppShell 없음.
- 모바일: `px-4 py-4` 패딩
- 기록지 섹션: `w-full max-w-2xl mx-auto` 중앙 정렬
- AI 요약/STT 텍스트: `text-sm` 모바일, `text-base` 데스크톱

## 주의
- ChatPage 모바일 채팅방에서 키보드 올라올 때 `visualViewport` 대응
- 뒤로가기 버튼: `useNavigate(-1)` 사용
- `cd frontend && npm run build` 검증
