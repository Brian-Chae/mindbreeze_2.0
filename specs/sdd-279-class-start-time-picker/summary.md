# SDD-279 Summary — 시작 시각 C-3 (단일 필드 + 시·분 2열 팝오버)

웹만 변경(앱 빌드 불필요·심사 영향 없음). 서버·draft 형식·API 계약 불변(`draft.timeMin` 5분 단위 정수 분 그대로).

## 만든 것
| 파일 | 내용 |
|---|---|
| `frontend/src/lib/class/start-time.ts` (신규) | timeMin ↔ {오전/오후, 12시간제 시, 분} 변환, 허용 시·분 목록, 표시용 5분 snap — 순수 함수 |
| `frontend/src/components/class/flow/host/start-time-picker.tsx` (신규) | 데스크톱(≥768px, 기존 `useIsDesktop` 기준) 팝오버 / 모바일 네이티브 select 2개 |
| `frontend/src/components/class/flow/host/wizard-steps.tsx` | 시간 예약 첫 행을 `시작 날짜 \| 시작 시각 · 5분 \| 소요 시간 · 5분 단위` 3열로 교체. 소요 시간 바로 선택 칩은 다음 행. "지금 바로"는 불변 |
| `frontend/src/components/class/flow/host/host-flow-create.css` | `fh-` 접두 규칙(3열 동일 폭, 컨트롤 높이 변수 `--fh-ctl`) |
| `frontend/src/lib/class/class-wizard.ts` | reducer `setTime` 1개 추가(clamp만). 기존 `stepTime/stepMinute` 유지 |
| `frontend/tests/sdd279/*` (신규 3파일) | 순수 함수·reducer·컴포넌트·위저드 통합 시험 |
| `frontend/tests/class-flow-host-wizard-view.test.tsx` | 시간 예약 케이스 기대문구 갱신(시/분 스테퍼 → 새 라벨·select) |

## 허용 범위·5분 단위 유지 (소스 기준 그대로)
- 오전 7:00(420) ~ 오후 10:00(1320). 시 목록 오전 7~11, 오후 12·1~10. 분 00~55(5분). 오후 10시는 00분만 활성, 그 외 클릭은 무시(값·팝오버 유지).
- 오전/오후 전환은 범위 밖이면 경계로 보정(오후 7:00→오전 = 오전 7:00).
- 5분 단위가 아닌 값(복원·서버)은 draft 를 바꾸지 않는다. 트리거는 원값(`오전 9:17`) 그대로, 팝오버·select 의 분은 가장 가까운 칸(15)만 선택 표시 — 시험 고정.

## 동작 결정과 이유
- 오전/오후·시 선택은 팝오버 유지, **분 선택은 반영 후 닫고 트리거로 포커스 복귀**. 이유: 대표 시나리오(오후 7:00→오전 9:00)가 3클릭으로 끝나고(분 00 유지), 시간은 보통 시→분 순으로 정해 분이 마지막 단계라 닫는 지점으로 자연스럽다. 분만 먼저 바꾸고 시를 고치는 경우는 다시 열어야 하는 비용이 있음(시안 README 에 기재된 위험과 동일).
- 접근성: 트리거 `aria-haspopup="dialog"`/`aria-expanded`, 팝오버 `role=dialog`, 목록 `role=listbox`·옵션 `aria-selected`, ↑↓ 항목·←→ 열 이동, Esc 닫기+포커스 복귀, Tab 팝오버 내 순환, 바깥 pointerdown 닫힘, 터치 타깃 44px.

## 시험 결과 (실제 출력)
| 항목 | 결과 |
|---|---|
| RED | 신규 2파일이 `Cannot find module start-time` 로 실패 확인 후 구현 |
| GREEN | `tests/sdd279` 4파일 **23/23**(순수 9 + 컴포넌트 10 + 통합 4) + `class-flow-host-wizard-view` 포함 52/52 |
| 관련 회귀 | `sdd279 + class-flow-host* + class-create-action + class-flow-harness + class-flow-case-key` 17파일 **248/248** |
| `tsc -b` | 오류 0 |
| eslint (host 폴더·lib/class·tests/sdd279·수정 시험) | 오류 0 |
| 프런트 전체 `vitest run` | 4008 통과 / **23 실패(13파일)** — 변경 전 커밋(3e3572fe)을 임시 워크트리로 같은 13파일만 돌려 **동일 23건 실패**(신규 실패 0). 내용은 nav 라벨·org 모달·PDF·native-release·font-scale 등 이번 변경과 무관한 영역 |

