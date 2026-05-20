# SDD-02c — 내담자·채팅·온보딩 페이지 UI Kit 이식

## 대상
1. `frontend/src/pages/clients/ClientListPage.tsx` — AppShell + UI Kit Clients.jsx 스타일 (아바타 링, 상태 바, 날짜 칩)
2. `frontend/src/pages/chat/ChatPage.tsx` — AppShell + UI Kit Messages.jsx 스타일 (대화 목록, 말풍선)
3. `frontend/src/pages/onboarding/CounselorOnboardingPage.tsx` — UI Kit 보라색 스타일 (mb-btn, 카드, 입력창)

## 공통 규칙
- AppShell import: `import AppShell from '../../components/layout/AppShell'`
- 모든 `text-gray-*`, `bg-indigo-*`, `dark:` 클래스 제거
- 보라색: `bg-purple-900`(#5F0080), `bg-purple-50`(#F5EDFC), `text-purple-900`
- 텍스트: `text-gray-800`(#1F1F1F), `text-gray-600`(#6F6F6F)
- 입력창: rounded-xl, border-[#DDDEE7], focus:ring-purple-900/15
- 버튼: `className="mb-btn"`, `className="mb-btn mb-btn--ghost"`
- 카드: bg-white, rounded-[20px], border border-[#EFEFEF], p-6
- 기능(API·상태·라우팅)은 그대로 유지

## 1. ClientListPage
- AppShell로 감싸기 (title="내담자")
- 검색창: UI Kit rounded-full 스타일
- 내담자 목록: 각 행은 흰색 카드, 아바타+이름+상태+다음 세션 날짜
- 페이지네이션 하단

## 2. ChatPage  
- AppShell로 감싸기 (title="채팅")
- 좌측: 대화 목록 패널 (UI Kit ConvoListItem 스타일)
- 우측: 채팅 영역 (ChatRoom 컴포넌트, Bubble 스타일 보라색으로)
- 모바일: 목록/채팅 토글

## 3. CounselorOnboardingPage
- AppShell 없이 전체 화면 중앙 정렬 (기존 구조 유지)
- StepIndicator: 보라색 active, 회색 inactive
- 카드 스타일: bg-white, rounded-[20px], shadow
- 입력창: rounded-xl, border-[#DDDEE7]
- 체크박스/라디오: accent-purple-900
- 버튼: mb-btn / mb-btn--ghost

## 빌드 검증
`cd frontend && npm run build` 통과 필수
