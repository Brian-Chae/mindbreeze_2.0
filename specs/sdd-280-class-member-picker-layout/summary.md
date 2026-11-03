# SDD-280 — Summary (Stage ⑥)

클래스 만들기 4단계 회원 목록 레이아웃을 B2-2(데스크톱 2열 1:1, 하단 바 상시 노출)로 구현했다. 레이아웃만 변경했고 선택·검색·CSV·비회원 이메일·센터 관리자 대행 사유 동작과 서버 계약은 그대로다.

## 변경
| 파일 | 내용 |
|---|---|
| `frontend/src/pages/classes/class-scheduling-wizard.tsx` | 4단계 DOM을 `.cw-split`(좌 `.cw-split-left` / 우 picker 또는 `.cw-split-panel`)로 재구성. `fieldset` 3분할(탭·선택·대행 사유). `useStickyFit` 훅(데스크톱에서 좌측 열이 본문 높이에 들어갈 때만 sticky). 핸들러·상태·API 불변 |
| `frontend/src/components/class/structure/class-member-picker.tsx` | `selectedContainer?: HTMLElement \| null` prop 추가(선택 칩을 portal 로 왼쪽 슬롯에 렌더). 미지정 시 기존 인라인 → `MemberInviteSheet`·`class-members-panel`·`instant-invite-sheet` 불변 |
| `frontend/src/pages/classes/class-scheduling.css` | 목록 `min-height:320px`·`flex:1 0 320px`·`max-height:320px` 제거, `.cw-scroll`·`.cw-split*` 추가 |
| `frontend/tests/sdd280-class-member-picker-layout.test.tsx` | 신규 10건 |
| `specs/.../{plan,verify,summary}.md · verify-impl.mjs · verify-results.json · shots-impl/` | 산출물 |

## 원인과 해결 방식
- 원인: 목록의 `min-height:320px`(고정 최소 높이)가 부모 카드의 줄어든 높이와 충돌해 목록이 카드·하단 바를 침범했다. 4단계 본문(`w-fill`)은 스크롤 영역이 없어 흘러넘친 부분을 볼 방법도 없었다.
- 해결: 높이 의존(`flex:1; min-height`)을 목록·`.cw-member-picker`·`.w-plist`에서 제거(`min-height:0; overflow:visible`). 4단계 본문(`fl-body.cw-scroll`)만 `overflow-y:auto`, `fl-foot`는 `flex:none` 별도 행이라 본문과 겹칠 수 없다. `max-height`만 더하는 방식은 쓰지 않았고 `!important`도 없다.
- 스크롤 모델: 데스크톱 2열에서도 **본문 한 곳만 스크롤**한다(오른쪽 패널 내부 스크롤 없음). 시안(`option-b2-2.html`)과 같고, 스크롤 영역이 하나라 터치 스크롤 트랩·이중 스크롤이 없다. 선택 칩의 기존 `max-height:88px` 내부 스크롤도 4단계에서는 해제했다(측정에서 중첩 스크롤로 잡혀 수정).
- 왼쪽 열은 높이가 본문에 들어갈 때만 `position:sticky`(`data-fit`), 넘치면 자연 흐름이라 대행 사유까지 도달한다.
- 태블릿(768~1023)은 시안 README 근거(폼 폭 약 300px 이하 줄바꿈)에 따라 **1열**, 1024px부터 2열.

## 시험 (실제 출력)
- RED(구현 전): `Tests 8 failed | 2 passed (10)` — A5·A10은 구현 전에도 참인 불변 조건.
- 구조 변경 후: `3 failed | 18 passed (21)` (남은 3건은 CSS 계약).
- CSS 반영 후 GREEN: `sdd280 Tests 10 passed (10)`.
- 관련 회귀(`tests/sdd280 class-scheduling* class-flow-host* sdd216-member-candidates instant-invite-sheet instant-class* class-schedule-editor class-structure*`): `Test Files 25 passed (25) · Tests 436 passed (436)`.
- `tsc -b` 출력 없음(오류 0), `eslint`(변경 3파일) 출력 없음.

