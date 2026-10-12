# [SDD-123] 회원용 클래스 화면 디자인 개선 — 요약

## 구현 결과
- `member-class-player.css` — 상담사 화면 토큰 이전: 캔버스 `#12081C`·서피스 `#1D1027`·라벤더 `#DCB5EE`·민트(연결·재생 점 전용), radius 12px 통일, 타이포 600→500. 기존 순검정 `#060507` 탈피.
- `MemberMetricDial.tsx`(신규) — 아크 링 다이얼(SVG `pathLength=100` + `rotate(-90)` 게이지). 호스트 `HostMetricDisplay`와 동일 기법.
- `GuestMeditationPanel.tsx` — 3×2 평면 숫자 카드 → **MIND(집중도·이완도·정서안정도)/BODY(BPM·호흡·HRV) 섹션 다이얼**. 선택 지표=히어로(84px)+직전 1초 증감, 나머지=서브(48px).
- `metric-bar-chart.tsx` — 노트 "25초 구간 평균" 문구 제거 → "최근 5분".

## 데이터 표현 보정 (Brian 확정)
| 항목 | 결과 |
|---|---|
| 숫자 6지표 | 매초 실시간(1Hz snapshot) — 기존 그대로 |
| 변화량 | **직전 1초 대비** (`deltaFor`) — 25초 스로틀 제거 |
| 데스크톱 | 지난 5분 막대그래프 전체 (`chartTick` 25초→1초) |
| 모바일 | 차트 숨김(`.player-chart{display:none}`) — 현재 상태만 |

## 데이터 무결성 (회귀 없음)
- `useBand`/WS 계약·`seriesRef`(MAX_POINTS=300)·`readSnapshot`·`scoreIndices` 무변경.
- HRV 필드 `sdnn`(회원) 유지 — 호스트 `rmssd`와 교체 금지 준수.
- LeadOff/시그널/채팅/BGM/화면끄기 로직 무변경.

## 검증
- `npx tsc --noEmit` 통과 · `npm run build` 통과(8.3s).
- 미해결: 시각적 QA는 dev 배포 후 확인 필요(Brian 선호).

## 남은 작업
- `design/member-class-player/index.html` 정본 갱신(구현과 병행, 별도).
- dev 배포 후 Brian 시각 승인.
