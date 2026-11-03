# SDD-281 Plan — /classes/new 시작 날짜 캘린더 (D-1)

- 근거: 대표 결정(11/3) D-1, spec.md, design-v2/. 서버·draft·API 계약 변경 없음(`schedule.recurrence_rule.start_date` = "YYYY-MM-DD").
- **실제 화면**: `/classes/new` → `class-scheduling-wizard.tsx` 2단계 → `WizardDateTime`(type='date', `wizard-visual-components.tsx`). `copySetup`(새 시작 날짜)도 같은 컴포넌트.
- SDD-279 오류 재발 방지: 컴포넌트 시험만으로 통과 선언 금지, `/classes/new` 2단계를 Playwright 로 직접 측정.

## 소스 사실
| 항목 | 값 | 근거 |
|---|---|---|
| min | `koreanToday()` | `class-scheduling-wizard.tsx` 283·303 호출부 |
| max | 호출부가 넘기지 않음(상한 없음). `max` prop 은 지원만 | 같은 호출부, `MAX_DAY_OFFSET` 은 별도 흐름 |
| 데스크톱 기준 | `useIsDesktop()` (≥768px) | `hooks/use-is-desktop.ts` |
| 기존 시트 | `WizardSheet`(`w-scrim/w-sheet`) 핸들·드래그·뒤로가기·inert 없음 | `wizard-visual-components.tsx` |

## 설계
1. `lib/class/start-date.ts` (순수): parse/format, 표시 "M/D(요일)", addDays/addMonths(말일 보정), monthGrid(5~6주), 범위 판정, 한글 셀 라벨.
2. `components/class/flow/host/start-date-picker.tsx`: 단일 트리거("11/3(화) ▾"). 데스크톱=포털 `position:fixed` 326px 팝오버(우측 정렬, 뷰포트 8px 보정), 모바일=Bottom Sheet(핸들 드래그·딤·스와이프·history pushState/popstate·inert·스크롤 잠금·safe-area·85dvh).
3. `WizardDateTime` date 분기를 StartDatePicker 로 교체(−/+ 제거). 시그니처 불변.
4. CSS: `class-scheduling.css` 에 `cw-date*` 추가, `!important` 없음.
5. 날짜 탭 즉시 적용·닫기, 닫기 6경로, 포커스 진입/복귀, 키보드(방향키·PageUp/Down·Home/End·Enter·Esc), aria.

## 파일 담당
신규: `lib/class/start-date.ts`, `start-date-picker.tsx`, `tests/sdd281/*`, `specs/.../{verify.md,summary.md,verify-impl.mjs,verify-impl.json,shots-impl/}`.
수정: `wizard-visual-components.tsx`, `class-scheduling.css`.

## 위험
- history.pushState 와 React Router 차단기(blocker) 충돌 → 실브라우저에서 뒤로가기 확인, 충돌 시 history 연동 제외.
- 6주 달 + 390×600 시트 잘림 → 85dvh 내부 스크롤 대신 간격 축소.
