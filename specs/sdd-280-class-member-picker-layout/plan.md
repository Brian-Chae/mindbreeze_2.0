# SDD-280 — Plan (Stage ②)

- 결정(대표, 11/3): **B2-2 채택**, 데스크톱(≥1024px) 2열 **1:1**, 왼쪽 form / 오른쪽 검색+목록, 하단 "이전 / 클래스 만들기" 바는 항상 보임, 모바일(<768)·태블릿(768~1023)은 1열.
- 범위: **레이아웃만**. 선택·검색·CSV·비회원 이메일·센터 관리자 대행 사유 동작/서버 계약 변경 없음.

## 원인 (코드 확정)
`class-scheduling.css`
- `:312` `.class-member-picker__list{flex:1;min-height:320px;overflow:auto}` + `:325` `max-height:none`
- `:310` `.cw-member-picker{flex:1;min-height:0}`, `:163` `.w-plist{flex:1;min-height:320px}`
- `:320` (max-height:640) `flex:1 0 320px;max-height:320px`
- `:154` `.fl-body.w-fill .fl-col{flex:1;min-height:0;max-height:640px}` — 4단계 본문은 `overflow` 없음 + 고정 높이 열.
→ 목록의 `min-height:320px`가 줄어들 수 없는 값이라 부모(카드)가 줄어들면 목록이 카드·하단 바 영역을 침범. `max-height`만 추가하면 min-height 가 이겨서 재발하므로, **min-height/flex:1 높이 의존 자체를 제거**하고 스크롤 주체를 본문 한 곳으로 정리한다.

## 설계
### 스크롤 모델 (시안 `option-b2-2.html` 동일)
- `.cs-wizard .fl-layer`(100dvh flex column) = `header(flex:none)` / `fl-body(flex:1; min-height:0; overflow-y:auto)` / `fl-foot(flex:none)`. 하단 바는 overlay 가 아닌 **별도 flex 행** → 본문이 가려지지 않고 높이 중복 계산 불필요.
- 4단계(`step===3`) 본문(`fl-body.cw-scroll`)만 스크롤. **목록 내부 스크롤 없음**(데스크톱 오른쪽 패널의 긴 목록도 본문 스크롤. 이유: 스크롤 영역 1개 → 터치 스크롤 트랩·이중 스크롤 없음, 시안과 동일, 1:1 열 높이 계산 불필요).
- 본문 `scroll-padding-bottom`·`padding-bottom`으로 포커스·마지막 행·대행 사유가 바 위로 도달.

### DOM (4단계만, `class-scheduling-wizard.tsx`)
```
fl-col.cw-split                         ← ≥1024 2열 grid(1fr 1fr, gap 24), <1024 기존처럼 flex 1열
 ├ div.cw-split-left                    ← ≥1024 sticky(높이가 맞을 때만, ResizeObserver), <1024 display:contents
 │   ├ section.w-sum                    (일정·담당 요약 + 겹침 안내, 기존)
 │   └ div.cw-split-form                ← 데스크톱 카드 1개, <1024 display:contents
 │       ├ fieldset.cw-sec.cw-sec-tabs      탭(회원/비회원 이메일) + CSV file input
 │       ├ fieldset.cw-sec.cw-sec-select    회원: w-count(선택 N/정원 + CSV 추가) + 칩 슬롯 / 이메일: 입력줄·count·안내
 │       ├ label.cw-check                   (겹침 확인, 기존)
 │       └ fieldset.cw-sec.cw-sec-reason    대행 사유 (org_admin 만)
 └ ClassMemberPicker.cw-member-picker       ← ≥1024 오른쪽 카드(검색 → 안내 → 목록). 이메일 탭은 section.cw-split-panel(입력한 이메일 목록)
```
- 선택 칩은 picker 소유 상태(`remove`, selectionReady 게이트)를 유지하려고 **portal**: `ClassMemberPicker` 에 선택 prop `selectedContainer?: HTMLElement | null` 추가(미지정 시 기존처럼 인라인 → MemberInviteSheet·members-panel·instant-invite-sheet 불변).
- `<fieldset disabled>`는 카드별로 유지(기존 fieldset 단일 → 3개). 검색/체크박스는 picker 의 `disabled` prop 그대로.
- 모바일(<1024) 순서: 요약 → 탭 → 검색 → 안내 → 선택 요약(CSV·칩) → 목록 → 대행 사유. `display:contents` + `order` (시안 동일). 현재 순서와 동일, 블록별 카드로 분리.

### CSS (`class-scheduling.css`)
- 제거/정리: `:312` 목록 `flex:1;min-height:320px` → `flex:none;min-height:0;max-height:none;overflow:visible`; `:310` `.cw-member-picker` `flex:none`; `:163` `.w-plist` `flex:none;min-height:0;overflow:visible`; `:320` 의 `flex:1 0 320px;max-height:320px` 삭제; `!important` 없음.
- 추가: `.cw-scroll`(본문 스크롤·justify-content:flex-start·padding-bottom 32·scroll-padding-bottom), `.cw-split*` 규칙, ≥1024 미디어쿼리, 터치 타깃 ≥44px(체크박스 행 전체 min-height 72).
- 태블릿(768~1023)은 시안 README 근거(약 300px 폼 폭 줄바꿈)에 따라 **1열**, 1024px부터 2열.

## 변경 파일
| 파일 | 내용 |
|---|---|
| `frontend/src/pages/classes/class-scheduling-wizard.tsx` | 4단계 DOM 재구성(분할 래퍼·fieldset 3분할·칩 슬롯·sticky 훅). 핸들러·상태·API 불변 |
| `frontend/src/components/class/structure/class-member-picker.tsx` | `selectedContainer` prop(portal) 추가만 |
| `frontend/src/pages/classes/class-scheduling.css` | 위 CSS |
| `frontend/tests/sdd280-class-member-picker-layout.test.tsx` | RED→GREEN 구조·CSS 계약·picker portal 시험 |
| `specs/.../verify.md · verify-results.json · shots-impl/ · summary.md` | 검증 산출물 |

## Task 순서
1. verify.md(구현 전) 2. RED 시험(구조·CSS 계약·portal) 3. picker portal 4. wizard DOM 5. CSS 6. 기존 회귀 시험 7. Playwright 측정 하네스(vite dev + API route 목) 8. summary.md · 커밋.

## 금지/범위 밖
푸시·PR·배포·메일·삭제·앱 빌드·prod 접속·시크릿 출력. 서버/API/선택·검색·CSV·이메일·대행 사유 로직 변경 없음. 정원 초과 선택 허용 여부(시안 README 질문 3)는 건드리지 않음(현행: 정원 도달 시 추가 체크 비활성).
