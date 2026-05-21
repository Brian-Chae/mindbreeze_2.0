# SDD-R07 — 세션 캘린더 반응형 (모바일 월간 + 데스크톱 일간/주간/월간)

## 현재 상태
- `CalendarView`: `min-w-[800px]` 주간 시간그리드만 — 모바일 가로스크롤 강제
- `SessionListPage`: '목록' / '주간' 토글만. '일간'·'월간' 없음
- `sessionStore`: `CalendarViewMode = 'daily' | 'weekly' | 'monthly' | 'list'` — 타입은 있으나 UI 미구현

## 구현 범위

### 1. MonthCalendar 컴포넌트 (`components/session/MonthCalendar.tsx`) — 신규

한 달 달력 그리드:
- 7열 (일월화수목금토), 5~6행
- 각 날짜 셀: 날짜 숫자 + 세션 있으면 작은 컬러 점(●) 표시
- 오늘: 보라색 원형 하이라이트
- 선택된 날짜: 보라색 테두리
- 이전/다음 월 이동 버튼 (‹ ›)
- Props: `sessions`, `currentDate`, `selectedDate`, `onSelectDate`

**모바일**: 셀 height 작게 (40px), 점만 표시
**데스크톱**: 셀 height 여유 있게 (80px), 점 + 최대 2개 세션 제목 축약 표시

### 2. DaySchedule 컴포넌트 (`components/session/DaySchedule.tsx`) — 신규

선택된 날짜의 세션 목록 (모바일 최적화):
- 헤더: "5월 21일 (수)" 포맷
- 각 세션: 시간 + 유형뱃지 + 제목 + 상태뱃지 → 클릭 시 상세 이동
- 시간순 정렬
- 세션 없으면 "등록된 세션이 없습니다"
- `overflow-auto max-h-[calc(100vh-400px)]` 제한

### 3. WeekCalendar → 기존 CalendarView 리팩토링

- `min-w-[800px]` 유지하되 `hidden md:block`으로 모바일에서 숨김
- 데스크톱에서만 보이도록

### 4. SessionListPage 업데이트

#### 데스크톱 (md:)
```
[일간] [주간] [월간] [목록]   ← 4개 탭
────────────────────────────────
  해당 뷰 렌더링 (day/week/month/list)
```

#### 모바일 (< md:)
```
       2026년 5월       ← 월 네비게이션
  일 월 화 수 목 금 토   ← MonthCalendar (7열)
   4  5  6  7  8  9 10
  11 12 13 14 15 16 17
  ...
────────────────────────────────
  [5월 21일 (수)]       ← DaySchedule
  ┌──────────────────┐
  │ 14:00 임상상담    │
  │ 16:00 명상수업    │
  └──────────────────┘
```

#### 네비게이션 버튼
- 현재 주/월 표시 + ‹ › 화살표
- 모바일: MonthCalendar 상단에 월 이동
- 데스크톱: 각 뷰에 맞는 이동 (일간: 일 이동, 주간: 주 이동, 월간: 월 이동)

### 5. sessionStore

이미 `daily`/`weekly`/`monthly`/`list` 지원 → 변경 불필요. `setViewMode` 활용.

## 주의
- 기존 SessionListPage 로직(CRUD, 생성 모달) 유지
- sessionStore 인터페이스 변경 금지
- any 타입 금지
- 모바일에서 MonthCalendar는 `max-w-full overflow-x-auto` 불필요 — 7열은 320px 폰에서도 충분히 보임
- `cd frontend && npm run build` 검증
