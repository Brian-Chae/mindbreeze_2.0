# SDD-029 — Plan (P0)

## 태스크 분해

### FE (Cursor — 디자인 패리티 핵심)
- T1. `FadingImageBackground` 컴포넌트 — CSS transition 교차 페이드(20s/1s), webp 10장 cover
- T2. `BlinkingText` 컴포넌트 — CSS keyframes 깜빡임
- T3. `BrainChart` 컴포넌트 — 회색 둥근 막대 바차트(bar 14/gap 12/threshold 40)
- T4. `GuestMeditationPanel` 재디자인 — 검정 풀블리드 + FadingImageBackground + clamp 130px 두뇌휴식도 + BlinkingText + BrainChart + Timer
- T5. `SessionLivePage` 재디자인 — 흰 배경 + 세션코드 배너 + DashboardBox 4종(수평 카드) + 평평한 8컬럼 테이블
- T6. 버튼 색 — 시작 진보라/종료 연보라, 배터리 `<=25` 통일

### BE (Claude — 리포트 메일)
- T7. 게스트 리포트 메일 발송 — 완료 시 이메일 수집 → 리포트 메일(2.0 email.py 재사용)

### 통합 (Codex — 검증)
- T8. 디자인 정합 + 반응형 검증

## 검증
- FE: `npm run build` (tsc 0 error)
- BE: `./venv/bin/python -m pytest -q`
- 디자인: 명상 화면(검정+자연이미지+130px), 호스트(흰+테이블), 반응형 오버플로 없음

## 리스크
- webp 로딩(10장) — 명상 진입 시 프리로드
- 130px clamp 모바일 오버플로 — clamp 하한 64px 검증
