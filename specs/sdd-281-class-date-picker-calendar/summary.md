# SDD-281 Summary — /classes/new 시작 날짜 캘린더 (D-1)

## 구현
| 파일 | 내용 |
|---|---|
| `frontend/src/lib/class/start-date.ts` (신규) | 순수 날짜 유틸: 파싱·표시 "11/3(화)"·월 격자(5~6주)·범위 판정·말일 보정 월 이동·셀 라벨 |
| `frontend/src/components/class/flow/host/start-date-picker.tsx` (신규) | 단일 필드 + 데스크톱(≥768) 포털 팝오버(326px, 우측 정렬, 뷰포트 8px 보정) / 모바일 Bottom Sheet(핸들 드래그·딤·좌우 스와이프·history 뒤로가기·배경 inert·스크롤 잠금·safe-area·85dvh) |
| `frontend/src/pages/classes/wizard-visual-components.tsx` | `WizardDateTime` date 분기를 StartDatePicker 로 교체(−/+·native date 제거, 시그니처 불변) |
| `frontend/src/pages/classes/class-scheduling.css` | `cw-date*` 규칙 추가(`.cs-wizard` 하위, `!important` 없음) |
| `frontend/tests/sdd281/*`, `tests/sdd279/classes-new-time.test.tsx` | 신규 시험 + SDD-279 의 "날짜는 ± 유지" 기대를 새 동작으로 갱신 |

서버·draft·API 계약 변경 없음. 값 "YYYY-MM-DD" 불변, `rule({ start_date })` 경로 그대로. 앱 빌드 불필요·심사 영향 없음.

## 디버깅 기록
- 모바일 뒤로가기: React StrictMode 의 mount→cleanup→mount 로 history 칸이 어긋나 시트가 열리자마자 닫힘 → 표식(`cwDateSheet`)으로 1칸만 쌓고, 정리는 지연 확인(`sheetMounts`)으로 변경.
- `.cs-wizard button{border:0}` 가 날짜 셀 2px 테두리를 덮어 오늘 링이 사라짐(비전 확인으로 발견, computed `border-width` 0px) → 셀렉터를 `.cs-wizard .cw-date*` 로 올려 2px 확인.
- 팝오버가 위치 계산 전 포커스를 받아 스크롤이 튐 → 위치 확정(`pos`) 뒤 포커스.
- 모바일 핸들 드래그 닫기가 포인터 이탈로 실패 → `setPointerCapture`.

## 시험 실제 결과
- RED: 컴포넌트 미작성 상태에서 `tests/sdd281/start-date-picker.test.tsx` import 실패(Test Files 1 failed, no tests). 유틸 시험은 유틸 작성 후 7/7.
- GREEN: `tests/sdd281` 33 passed(3회 반복 안정). 회귀(`sdd279`·`sdd280*`·`class-scheduling*`·`class-wizard-stepper-input`·`class-schedule-editor`·`class-flow-host-wizard*`) 포함 14 files / 174 passed.
- `tsc -b` 오류 0, eslint(변경 파일·`src/pages/classes`·`tests/sdd279·281`) 오류 0.
- 전체 vitest: Test Files 13 failed | 416 passed | 1 skipped (430), Tests 23 failed | 4070 passed — 기준선(23건/13파일)과 동일. 실패 13파일(agent-counselor-page·chat-message-deeplink·font-scale·measure-guard-null-display·nav-badge-by-key·nav-labels-characterization·org-*-browser·raw-chunk-queue·report-*-pdf·sdd220-native-release·sdd234-a-mobile-home)에 sdd281·sdd279·start-date 관련 0건 → 신규 0.
- `/classes/new` 2단계 실측(Playwright, API 합성 목) — `verify-impl.json`, PNG `shots-impl/`:

| viewport | 세 칸 폭/라벨 y/높이 | 열림(뷰포트 안·하단) | 6주 달 | 셀 최소 | 닫기 |
|---|---|---|---|---|---|
| 1440×900 | 186/186/186 · y 350 동일 · 56 | 팝오버 326×370, 안 | 416 안 잘림 | 44×44 | ESC·바깥·토글·선택·포커스복귀 ✓ |
| 1280×720 | 191×3 · y 260 · 56 | 326×370, 하단여백 8 | 416 | 44×44 | ✓ |
| 1024×768 | 186×3 · y 284 · 56 | 326×370 | 416 | 44×44 | ✓ |
| 390×844 | 156 · y 300/300/396(2열) · 56 | 시트 444, 하단 0 | 490 ≤717 | 44×50.8 | ESC·배경·X·핸들드래그·뒤로가기·선택 ✓ |
| 360×740 | 141 · 56 | 시트 444, 하단 0 | 490 ≤629 | 44×46.6 | ✓ |
| 390×600 | 156 · 56 | 시트 426, 하단 0 | 470 ≤510 | 44×50.8 | ✓ |

- 시작 날짜 칸 −/+ 0, native date 0, 가로 넘침 0. 오늘→3주 뒤(11/24) 같은 달 **열기+선택 2탭**. 데스크톱 `preview-schedule` 요청 `start_date:"2026-11-24"` 반영, 다음 단계 일정 미리보기에 "1회차 · 11. 24." 표시.
- copySetup(`/classes/new?copy=…`, 새 시작 날짜): 같은 컴포넌트로 팝오버 동작, 옛 −/+ 없음.
- PNG 직접 열람: 1440 열림(−/+ 없음·팝오버·정렬), 390 시트 열림(핸들·제목·X·월 이동·하단 안내/오늘로 이동), 390×600 6주 달(잘림 0), 390 닫힘(단일 필드). 오늘 링은 CSS 수정 후 재캡처 확인(computed 2px `rgb(210,174,252)`).

## 확인 못 한 것
- 실기기 안전영역(노치)·OS 제스처·키보드·스크린리더(VoiceOver/TalkBack) 음성, Safari 실제 뒤로가기 동작.
- 데스크톱 팝오버는 필드 우측 정렬(popRight = 필드 우측, 예: 1440에서 611=필드 right)로 측정. 시각 판독은 "왼쪽 정렬"로 읽힌 적이 있으나 숫자(팝오버 right = 트리거 right)가 정본.
