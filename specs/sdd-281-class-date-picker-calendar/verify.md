# SDD-281 Verify (구현 전 체크리스트)

| # | 시나리오 | 방법 |
|---|---|---|
| V1 | 월 격자: 7열·5~6주, 윤년 2028-02 29일, 월말 이동(1/31→2월) | vitest 유틸 |
| V2 | 범위: min 이전 비활성, max 이후 비활성, min 월의 이전 달 이동 불가 | vitest |
| V3 | 표시 "11/3(화)", 값 "YYYY-MM-DD" 불변 | vitest |
| V4 | 날짜 탭 → onChange("YYYY-MM-DD") 후 닫힘, 지난 날짜 클릭 무시 | vitest 컴포넌트 |
| V5 | 월 이동 ‹ ›, 범위 밖 이전 달 차단 | vitest |
| V6 | ESC·배경 클릭·닫기 버튼·(모바일)뒤로가기 닫힘, 값 유지 | vitest + Playwright |
| V7 | 키보드 방향키·PageUp/Down·Enter | vitest |
| V8 | aria: dialog aria-modal, 제목 연결, 셀 라벨 "2026년 11월 3일 화요일, 오늘", 선택 불가 | vitest |
| V9 | 데스크톱/모바일 분기(팝오버 vs 시트) | vitest |
| V10 | WizardDateTime date: −/+ 없음, 단일 필드 | vitest |
| V11 | 기존 class-scheduling·wizard·sdd279·sdd280·stepper 회귀, tsc -b, eslint, 전체 vitest 신규 실패 0(기준선 23건/13파일) | 명령 |
| V12 | /classes/new 2단계 실측 6 viewport: 단일 필드, 세 칸 정렬, 뷰포트 안·잘림 0·가로넘침 0, 셀 ≥44px, 오늘→3주 뒤 2탭, preview-schedule start_date 반영, 6주 달, 닫기 6종, 시트 하단 붙음 | Playwright |
| V13 | copySetup 화면 동작·레이아웃 | Playwright |
| V14 | PNG 직접 확인(−/+ 잔존 시 실패) | 이미지 열람 |