## 레이아웃 측정 (실제 컴포넌트, Playwright + vite dev, API는 page.route 합성 목)
`verify-impl.mjs` → `verify-results.json`. 화면 6 × 회원 {0,4,20,60} × 역할 {센터 관리자, 상담사} × 선택 {0,12}, 선택 12명 조합은 회원 ≥12일 때만: **72조합 중 72 통과, 실패 0** (겹침 0, 가로 넘침 0, 하단 바 고정, 마지막 행·대행 사유 도달, 터치 타깃 ≥44px, 중첩 스크롤 0).
| 화면 | 왼쪽 폭 | 오른쪽 폭 | 차이 | 하단 바 gap | 마지막 행 ↔ 바 여백 |
|---|---|---|---|---|---|
| 1440×900 | 548 | 548 | 0px | 0 | 57px |
| 1280×720 | 548 | 548 | 0px | 0 | 57px |
| 1024×768 | 468 | 468 | 0px | 0 | 57px |
(1280×600 등은 `verify-results.json` 참조. 390·768 미만은 1열.)
- 터치 스크롤(390×844, `hasTouch`, CDP 터치 제스처): 목록 위 지점에서 본문 `scrollTop` 0 → 약 400으로 증가, 그 지점의 hit-test 는 목록 행(가려진 고정 요소 없음). 두 역할 모두 정상.
- PNG: `shots-impl/step4-{1440x900,1024x768,390x844}-admin-20m-12sel.png`, `step4-1440x900-admin-20m-0sel.png`. 1440·390 PNG 는 눈으로 확인했다(2열 1:1, 하단 버튼 보임).

## 모바일 변경 없음 확인
- 390·800px 모두 1열이며 화면 순서 요약 → 탭 → 검색 → 선택 요약(CSV·칩) → 목록 → 대행 사유(브리프 순서와 동일). 블록별 카드로 나뉘어 보이는 시각 변경은 시안대로다.
- 대표가 보낸 "스크롤이 아예 안 된다" 증상은 합성 환경에서 재현되지 않았다. 점검한 항목: 고정 요소 `pointer-events`·z-index 가림(없음), `overflow:hidden` 부모(4단계 본문은 `overflow-y:auto`), 터치 제스처 스크롤(통과). 이전 코드는 4단계 본문에 스크롤이 없어 하단이 잘렸으므로 그 증상과 같은 계열일 수 있으나 실기기 확인 전에는 단정하지 않는다.

## 확인하지 못한 것
- 실기기 WebView·iOS Safari 의 `100dvh`·주소창 변화, OS 가상키보드, 스크린리더, 실제 회원 데이터(합성 데이터만 사용).
- 데스크톱 `position:sticky`(`data-fit`) 동작은 코드·시안 기준이며 `verify-results.json` 에 별도 측정하지 않았다.
- **Tab 키 순서**: 모바일 화면 순서(검색이 선택 요약 앞)와 DOM/Tab 순서(탭 → CSV → 대행 사유 → 검색 → 목록)가 다르다. 시안 README 가 짚은 항목이며 변경 전에도 같은 종류의 어긋남이 있었다(`display:contents`+`order`). 이번 범위(레이아웃만)에서는 건드리지 않았고, 해결하려면 picker 를 검색/목록 분리 컴포넌트로 쪼개는 별도 작업이 필요하다.
- 정원 초과(12명 선택 vs 정원 10) 허용 여부는 시안 README 질문 3, 현행 동작(정원 도달 시 추가 체크 비활성) 유지. 측정에서는 정원 30으로 설정해 12명 선택 상태를 만들었다.

앱 빌드 필요 없음(프론트 웹 변경만). 심사 영향 없음.
