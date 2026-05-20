# SDD-02b — 세션 페이지 UI Kit 디자인 이식

## 미션
상담사 세션 페이지 3개를 UI Kit Operator App 디자인(보라색 #5F0080)으로 재작성하고 AppShell 레이아웃을 적용한다.

## 대상 파일
1. `frontend/src/pages/sessions/SessionListPage.tsx` — 세션 목록 (목록+캘린더 뷰)
2. `frontend/src/pages/sessions/SessionCreatePage.tsx` — 세션 생성 폼
3. `frontend/src/pages/sessions/SessionLivePage.tsx` — 실시간 세션 진행 (있다면)

## 디자인 시스템 (UI Kit 보라색)
- 보라색: #5F0080 → `bg-purple-900`, `text-purple-900`
- 라벤더 배경: #F5EDFC → `bg-purple-50`
- 크림 배경: #EBE6E2 → `bg-[#EBE6E2]`
- 텍스트: #1F1F1F → `text-gray-800`, #6F6F6F → `text-gray-600`
- 카드: 흰색 배경, 20px radius, 1px #EFEFEF border
- 버튼: `mb-btn` 클래스 (mb-tokens.css 정의)
- 인풋: rounded-xl, border, focus:ring-purple-900/15

## 작업 1: SessionListPage.tsx
**레이아웃**: AppShell로 감싸기 (title="세션 관리")

**헤더 액션(rightSlot)**: "+ 새 세션" mb-btn 버튼 (생성 모달 열기)

**뷰 토글**: 
- "목록" / "주간" 탭 — UI Kit 스타일 (보라색 active, 둥근 pill)
- 주간 뷰일 때 날짜 네비게이션 포함

**목록 뷰**: 
- UI Kit 카드 스타일 (흰색, radius-20, border #EFEFEF, padding-6)
- SessionCard 컴포넌트는 그대로 사용하되, 내부 스타일만 UI Kit에 맞게 수정
- 그리드: 2컬럼 (grid-cols-2, gap-5)

**주간 뷰**:
- CalendarView 컴포넌트를 UI Kit 디자인으로 수정
- 7컬럼 그리드, 일요일 시작, 오늘 강조(보라색 배경), 세션 있는 날 dot 표시

**생성 모달**: 
- UI Kit Modal 스타일 (radius-20, 흰색 배경, backdrop blur)
- 입력창: rounded-xl, border-[#DDDEE7], focus:ring-purple-900/15
- 레이블: text-gray-800, font-medium
- 생성 버튼: mb-btn (보라색)
- 취소 버튼: mb-btn--ghost

## 작업 2: SessionCreatePage.tsx (별도 페이지)
**레이아웃**: AppShell로 감싸기 (title="새 세션")

**폼**: 
- 최대 너비 640px 중앙 정렬
- UI Kit 카드 안에 폼 배치
- 세션 유형: select 커스텀 스타일 (3개 옵션)
- 일시: datetime-local input
- 소요시간/최대참여자: 2컬럼
- 제목: text input
- 메모: textarea
- 버튼: mb-btn 생성, mb-btn--ghost 취소

## 작업 3: SessionLivePage.tsx (존재하는 경우)
UI Kit SessionRunning.jsx 디자인을 참고하여 재작성:
- AppShell로 감싸기
- 상단: session title, subtitle, status pill, BLE 연결 표시
- 좌측: 참여자 좌석 그리드 (SeatTile — 측정중/연결됨/대기/빈자리)
- 우측: 실시간 패널 (점수, 미니차트, 뇌파 지표)
- 하단: 현재 단계 진행바 + "다음 단계" 버튼

## 주의사항
- 모든 기능(API 호출, 상태 관리, 라우팅)은 그대로 유지
- `text-gray-*`, `bg-indigo-*`, `dark:` 클래스 등 기존 Tailwind 기본 클래스는 모두 제거하고 mb-tokens/UI Kit 스타일로 교체
- AppShell을 import해서 사용 (`import AppShell from '../../components/layout/AppShell'`)
- SessionCard, CalendarView 등 하위 컴포넌트도 가능하면 UI Kit 디자인으로 수정
- 빌드 검증 필수
