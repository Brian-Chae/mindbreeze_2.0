# SDD-280 — Verify (Stage ③, 구현 전 작성)

> 구현 후에 이 문서를 고치지 않는다. 결과는 `verify-results.json` 과 `summary.md` 에 기록한다.

## A. 자동 시험 (vitest, 구현 전 RED 확인)
| ID | 시나리오 | 기대 |
|---|---|---|
| A1 | CSS 계약: `.class-member-picker__list` 규칙 어디에도 `min-height:320px`·`flex:1 0 320px`·`max-height:320px` 없음 | 통과 |
| A2 | CSS 계약: `.w-plist` 에 `min-height:320px` 없음 | 통과 |
| A3 | CSS 계약: `@media (min-width:1024px)` 에서 `.cw-split` 이 `grid-template-columns` 동일 비율 2열(`minmax(0,1fr) minmax(0,1fr)`) | 통과 |
| A4 | CSS 계약: `.cw-scroll` 이 `overflow-y:auto`, `.fl-foot` 은 `flex:none`(본문과 분리된 행) | 통과 |
| A5 | CSS 계약: `!important` 가 새 규칙에 없음 | 통과 |
| A6 | 구조: 4단계 `.cw-split` 존재, 왼쪽(`.cw-split-left`)에 요약·탭·CSV·(org_admin) 대행 사유, picker(`[data-class-member-picker]`)는 `.cw-split` 직계(오른쪽) | 통과 |
| A7 | 구조: `footer.fl-foot` 은 `.fl-body` 바깥 형제이며 "이전"/"클래스 만들기" 버튼 포함 | 통과 |
| A8 | 구조: 일반 사용자(counselor)는 대행 사유 없음 | 통과 |
| A9 | picker: `selectedContainer` 지정 시 선택 칩이 해당 컨테이너에 렌더, 제거 버튼(`N 선택 취소`) 동작 | 통과 |
| A10 | picker: `selectedContainer` 미지정 시 기존처럼 인라인 칩(MemberInviteSheet 회귀) | 통과 |
| A11 | 회귀: 선택·검색·CSV·대행 사유·비회원 이메일 탭 기존 시험 전부 | 통과 |
| A12 | `tsc -b`, `eslint`(변경 파일) | 오류 0 |

## B. 실제 컴포넌트 레이아웃 측정 (Playwright + vite dev, API는 `page.route` 목)
조건: 화면 {1440×900, 1280×720, 1024×768, 390×844, 1280×600, 390×600} × 회원 {0,4,20,60} × 대행 사유 {표시(org_admin), 숨김(counselor)} × 선택 {0,12}.
| ID | 측정 | 통과 기준 |
|---|---|---|
| B1 | 데스크톱(≥1024) 좌/우 열 폭 | 차이 ≤ 2px, 좌측이 왼쪽·우측이 오른쪽 |
| B2 | 하단 바(`.fl-foot`) | viewport 하단 고정(바닥 = innerHeight ±1), 항상 보임, 스크롤 시작/중간/끝 모두 |
| B3 | 요소 사각형 겹침 | 0 (조상-자손 제외, overflow clip 반영) |
| B4 | 도달성 | 마지막 회원 행·대행 사유 입력이 스크롤 후 하단 바 위쪽에 완전히 보임(가려짐 0) |
| B5 | 가로 넘침 | `scrollWidth ≤ clientWidth` (문서·본문) |
| B6 | 터치 타깃 | 체크박스 행(label)·탭·버튼·칩 제거 ≥ 44px (체크박스 도형 24px 은 행 전체로 측정) |
| B7 | 모바일(<768) | 1열(좌우 분할 없음), 순서: 요약→탭→검색→선택 요약→목록→사유 |
| B8 | 태블릿(768~1023) | 1열 |
| B9 | 스크롤 주체 | 본문(`.fl-body`) 1곳만 세로 스크롤, 목록·칩 외 중첩 세로 스크롤 없음(칩 영역 제외) |
| B10 | 터치 스크롤 트랩 | 390 화면에서 목록·카드 위 지점에서 `elementFromPoint` 가 가려진 고정 요소(pointer-events·z-index)가 아님, 본문이 touch wheel 스크롤로 `scrollTop` 증가 |
| B11 | 키보드 포커스 | 마지막 행 체크박스에 Tab/focus 시 하단 바에 가려지지 않음 (`scroll-padding-bottom`) |
산출물: `verify-results.json`, PNG(1440 20명·관리자, 1024, 390) → `shots-impl/`.

## C. 동작 불변 (코드 리뷰 + A11)
선택/해제 시 `member_ids` patch, 검색 200ms 디바운스·API 파라미터, CSV 가져오기, 비회원 이메일 추가/삭제, 대행 사유 `maxLength 1000`·필수 검증, 겹침 확인 체크박스 — 핸들러·상태 코드 diff 0 (JSX 위치 이동만).

## D. 확인 불가(정직 기록 대상)
실기기 WebView·iOS Safari 100dvh/주소창, OS 가상키보드, 스크린리더, 실제 회원 데이터. 합성 데이터·headless Chromium 으로 대체하며 한계를 summary 에 적는다.

## E. 모바일 변경 없음 확인
<768px 에서 DOM 순서·동작 동일, 시각은 블록별 카드(시안). 변경 전/후 390 스냅샷에서 순서·내용 동일 확인.
