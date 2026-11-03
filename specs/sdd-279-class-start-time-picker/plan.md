# SDD-279 Plan — 시작 시각 C-3 (단일 필드 + 시·분 2열 팝오버)

- 근거: 대표 결정(11/3) C-3안, spec.md, design-v2/option-c3.html. 서버·draft 형식·API 계약 변경 없음(`draft.timeMin` 5분 단위 정수 분 그대로).
- 구현자 = 이 워커, 검증은 감독이 diff·시험으로 재검증한다.

## 현재 소스 사실 (직접 확인)
| 항목 | 값 | 근거 |
|---|---|---|
| 허용 범위 | 07:00(420) ~ 22:00(1320) | `class-wizard.ts:82-83` |
| 시 조작 | ±60분, 범위 clamp | `:302-303` stepTime |
| 분 조작 | 시 안에서 5분 순환, 결과 clamp (22시는 00분만 남음) | `:304-307` |
| 표기 | `fmtClock` "오후 3:15", `fmtHour`, `fmtMinute` | `:142-155` |
| 데스크톱 기준 | `useIsDesktop()` = `(min-width: 768px)` | `src/hooks/use-is-desktop.ts` |
| 현 화면 | `.fh-when3` 날짜 \| 시 \| 분 3열, 소요 시간은 아래 `DurationGroup`(스테퍼+칩) | `wizard-steps.tsx:231-269`, `host-flow-create.css:38-50` |

## 설계
1. **순수 모듈** `frontend/src/lib/class/start-time.ts` — `splitTime`/`joinTime`(timeMin ↔ {meridiem,hour12,minute}), `allowedHours(meridiem)`(허용 범위 내 시만: 오전 7~11, 오후 12·1~10), `minuteOptions(hour24)`(00~55, 22시는 00 외 비활성), `snapMinute`(5분 미만 단위 값은 가장 가까운 칸을 표시용으로만), `setMeridiem/setHour/setMinute`(clamp 포함 → 새 timeMin).
2. **reducer** `setTime` 액션 1개 추가(`class-wizard.ts`) — `clamp(timeMin, MIN, MAX)`만 한다. draft 필드·API 요청 빌더 불변. 기존 `stepTime/stepMinute` 는 시험 호환을 위해 유지.
3. **컴포넌트** `start-time-picker.tsx` — `StartTimePicker({ timeMin, onChange })`.
   - 데스크톱(≥768): 트리거 `button`(`aria-haspopup="dialog"`, `aria-expanded`) + 팝오버 `role="dialog"`(오전/오후 탭 `aria-pressed`, 시·분 `role="listbox"`/`role="option"` `aria-selected`).
   - 모바일(<768): 네이티브 `<select>` 2개(시 "오전 9시"…, 분 "00분"…).
   - 동작: 오전/오후·시 클릭은 즉시 반영하고 팝오버 유지, **분 클릭은 즉시 반영 후 닫고 트리거로 포커스 복귀**. Esc → 닫고 트리거 포커스. 바깥 pointerdown 닫힘. 열릴 때 선택 항목으로 스크롤+포커스. ↑↓ 항목, ←→ 시/분 열 이동, Enter/Space 선택, Tab 은 팝오버 안에서 순환.
   - 팝오버 폭 = 트리거 폭(100%), 왼쪽 정렬, 뷰포트 밖 보정(layout effect 에서 측정해 `marginLeft` 보정). 글자: 트리거 16px, 항목 18px, 탭 16px(≥ 트리거). 선택 탭=윤곽선(테두리 `--mb-pale` + 투명 채움), 선택 항목=보라 채움(`--mb-purple`)으로 구분. 목록 항목 높이 44px, 포커스 링.
4. **화면 배치** `wizard-steps.tsx` — 시간 예약일 때 첫 행 3열 `날짜(시작 날짜) | 시작 시각 · 5분 | 소요 시간 · 5분 단위`, 세 컨트롤 높이 88px 통일(낮은 화면 ≤760px 는 56px). 소요 시간 바로 선택 칩은 다음 행으로. 지금 바로 모드는 변경 없음(`DurationGroup`).
5. **CSS** `host-flow-create.css` — `fh-` 접두 신규 규칙. 기존 토큰 재사용(`player-tokens.css`).

## 파일 담당
| 구분 | 파일 |
|---|---|
| 신규 | `frontend/src/lib/class/start-time.ts`, `frontend/src/components/class/flow/host/start-time-picker.tsx`, `frontend/tests/sdd279/*.test.ts(x)`, `specs/sdd-279-*/{verify.md,summary.md,verify-results.json,shots-impl/*}`, `specs/sdd-279-*/measure-impl.cjs` |
| 수정 | `frontend/src/components/class/flow/host/wizard-steps.tsx`, `host-flow-create.css`, `frontend/src/lib/class/class-wizard.ts`(`setTime` 만), 기존 시험 문구 갱신(`class-flow-host-wizard-view.test.tsx`) |
| 불변 | backend 전체, `WizardDraft` 형식, `buildCreateRequest` 류 |

## Task
| # | 내용 | 시험 |
|---|---|---|
| T1 | verify.md (구현 전) | — |
| T2 | RED: start-time 순수 함수, reducer setTime, 컴포넌트(데스크톱/모바일/키보드/aria/클릭 수) | 실패 확인 |
| T3 | start-time.ts + setTime | GREEN |
| T4 | start-time-picker.tsx | GREEN |
| T5 | wizard-steps/CSS 연결, 기존 시험 문구 갱신 | 회귀 |
| T6 | 레이아웃 측정(Playwright, 1440·1280·1024·390) + PNG | verify-results.json |
| T7 | tsc -b · eslint · 관련 vitest · summary.md · 커밋 | — |

## 위험
- 팝오버가 `.fl-body`(overflow-y:auto) 안에서 잘릴 수 있음 → 측정으로 확인, 열릴 때 `scrollIntoView({block:'nearest'})`.
- 날짜 스테퍼 문구("내일 · 10월 18일 일")가 1/3 폭에서 넘칠 수 있음 → 말줄임 대신 글자 16px + 측정으로 확인.
- 하니스는 `/design/class-flow?screen=FH02c&case=later`(서버·BLE 불필요)를 사용한다.
