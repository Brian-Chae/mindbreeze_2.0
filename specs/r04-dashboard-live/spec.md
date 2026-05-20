# SDD-R04 — 대시보드 + 라이브 세션 모바일 대응

> 상위 기획: `.hermes/plans/2026-05-20_responsive-mobile.md`
> 선행 조건: R01 (AppShell 반응형) 완료 후

## 대상 페이지 (2개)

| 페이지 | 파일 | 주요 문제 |
|---|---|---|
| DashboardPage | `pages/DashboardPage.tsx` | 대시보드 위젯 그리드 |
| SessionLivePage | `pages/sessions/SessionLivePage.tsx` | 실시간 EEG 대시보드 (추후 F9용) |

## 작업 내용

### 1. DashboardPage
- 기존 그리드 확인 → `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` 패턴 적용
- 통계 카드(KPI): 모바일에서 `grid-cols-2` 또는 세로 스택
- 차트/그래프 영역: `w-full` + `min-h-[200px]`
- 환영 메시지: 폰트 크기 `text-2xl md:text-3xl`

### 2. SessionLivePage
- 실시간 차트: `w-full` + 반응형 높이
- 컨트롤 패널: 모바일에서 하단 고정 또는 세로 스택
- EEG 지표 게이지: `grid-cols-3` → 모바일 `grid-cols-3` 유지 (작은 게이지)

## 주의
- DashboardPage는 현재 빈/플레이스홀더 상태일 가능성 높음 → 최소한의 그리드 구조만 적용
- SessionLivePage는 F9(LINK BAND EEG) 구현 전이므로 기본 반응형 구조만 잡기
- 데이터 연동 로직 절대 변경 금지
- `cd frontend && npm run build` 검증
