# 012 — 모바일 타임테이블 (일간/주간)

## 목표
모바일에서 MonthCalendar 아래에 [일간] [주간] 탭을 추가하고, 선택된 뷰에 맞는 타임테이블을 표시한다.

## 현재 상태
- 모바일: MonthCalendar + DaySchedule(단순 리스트)
- 데스크톱: [일간][주간][월간][목록] 4탭 → CalendarView 일간/주간, MonthCalendar, 리스트

## 변경 사항

### 1. SessionListPage.tsx — 모바일 탭 + 타임테이블
- 모바일 영역에 [일간] [주간] 2개 탭 추가 (데스크톱과 동일한 pill 스타일)
- 탭에 따라 DailyTimetable 또는 WeeklyTimetable 렌더링
- MonthCalendar는 탭 위에 항상 표시 (월 단위 이동 유지)
- ‹ › 네비게이션 버튼: 일간은 shiftDay, 주간은 shiftWeek

### 2. MobileTimetable.tsx 신규
- **DailyTimetable** (mode="daily"): 세로 시간 그리드
  - 시간 레이블 (08~20시, 12칸)
  - 각 시간대에 세션 바 (유형색 배경, 제목 truncate, 상태 표시)
  - 클릭 시 세션 상세 이동
  - 전체 높이 화면에 맞게, 스크롤 없이
- **WeeklyTimetable** (mode="weekly"): 가로 7열 컴팩트 그리드
  - 상단 요일 헤더 (일~토, 오늘 보라색)
  - 시간 레이블 좌측 (08~20시)
  - 세션 있는 셀만 컬러 점으로 표시 (모바일 공간 제약)
  - 가로 스크롤 가능 (overflow-x-auto)
  - 각 셀 최소 32px 높이

### 3. 디자인
- UI Kit: 보라색(#5F0080)
- DailyTimetable 시간 레이블: font-mono text-[11px] text-[#6F6F6F]
- 세션 바: rounded-lg, 유형별 배경색, text-[11px] truncate
- WeeklyTimetable 헤더: 오늘 날짜 bg-[#5F0080] text-white rounded-full
- 탭: 데스크톱과 동일 pill 스타일

## 절대 금지
- 기존 DaySchedule.tsx 삭제 금지 (데스크톱 월간뷰에서 사용 가능)
- CalendarView.tsx 수정 금지 (데스크톱 전용 유지, hidden md:block)
- sessionStore 변경 금지
- any 타입 금지
- API 호출 로직 변경 금지

## 완료 후
```
cd frontend && npm run build
```
성공 시 "DONE" 출력.