## 레이아웃 실측 (`verify-results.json`, `measure-impl.cjs` — Chrome headless, vite dev 하니스 `/design/class-flow?screen=FH02c&case=later`)
| 뷰포트 | 세 열 폭 | 라벨 y 차 | 컨트롤 높이 | 팝오버/트리거 폭 | 뷰포트 이탈 | 가로 넘침 | 44px 미만 타깃 | 잘림 | 판정 |
|---|---|---|---|---|---|---|---|---|---|
| 1440 | 186/186/186 | 0 | 88/88/88 | 186/186 = 1.00 | 없음 | 0 | 0 | 0 | 통과 |
| 1280 | 186/186/186 | 0 | 88/88/88 | 1.00 | 없음 | 0 | 0 | 0 | 통과 |
| 1024 | 186/186/186 | 0 | 88/88/88 | 1.00 | 없음 | 0 | 0 | 0 | 통과 |
| 390 | 324/324/324(세로 쌓임) | N/A | 56/56/56 | select 모드 | — | 0 | 0 | 0 | 통과 |

- 글자: 트리거 15px, 팝오버 항목 18px·탭 15px (≥ 트리거). 선택 탭=윤곽선(`#D2AEFC` 테두리+옅은 채움), 선택 항목=보라 채움(`#5F0080`) — computed style 가 서로 다름.
- 팝오버 좌우 끝이 트리거와 같은 x(627~813)임을 DOM 좌표와 **PNG 픽셀 스캔(테두리 열 x=627, 812)** 으로 확인. 비전 모델이 같은 PNG 에 "팝오버가 더 넓다"고 답했으나 좌표·픽셀과 어긋나 신뢰하지 않음(모델 오판 가능성 기록).
- 시안 v2 에서 지적된 날짜 필드 글자 잘림: 폭 186px 에서 "내일 · 10월 18일 일"이 한 줄에 안 들어가 **두 줄로 줄바꿈**(잘림 0)시킴. 한 줄 말줄임보다 정보 보존을 택함 → 대표 취향 확인 필요 시 `fh-when3 .fh-stepper b` 한 곳만 조정.
- PNG: `shots-impl/open-1440.png`(팝오버 열림), `closed-1440.png`(닫힘), `390.png`(모바일), `closed-1280/1024/390.png`.

## 확인 못 한 것
- 실기기(iOS/Android WebView) 네이티브 select 동작, 화면낭독기 실제 발화, 실제 dev 배포본 화면. 자동화는 jsdom + Chrome headless 한정.
- 카드 폭이 640px 로 고정된 하니스 기준 측정. 실제 앱 셸의 다른 카드 폭에서도 3열 동일 폭은 CSS grid(`repeat(3, minmax(0,1fr))`)로 보장되나 별도 실측은 안 함.

## 리뷰어 참고
- 모바일 판정은 기존 `useIsDesktop()`(768px)을 재사용. 시험 하니스의 `matchMedia` 목이 항상 false 라 기존 위저드 뷰 시험은 모바일(select) 경로로 돈다.
- 시험 실행 중 `specs/sdd-234-*/screens/*.png` 두 장이 부산물로 바뀌어 `git checkout` 으로 되돌렸다(커밋 제외).
- 푸시·PR·배포는 하지 않았다(감독 재검증 후 진행).

## 보정(실제 화면 연결)

- **원인**: PR #240 이 `/counseling/new`(`CreateWizardContainer`, `host/wizard-steps.tsx`)만 고쳤다. 대표가 보는 실제 화면은 `/classes/new`(`pages/classes/class-scheduling-wizard.tsx` 2단계)이고, 시작 시각은 `WizardDateTime type="time"` 의 −/+(±5분) 스테퍼였다. 컴포넌트 단위 시험만 통과시키고 라우트 기준 확인을 빠뜨렸다.
- **해결**: `WizardDateTime` 의 time 분기를 `StartTimePicker`(데스크톱 ≥768px 팝오버 / 모바일 시·분 select)로 교체. 날짜 분기는 그대로. 값은 "HH:MM" 문자열 유지(`parseClock`/`formatClock` 추가), 호출부 `min`/`max`(07:00/22:00)를 `minMin`/`maxMin` props 로 연결(`allowedHours`/`minuteOptions`/`setX` 에 `TimeBounds` 인자, 기본값은 기존과 동일). 범위 밖·5분 단위 아닌 값은 draft 를 바꾸지 않고 표시만.
- **스타일**: `host-flow-create.css` 는 `/classes/new` 에서 로드되지 않으므로 `fh-time*` 규칙을 `class-scheduling.css` 에 `.cs-wizard` 하위로 복제(`.cw-timepick`, 컨트롤 높이 56px = 옆 칸과 동일).
- **검증(실제 `/classes/new` 2단계)**: `verify-fix.mjs`/`verify-fix.json`, 캡처 `shots-fix/`. 시험 `tests/sdd279/classes-new-time.test.tsx`.
- **교훈**: 검증은 컴포넌트가 아니라 **사용자가 보는 라우트**에서 한다. 고치기 전에 대표가 보는 URL → 파일을 먼저 확정한다.
