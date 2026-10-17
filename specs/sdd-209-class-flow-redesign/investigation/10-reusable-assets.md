# I10 재사용 가능한 SDD-208 자산 — 코드 조사

> 기준: develop `32fa5533`, 조사일 2026-10-17, 읽기 전용(빌드·실행 없음). 경로 표기: 프론트는 `frontend/src/`, 백엔드는 `backend/app/`, 테스트·e2e 는 `frontend/tests/`·`frontend/e2e/`. 확정 결정 1~8 과의 충돌은 없다.
> "SDD-208 소유 파일"은 완료된 선행 SDD 의 코드·측정이므로, 수정이 필요하면 기본값을 유지하는 **추가 props/추가 파일**로만 하고 기존 하니스·자가 검증(`e2e/class-player/selftest.mjs`)·테스트가 계속 통과해야 한다(회귀 방지).

## 0. 한 줄 결론

- `components/class/player/shared/` 의 12개 파일 중 **그대로 쓸 수 있는 것**은 `IconCircleButton`·`NoticeBanner`·`NoticeOverlay`·`PlayerBackdrop`·`sheet-mode.ts`·`player-tokens.css`(토큰·리셋·타이포 방어·reduced-motion). **props 확장이 필요한 것**은 `PlayerShell`(CTA 푸터를 시트 아래로 비활성화)·`PlayerSheet`(스크림·높이 상한·닫기 불가·불투명도)·`PlayerTopBar`·`PlayerDock`(호스트 로비 도구 행 한정). **새로 필요한 것**은 푸터 CTA 컬럼, 마법사 진행 점, 카드·칩·버튼·행·세그먼트·입력(`fl-*`), 풀스크린 상태 화면, 마이크 5단계 링. `StatusRing`은 사전 흐름에서 거의 쓰이지 않는다.
- **접두사 제안: 하이브리드.** 루트에 `pz-root` 를 같이 달아 토큰·리셋·전역 타이포 방어·reduced-motion 을 그대로 얻고, 컴포넌트 클래스는 시안과 같은 `fl-*`(몰입형)·`sh-*`(셸형) + 트랙 전용 `fm-*`/`fh-*` 로 분리한다. `pz-*` 로 통합하지 않는다(§4).
- 시안 `flow-base.css` 를 그대로 옮기면 **앱 전역 h1/h2/p 색 규칙(`mb-tokens.css:187-228`)이 `.fl-h1`·`.fl-h2` 를 어둡게 만든다** — SDD-208 에서 겪은 것과 같은 결함이다. 이식 시 `.fl-h1,.fl-h2{color:var(--tx-hi)}` 를 명시해야 한다(§4-③).
- 하니스는 URL 규약을 시안과 같게 `/design/class-flow?screen=FM06c&case=…&sheet=…` 로 두고 **새 라우트·새 페이지·새 픽스처 폴더**로 만든다. `e2e/class-player/lib.mjs` 에서는 `launchBrowser`·`parseArgs`·`formatReport`·`writeReport`·`measureFit`(셀렉터 주입형)만 그대로 쓸 수 있고, `caseUrl`·`measureMemberSymmetry`·`runCli` 는 회원 진행 화면에 고정돼 있어 재사용 불가다(§3). 균형 규칙 S1~S3·S5·S6·S8~S10·MS3 는 그대로, S7 은 변형, S4·MS1·MS2·CS* 는 해당 없음, **새 규칙 6개**가 필요하다.
- 하니스 라우트는 **지금도 dev 번들에 포함**된다(§3-5). 사전 흐름 하니스도 같은 선례를 따를지 결정이 필요하다(결정 1).
- 기존 테스트 중 신규 흐름 교체로 갱신·삭제되는 것은 약 20개 파일이다(§7 표).

## 1. 현재 코드 상태 (있음/일부/없음)

| 항목 | 판정 | 근거 |
|---|---|---|
| 공용 셸(상단·본문·시트·도크) | 있음 | `shared/PlayerShell.tsx:15-36`, `player-shared.css:13-27` |
| 푸터 CTA 전용 슬롯 | 없음(도크 슬롯으로 대용 가능) | `PlayerShell.tsx:12` `dock` 슬롯, 폭 `min(100%, var(--pz-col))` `player-shared.css:27` |
| 시트 스크림(딤)·확인 시트 | 없음 | `PlayerSheet.tsx:65-84`(스크림 요소 없음), 시안 `.fl-scrim`/`.w-wrap` `flow-base.css:84`, `host-b.html:132` |
| 시트 높이 상한 | 고정 `min(58dvh, 520px)` | `player-shared.css:184`, 변형 `tall` `:187` — 시안은 `calc(100dvh - 72px)` `host-b.html:133` |
| 마법사 진행 점·단계 | 없음 | 시안 `.fl-steps` `flow-base.css:75-78` |
| 풀스크린 상태 카드 | 일부(비공개) | `MemberFullView.tsx:41-84` |
| 마이크 5단계 링 | 없음 | 시안 `ringBtn` `host-b.html:363-367`, `StatusRing` 은 연속 호(`StatusRing.tsx:37,64`) |
| 전극 트래커(L·기준·R) | 있음(재사용 대상) | `components/class/SensorTracker.tsx`(I4 조사 범위, 여기서는 존재만 확인) |
| 하니스 페이지·픽스처 수집 | 있음(진행 화면 전용) | `pages/design/ClassPlayerCasesPage.tsx`, `lib/class/player-harness.ts`, 픽스처 글롭 `ClassPlayerCasesPage.tsx:24` (`lib/class/fixtures/*.ts` 비재귀) |
| 하니스 라우트의 prod 번들 포함 | 있음(게이트 없음) | `App.tsx:61`(lazy), `:203`(무가드 Route). `import.meta.env` 분기 없음. `npm run build` 가 dev 배포에서 실행 `.github/workflows/deploy-dev.yml:45` |
| 측정 스크립트 | 있음(진행 화면 고정) | `e2e/class-player/{lib,fit,host,live,selftest,stability,symmetry-host,symmetry-member}.mjs` |
| 시안 쪽 사전 흐름 측정 도구 | 있음 | `designs/class-flow-redesign/tools/{member-a-lib,member-b-measure,host-a-measure-lib,host-b-measure}.mjs` — 금지어·글리프·대문자·8배수·중첩 스크롤·트래커·내 영상·소리 검사 포함 |
| 토큰 이름 대응 | 대부분 동일 | §4-표 |
| 기존 사전 흐름 테스트 | 있음 | §7 표 |

## 2. `components/class/player/shared/` 전 파일 분석

공통: 모든 컴포넌트 스타일은 `player-shared.css`(199줄), 토큰은 `player-tokens.css`(79줄)의 `.pz-root` 에 스코프된다(`player-tokens.css:3`). 루트에 `pz-root` 가 없으면 토큰 변수가 비어 깨진다.

| 파일 | props·역할 | 사전 흐름(FM05~FM10·FH02~FH10) 판정 | 필요한 확장 |
|---|---|---|---|
| `PlayerShell.tsx` (36줄) | `place('online'\|'offline')`·`sheetOpen`·`top`·`dock`·`sheet`·`backdrop`·`children`. `position:fixed; inset:0; 100dvh`, 그리드 4행 `auto minmax(0,1fr) auto auto`(`player-shared.css:13-27`). 시트가 열리면 `top`·`stage` 만 `inert`, **도크는 눌리게 둔다**(`PlayerShell.tsx:30-31`) | **props 확장 후 사용.** 상단 바(`top`) + 본문(`children`) + 하단 CTA(`dock` 슬롯, 640 폭 가운데 = 시안 `.fl-foot>.fl-col` 과 같음). 전체 화면 카드(`top=null, dock=null`)는 이미 선례(`MemberFullView.tsx:41-55`) | ① 확인 시트가 열렸을 때 CTA 푸터도 `inert` 로 만드는 옵션(`inertDock`) — 시안은 스크림이 푸터까지 덮는다 ② `place` 는 사전 흐름에서 의미 없음(`data-place` 속성만, 항상 필수) → 선택 prop ③ 시트 위치(그리드 3행에 끼워 본문을 밀어 올림 `player-shared.css:182-186`)와 시안의 전체 오버레이가 다르다 → 확인 시트는 오버레이 변형 필요 |
| `PlayerSheet.tsx` (87줄) | `open`·`title`·`sub?`·`tall?`·`onClose`·`children`. `role=dialog aria-modal`, Esc·바깥 `pointerdown`·X 버튼으로 닫힘, 열면 포커스 이동·닫으면 복귀(`:26-60`), 모드는 `useSheetMode` 한 곳(`:21`). 헤더 48px + 본문 `overflow-y:auto`(`player-shared.css:196-199`) | **props 확장 후 사용.** 시안 시트 12종 이상(FH06a 도구 시트, FH07·FH08·FH09 확인 시트, FM06 `started`·권한 시트, FM09 시트 2종)이 같은 헤더(제목 + X)·바깥 클릭 닫기 규약 | ① `scrim`(딤, 시안 `rgba(12,6,20,.55)` `host-b.html:132`) ② 높이 상한 변형(`calc(100dvh - 72px)`) — 현행 `min(58dvh,520px)` 로는 사후 체크인·시작 확인 시트가 내부 스크롤된다(시안 규칙 `nested` 0) ③ 닫기 불가(`noClose` 시안 `member-b.html:334`·종료 중 `confirm-busy`) ④ 배경 불투명도(시안 `.96`, 현행 `--sheet-bg-strong` `.78`) ⑤ 푸터(고정 버튼) 슬롯 |
| `PlayerDock.tsx` (47줄) | `items{key,label,icon,badge?}`·`active`·`onSelect`·`ariaLabel`. 같은 항목 재선택 시 `null`(토글) | **회원: 쓰지 않음**(마법사는 하단 주 버튼 1개, FM07 은 `준비 다시 확인하기` 1개). **상담사: FH06 로비의 도구 행(BGM·내 밴드·발언권·채팅)에만 가능성** — 시안은 하단 고정이 아니라 본문 안 카드형 버튼 행(`host-b.html:488`, `.w-dk` `:127`) | `variant="cards"`(컨테이너 배경·높이 제거, 항목마다 카드 스타일) 또는 신규 `FlowToolRow`. 항목 선택 = 시트 열기(토글)라 로직은 그대로 |
| `PlayerTopBar.tsx` (22줄) | `variant('member'\|'host')`·`left`·`center`·`right`. 3열 `minmax(44px,1fr) auto minmax(44px,1fr)`, 최소 높이 56(`player-shared.css:48-56`), `host` 는 카드형 | **그대로 가능(회원 variant).** 시안 `.fl-top`(96px·1fr·96px, 56px `flow-base.css:22-24`)·호스트 `.w-top`(56px·1fr·56px, 2줄 제목 `host-b.html:22-27`)과 구조가 같다. 슬롯 폭 차이(96 vs 44)는 S3(좌우 대칭)에서 문제없음 | 호스트 몰입형 헤더는 `variant="host"` 의 카드 배경을 쓰지 않으므로 `variant="flow"`(투명) 추가 또는 `center` 에 2줄 제목 노드 전달 |
| `IconCircleButton.tsx` (31줄) | `label`(필수 aria-label)·`icon`·`onClick`·`pz`·`disabled`·`pressed`·`variant(solid\|ghost\|primary)`. 44px 원형 | **그대로 가능.** 시안 `.fl-iconbtn`(44px, `--sheet-bg`, 테두리 `flow-base.css:25`)과 동일. 시트 닫기·뒤로·나가기·카메라/마이크 토글 | 마이크 레벨 링(`.w-ringbtn`)은 별도 컴포넌트 |
| `NoticeBanner.tsx` (34줄) | `tone(info\|caution\|coral\|live)`·`icon`·`children`·`variant(chip\|banner)`·`pz`·`action`. 아이콘+글자 병행(색 단독 전달 금지) | **그대로 가능.** 시안 `.fl-banner`(`flow-base.css:81`: 상단 절대 배치·코랄 점선) = `banner` + `NoticeOverlay`. FM06c/d 권한·미지원 안내, FH05 경고 | 코랄 점선(시안) vs 실선(`player-shared.css:149-151`) 차이는 `data-style` 속성 추가로 해결(선택) |
| `NoticeOverlay.tsx` (9줄) | `children` 만. 흐름 밖(`position:absolute; top:0`)에 배너를 띄워 아래 요소를 밀지 않는다(`player-shared.css:136-143`) | **그대로 가능.** 시안 "배너/오버레이: 자리를 밀지 않는다"(`flow-base.css:80`)와 같은 원칙. 기준 요소에 `position:relative` 필요 | - |
| `StatusRing.tsx` (88줄) | `variant(hero\|mini)`·`fraction`·`tone`·`colorVar`·`core`·… 지표 정적 게이지 | **거의 쓰지 않음.** 사전 흐름에 지표 링이 없다. FM06d 마이크 레벨의 "5단계 링"은 연속 호(`fraction`)가 아니라 5개 분절(시안 conic 5×64°, `host-b.html:363-367` `ringBtn`) | `segments` prop 을 추가하거나 신규 `MicLevelRing`(권장 — 아이콘 버튼 둘레라 `StatusRing` 구조와 다름) |
| `PlayerBackdrop.tsx` (20줄) | `imageSrc?`. 있으면 정지 이미지(하니스·측정용), 없으면 `FadingImageBackground` 교차 페이드 + 스크림 | **그대로 가능.** 시안 `.fl-backdrop` + `.fl-root::after`(스크림 2단 그라디언트 `flow-base.css:16-18`)와 같은 역할. 스크림이 3단(중간 `.10`, `player-shared.css:32`)이라 시안보다 중앙이 덜 어둡다 | - (시안 대비 차이는 §5) |
| `sheet-mode.ts` (29줄) | `isSideSheet(vw,vh)`: `vw>=1000 && vw>vh` → 사이드, 아니면 바텀. `useSheetMode` | **그대로 가능.** 시안 member-b 는 `min-width:1100px` + 가로형(`member-b.html:215`), host-b 는 `1000px` + landscape(`host-b.html:134`) — 측정 뷰포트 4개(390×844, 834×1194, 1194×834, 1280×720)에서는 모두 일치하지만 1000~1099px 가로형(예: 1024×768)에서 회원 시안과 달라진다 → 시안 값을 1000 으로 정정 권장 | - |
| `player-shared.css` | 셸·배경·원형 버튼·상단 바·링·칩/배너·도크·시트. 모든 규칙 `.pz-*`. 최상단에 전역 타이포 방어(`:8-10`) | 방어 규칙과 reduced-motion 은 **그대로 상속**(루트에 `pz-root`). 컴포넌트 규칙은 사용분만 | - |
| `player-tokens.css` | `.pz-root` 에 브랜드·텍스트·시트·형태·타이포 스케일·`--pz-*`·지표색. `:where(.pz-root)` 리셋(`:71-74`), reduced-motion 전역 차단(`:77-79`) | **그대로 상속.** 새 변수(`--sp-*` 등)는 `flow-tokens.css` 가 같은 `.pz-root` 에 이름만 추가 | §4 |

## 3. 하니스·측정 스크립트

### 3-1. 현재 하니스 구조

- 라우트 `/design/class-player`(`App.tsx:203`). 쿼리 `role=member|host`, `case=ID`, `sheet=`, `detail=`, `viewport=390x844`(iframe 래핑), 그 외 쿼리는 케이스별 변형(`ClassPlayerCasesPage.tsx:44-58`).
- 케이스 등록: 픽스처 모듈이 `export const playerCases: Record<string, {role, render(ctx)}>` 를 내보내면 `import.meta.glob('../../lib/class/fixtures/*.ts', {eager:true})` 로 수집(`ClassPlayerCasesPage.tsx:24`, `lib/class/player-harness.ts:36-49`). 글롭이 비재귀라 `lib/class/flow/fixtures/` 는 자동으로 섞이지 않는다.
- 준비 신호 `window.__ready`(폰트 로드 후, `ClassPlayerCasesPage.tsx:59-72`), 등록 목록 `window.__playerCases`(`:61`), 상태 전환 훅 `window.__patchCase`(`player-harness.ts:62-75`).
- 계약 `data-pz`: `app`·`col`(`PlayerShell.tsx:25-31`), `topbar|top`·`title|ttl`(`PlayerTopBar.tsx:15-18`), `ring`, `dock`·`dk`, `sheet`, `backdrop`, `banner`·`guide`, `overlay`, `fv-card` 등. 측정 셀렉터 맵이 `e2e/class-player/lib.mjs:50-68`.

### 3-2. 사전 흐름 하니스로 확장하는 방법

권장: **새 라우트·페이지·픽스처 폴더**, 기존 파일 무수정.

| 요소 | 제안 | 근거 |
|---|---|---|
| 라우트 | `/design/class-flow?screen=FM06c&case=on-group-opt-member-leadoffl&sheet=started&viewport=390x844` | 시안 URL 규약(`?screen=&case=`, 케이스 토큰이 `on/off`·`group/solo`·`none/opt/req`·`member`·상태 토큰, `member-b.html:299-309`)과 동일. 시안의 시트 상태는 `case` 토큰(`-started`, `-sheet`)이므로 `sheet=` 쿼리를 **둘 다 허용** |
| 페이지 | `pages/design/ClassFlowCasesPage.tsx`(= `ClassPlayerCasesPage` 복제 후 `role`→`screen` 키) | 기존 페이지는 `role`·`caseId` 두 키 고정(`:45-48`)이고 레지스트리가 `{member,host}` 배열(`:28`)이라 `screen→cases[]` 구조와 맞지 않는다 |
| 등록 계약 | `lib/class/flow/flow-harness.ts`: `export const flowCases: Record<screenId, { role, cases: string[], render(ctx) }>` + `collectFlowCases(import.meta.glob('.../flow/fixtures/*.ts'))` | `player-harness.ts` 의 `collectPlayerCases` 를 건드리지 않고 같은 패턴 사용 |
| 케이스 토큰 파서 | `lib/class/flow/flow-case.ts` `parseFlowCase(token)` → `{place, mode, band, role, state[]}` | 시안 파서(`member-b.html:299-309`)를 포팅. `player-case.ts` 의 `BandUi/CamUi/NetUi` 는 import 재사용, `MicUi` 는 `nodevice`·`unsupported` 가 없으므로 `flow-case.ts` 에서 `FlowMicUi = MicUi \| 'nodevice' \| 'unsupported'` 로 확장(SDD-208 파일 무수정) |
| 준비 신호 | `window.__ready`·`window.__flowCases = { FM06c: [...], … }` | 측정 스크립트가 미등록 케이스를 건너뛰는 방식(`lib.mjs:124-130,677-686`) 유지 |
| 상태 전환 | `window.__patchCase` 재사용(`registerCasePatch` `player-harness.ts:70`) | P11 "자리 고정"을 사전 흐름에도 적용(§3-4) |
| 정지 배경 | `HARNESS_BACKDROP_SRC` 대신 화면별 고정 이미지(시안 `BG` 표 `member-b.html:313`: FM06=4, FM07=1, FM08=5, FM09=8) | `player-harness.ts:9` 는 `background8` 하나. 시안 자산 5개는 앱 `public/images/` 와 동일 파일(`background8.webp` 바이트 일치 확인) |
| 인덱스 | `?index=1` 표(시안 `?index=1`, 가정 열 포함) | 시안 인덱스 문서화 `_mock-index.md` 와 대응 |

### 3-3. `lib.mjs` 재사용 가능한 정도

| 함수·상수 | 재사용 | 이유 |
|---|---|---|
| `launchBrowser`, `parseArgs`, `DEFAULT_BASE`, `VIEWPORTS`(4개), `SHORT_VIEWPORTS`, `formatReport`, `summarize`, `writeReport`, `RULE_NAMES`(확장 가능 객체) | **그대로** | 케이스·역할에 독립 |
| `measureFit(cfg)` | **그대로(설정 주입)** | `cfg.named`(박스 셀렉터)·`empties`·`forbidCoral`·`overlayCoverable` 를 인자로 받는다(`lib.mjs:422-423`). 내부의 `[data-pz="ring"] .pz-ring__core` 검사는 요소가 없으면 건너뜀(`:515`). 검사 항목: P1 스크롤 0, P2 12px 미만(코드는 ≤11px), P3 터치 44, P5 호흡 문구, PC 대비 3:1, P9 코랄, P13 겹침·이탈·잘림, P12 빈 영역 |
| `measureOne`/`runMeasure`/`runCli`/`buildJobs` | **불가(고정)** | `openCase`→`caseUrl`(`/design/class-player?role=…`, `lib.mjs:102-105`), `DEFAULT_IDS[role]`, `SELECTORS[role]` 하드코딩. 주입 지점 없음 |
| `measureMemberSymmetry`/`measureHostSymmetry` | **불가** | 링·도크·PiP·시트 기준(`MEMBER_SELECTORS`). 몰입형 마법사에는 링·도크가 없다 |
| `measureDockReach`(P14) | **해당 없음** | 도크 없음. 단 시안의 "하단 CTA 도달"은 보조 뷰포트(390×600, 1280×420)에서 눌리는지로 재정의 가능 |

→ `e2e/class-flow/lib.mjs` 를 새로 만들고 위 "그대로" 항목만 `import … from '../class-player/lib.mjs'` 한다. 나머지(`caseUrl`, `openCase`, `readRegistry`, `measureFlowSymmetry`, `runCli`)는 신규. `selftest.mjs` 처럼 위반 주입 더미 픽스처(`fixtures/__selftest.ts:238`)를 사전 흐름용으로도 둔다.

### 3-4. 규칙 적용성 — `designs/class-player-redesign/균형.md`(S1~S10, CS, MS) 를 읽고

| 규칙 | 사전 흐름 몰입형에 | 비고 |
|---|---|---|
| S1 단독 요소 중심축 | **그대로** | 본문 컬럼·하단 CTA 컬럼·진행 점·제목·로고·아이콘(시안 측정 `member-b-symmetry.txt` S1 5항목) |
| S2 좌우 여백 동일 | **그대로** | 본문·하단·시트 |
| S3 상단 바 좌우 대칭 | **그대로** | `.fl-top` 96/1fr/96, 높이 44/44 |
| S4 PiP 짝 가운데 | 해당 없음 | FM06d "내 영상·소리"는 단독 컴포넌트(S1 로 충분) |
| S5 시트 분기(세로=바텀, 가로=사이드) | **그대로** | `sheet-mode.ts` 한 곳. 단 시안 회원 1100px vs 코드 1000px(§2) |
| S6 균등 분배 | **그대로** | 3분할 세그먼트(`.fl-seg`), 5단계 척도, 시안 `w-pair`·체크인 척도 |
| S7 링 세로 중앙 | **변형** | 링이 없으므로 "본문 컬럼이 상단 바와 푸터 사이의 세로 중앙(허용 ±)"로 재정의 — 시안 측정이 이미 `본문 위 126.2/아래 126.2 (허용 ±52.5)` 형식 사용 |
| S8 박스 폭 동일 | **그대로** | 컬럼 안 카드·행 폭 동일 |
| S9 컬럼 max-width 640 | **그대로** | `--col-w: 640px`(= `--pz-col`) |
| S10 8배수 간격 | **그대로** | 시안 `space8` 검사가 `padding/margin/gap` 이 8의 배수인지 직접 검사 |
| CS1~CS5 | 해당 없음 | 상담사 진행 그리드. FH06 대기실 명단(최대 12명)은 새 규칙(F5) 대상 |
| MS1 오프라인 컬럼 구조 | 해당 없음 | 온·오프 화면 구조가 의도적으로 다름(FM07 BGM 카드 vs 장소 카드) |
| MS2 6지표 격자 | 해당 없음 | - |
| MS3 전체 화면 정중앙 | **그대로** | FM08·FM09·FM10·FH10 풀스크린 카드 |

**새 규칙이 필요한 부분**(시안 측정 도구 `designs/class-flow-redesign/tools/member-b-measure.mjs` 에 이미 구현된 검사 포팅):

| 신규 ID(제안) | 내용 | 시안 도구 근거 |
|---|---|---|
| F1 하단 CTA 위치 고정 | 마법사 단계가 바뀌어도 `fl-foot` 주 버튼의 박스(x·y·w·h)가 ±2px 이내(P11 `stability.mjs` 의 사전 흐름판) | 시안 S1 "하단 주 버튼 Δ0", `stability.mjs:1-6` 방식 |
| F2 진행 점 | 점 개수 = 단계 수(온라인 5·오프라인 4·밴드 없음 −1), 가운데 정렬, 완료·현재 구분 | 시안 인덱스 설명 `member-b.html:552` |
| F3 시트 내 중첩 스크롤 0 | 시트 본문·시트 내부 요소의 `scrollHeight>clientHeight` 0 | `member-b-measure.mjs:45-46` `nested` |
| F4 카피·글리프 검사 | 금지어(세션·수업·참여하기·오픈·`LB `·`1:N`·%·순위·점수·평균·클래스 코드·참여 코드·코드 입력·6자리·게스트·인증 코드·OTP·QR·귀), 이모지·문자 글리프(`✓✕←→‹›•●○×` 포함), 영문 대문자 아이브로우(`LINK BAND` 예외), 소스 정적 검사(`srcGlyph`/`srcBanned`/`srcStale`) | `member-b-measure.mjs:120-127,334-347` |
| F5 상태 의존 요소 | 접촉 불량일 때만 전극 트래커(288×64, LED 3개, 색만, 범례), 아닐 때 미노출 / 내 영상·소리 합친 컴포넌트 | `member-b-measure.mjs:159-185` `trk`·`av` |
| F6 오버레이가 CTA 를 가리지 않음 | `started` 시트·권한 배너가 푸터 주 버튼을 가리지 않거나 시트가 푸터를 포함해 inert | P13 확장(`lib.mjs:541-550` 의 오버레이 가림 검사 방식) |

기존 `fit.mjs` 의 `P5`(호흡 지시 문구 0)는 사전 흐름에서도 유지해 무해하나, P9(코랄 0)는 `NO_CORAL_IDS`(`lib.mjs:45`)를 사전 흐름용으로 새로 정의해야 한다(접촉 불량·권한 거부는 코랄이 정상).

### 3-5. `fit.mjs` 인자·출력, 하니스의 prod 포함

- 사용: `node e2e/class-player/fit.mjs --role=member|host [--base=URL] [--ids=M01,M02] [--reach=false] [--out=파일]`(`fit.mjs:1-16`). 기본 베이스 `BASE_URL || http://localhost:5175`(`lib.mjs:100`), 기본 출력 `e2e/class-player/out/<role>-fit.txt`(`runCli` `lib.mjs:719-723`, `out/` 는 `e2e/class-player/.gitignore:2` 로 무시).
- 출력 형식: 제목·대상·뷰포트·총 검사 수 → `위반 N건 / 전체 M건` → 미등록 건너뜀 목록 → 규칙별 위반 건수 → 뷰포트별 위반 건수 → `FAIL | 케이스 | 뷰포트 | 규칙 | 측정값` 목록 → 전체 일람표(`formatReport` `lib.mjs:693-711`). 위반이 있으면 종료 코드 1(`:744`), 등록 케이스가 0건이면 2(`:729-732`).
- **prod 번들 포함(SDD-208 R12, `plan.md:523`)의 현재 상태**: `App.tsx:61` 이 `lazy(() => import('./pages/design/ClassPlayerCasesPage'))`, `:203` 이 `<Route path="/design/class-player">` 를 **무가드·무조건**으로 등록한다. `import.meta.env.DEV/MODE` 분기가 없다(`App.tsx` 에서 `import.meta.env` 검색 0건). dev 배포가 `npm run build`(production 모드, `deploy-dev.yml:45`)를 실행하므로 lazy 청크가 dev 서버에 배포된다(페이지를 열기 전에는 로드되지 않음). 같은 `/design/*` 6개 라우트(`App.tsx:197-202`)가 선례로 같이 무가드다. 저장소의 `frontend/dist`(git 무시, 2026-10-16 18:04 빌드)에는 하니스 청크가 없는데 이는 하니스 커밋(`218a5e24`, 21:36) 이전 빌드라서이고 현재 배포물에 대한 증거는 아니다 — 이번 조사에서 빌드는 실행하지 않았다.
- 노출 내용: 픽스처의 한글 샘플 데이터뿐이며 인증·개인정보 없음(SDD-208 R12 가 확인 필요로 남긴 항목은 픽스처가 `lib/class/fixtures/*.ts` 에 정적 값만 있음을 읽어 확인).

## 4. 시안 `flow-base.css` · 토큰 · 접두사

### 4-1. `flow-base.css`(104줄) 구조

- 헤더 주석 `flow-base.css:1-3`: `tokens.css` 를 `<link>` 로 먼저 불러오고(`../class-player-redesign/tokens.css`), 이 파일은 "Supervisor 소유, 워커 수정 금지", 화면 전용은 `.w-` 접두.
- `:root` 에 새 변수(`:5-13`): `--sp-1..6`(8~48px), `--col-w:640px`, `--ok:#7DE3C8`, `--warn:#E8B4A0`, `--warn-bg`, `--ink*`, `--shell-bg/card/line`.
- 몰입형 `fl-*`(`:15-84`): `fl-root`·`fl-backdrop`·`fl-layer`·`fl-top`(`96px 1fr 96px`, 56px)·`fl-iconbtn`·`fl-body`·`fl-col`·`fl-foot`·`fl-card`(+`strong`/`sm`)·`fl-sheet`·`fl-h1/h2/sub/note/label/num`·`fl-btn`(`primary/soft/ghost/danger/block`, 48px pill)·`fl-chip`(`ok/warn/live`)·`fl-chiprow`·`fl-field/input/codebox/seg/row`·`fl-steps`·`fl-banner`·`fl-scrim`.
- 셸형 `sh-*`(`:86-104`): `sh-root/side/main/head/title/scroll/tabbar/card/hero/btn(line,mute)/chip(live,ok,warn,mute)`. 767px 이하에서 사이드바→탭바(`:95`).
- 제거 대상: `fl-codebox`(`:67-68`, 코드 6칸) — 결정 1 로 코드 입력이 없어진다.

### 4-2. 토큰 이름 대응

| 시안 `class-player-redesign/tokens.css` | 코드 `player-tokens.css` | 비고 |
|---|---|---|
| `--mb-purple/-90/lavender/pale/purple-cream/mint/coral`, `--tx-hi/mid/lo`, `--sheet-bg/-strong/-border`, `--scrim-top/bottom`, `--r-sheet/card/pill`, `--tap`, `--fs-12~56`, `--font`, `--m-*` | **동일 이름·동일 값**(`:5-52`) | `:root` → `.pz-root` 로 스코프만 다름 |
| (없음) | `--caution`, `--coral-bg`, `--pz-pad/top-h/dock-h/col/sheet-w` | 코드 전용(`:12-13,57-62`) |
| 전역 리셋 `* {box-sizing}`·`html,body`·`button`·`.ic`·전역 reduced-motion(`tokens.css`) | `:where(.pz-root)` 스코프 리셋(`:71-74`)·`.pz-root` reduced-motion(`:77-79`) | 앱 전역을 건드리지 않도록 코드는 스코프형 |
| `flow-base.css` 의 `--col-w:640px` | `--pz-col:640px` | 같은 값, 이름만 다름 |
| `--warn:#E8B4A0` | `--mb-coral:#E8B4A0` | 같은 값 |
| `--warn-bg:rgba(232,180,160,.16)` | `--coral-bg` | 같은 값 |
| `--ok:#7DE3C8` | `--m-relax:#7DE3C8`(지표색) | 같은 값이지만 의미가 다르다 — `--mb-mint`(#01F0C8)와도 다름 → 사전 흐름 "정상" 색은 `--ok` 별도 토큰으로 두는 편이 안전 |
| `--sp-1..6`, `--ink*`, `--shell-*` | 없음 | 신규 필요 |

참고: `designs/class-player-redesign/tokens-b.css` 는 라이트 표면 토큰(`--b-page`, `--b-card`, …)의 "B안" 파일이다(`tokens-b.css:1-12`). 사전 흐름 시안 4종은 모두 `tokens.css`(A안)만 import 한다(`member-b.html:8`, `host-b.html:7`, `member-a.html:7`, `host-a.html:7`). B안 채택 여부는 확인하지 못했다.

### 4-3. `pz-*` 통합 vs 별도 접두 — 제안과 근거

**제안: 하이브리드.**
- 루트 요소: `className="pz-root fl-root"`(몰입형) — 토큰·리셋·타이포 방어·reduced-motion 을 `pz-root` 에서 그대로 받는다. `pz-root` 단독으로는 레이아웃을 만들지 않으므로 안전하다(레이아웃은 `.pz-shell` 에 있음).
- 컴포넌트 클래스: 몰입형 공용 `fl-*`, 셸형 `sh-*`, 회원 `fm-*`, 상담사 `fh-*`(시안의 `.w-*` 화면 전용 스타일을 트랙별 파일로 승격).
- 공유 가능한 `pz-*` 컴포넌트(`PlayerSheet`·`PlayerBackdrop`·`NoticeBanner`·`NoticeOverlay`·`IconCircleButton`)는 import 해서 쓴다. `PlayerShell` 은 기본값 유지 prop 확장 후 사용(§2).

근거(확인된 사실만):
1. **선례**: SDD-208 이 이미 3계층 접두(`pz-` 공용 / `mp-` 회원 `member-player.css` / `hp-` 상담사 `host-player.css`)를 쓴다. 사전 흐름도 같은 구조(`fl-` 공용 / `fm-` / `fh-`)로 가면 파일 소유권이 자연히 갈린다.
2. **시안이 정본**: 구현 중 시안과 어긋나면 시안이 정본(spec "정본 문서"). 시안 클래스명을 유지하면 시안 diff·측정 도구(`member-b-measure.mjs` 가 `.fl-body > .fl-col`, `.fl-foot > .fl-col` 등을 직접 선택)를 data 속성만 바꿔 이식하기 쉽다.
3. **충돌 없음**: `src/` 전체에서 `.fl-`·`.sh-`·`.fm-`·`.fh-` 접두 사용처가 없다(검색 0건). `pz-*` 에 시안의 `.fl-btn/.fl-chip/.fl-row` 를 섞으려면 SDD-208 소유의 `player-shared.css`(199줄)를 고쳐야 하고, 이는 완료된 측정 회귀(`class-player-shared.test.tsx`, `selftest.mjs`)를 건드린다.
4. **전역 타이포가 다크 화면을 덮은 이력**: 앱 전역 `mb-tokens.css:187-228` 이 `h1,h2,h3,p` 요소에 색(`--mb-fg`·`--mb-fg-muted`)·크기·자간을 지정한다. 그 때문에 시트 제목·링 숫자·링 제목이 어둡게 보인 결함이 있었고 `a223b92b`(2026-10-16)가 `.pz-root :is(h1,h2,h3,p):not([class]){color:inherit}`·`.pz-root :is(h1,h2,h3,p){font-family:inherit;letter-spacing:normal}`·`.pz-sheet__head h2,.pz-ring__num,.pz-ring__title{color:var(--tx-hi)}` 를 `player-shared.css:8-10` 에 넣었다. 재발 방지로 글자 대비 규칙 PC 가 `fit.mjs` 에 추가됐다(`specs/sdd-208-class-player-redesign/verify-changes.md:21`). 이 방어는 `.pz-root` 안에서만 동작하므로 흐름 화면도 `pz-root` 를 달아야 한다.
   - **③ 구체 위험**: 방어 규칙의 `:not([class])` 때문에 **클래스가 있는 `h1`/`h2` 는 색이 상속되지 않고 앱 전역 `h1`/`h2` 색(`--mb-fg`)을 받는다.** 시안 `.fl-h1`(`flow-base.css:40`)·`.fl-h2`(`:41`)는 색을 지정하지 않는다(시안에는 전역 규칙이 없어 문제가 없었다). 이식 시 `.fl-h1,.fl-h2,.fl-num{color:var(--tx-hi)}` 를 명시해야 한다. `.fl-sub`·`.fl-note`·`.fl-label` 은 색이 있어 안전.
5. **셸형(라이트)은 `.pz-root` 밖**: 셸형 화면(회원 홈·목록·상세, 상담사 목록·상세)은 기존 앱 셸(라이트) 안에 있고 `.pz-root` 가 없다. 그런데 토큰이 `.pz-root` 스코프(`player-tokens.css:3`)라 `sh-*` 클래스가 `--mb-purple`·`--r-card`·`--fs-*`·`--tap` 를 쓰려면 별도 선언이 필요하다 → 셸형 전용 스코프(`.sh-scope` 등)에 필요한 토큰 부분집합 + `--ink*`·`--shell-*` 를 선언. 또 셸형 안의 다크 요소(`sh-hero` 이미지 카드 `flow-base.css:97-99`)는 글자색을 직접 지정한다. 셸형은 `.pz-root` reduced-motion 규칙(`player-tokens.css:77`)도 받지 못하므로 `.sh-scope` 에 같은 `@media (prefers-reduced-motion: reduce)` 를 둔다.
6. **`index.css` 전역 규칙과의 상호작용**: ① 모바일(≤767px)에서 `input:not(...)`·`select`·`textarea` 는 `font-size:16px !important`(`index.css:7-14`) — 시안 `.fl-input`(15px, `flow-base.css:65`)은 모바일에서 16px 로 바뀐다(높이 52px 고정이라 레이아웃 영향은 작음, 측정은 12px 미만만 보므로 통과). ② `body{@apply bg-mb-bg text-mb-fg font-mb-sans}`(`index.css:18`)와 Tailwind preflight 가 버튼·제목 기본값을 리셋 — `.pz-root` 의 `:where()` 리셋(`player-tokens.css:71-74`)이 몰입형 안쪽을 정리. ③ `mb-btn` 등 전역 컴포넌트 클래스는 `fl-btn` 과 이름이 달라 충돌 없음.

### 4-4. 토큰 이식 위치·파일

| 파일(제안) | 내용 |
|---|---|
| `components/class/flow/flow-tokens.css` | `.pz-root, .sh-scope { --sp-1..6; --col-w; --ok; --warn; --warn-bg }`(새 이름만 — `player-tokens.css` 와 겹치지 않음), `.sh-scope { --ink*; --shell-*; 브랜드·형태·타이포 부분집합 }`, `@media (prefers-reduced-motion)` 셸형 규칙 |
| `components/class/flow/shared/flow-shared.css` | `flow-base.css` 이식(`fl-*`·`sh-*`), `:root` → 위 스코프로 이동, `fl-codebox` 삭제, `.fl-h1/h2` 색 명시, `.fl-root` 를 `100vw` 대신 `100%`(스크롤바 폭 이슈 방지, 확인 필요) |
| `components/class/flow/member/member-flow.css`, `host/host-flow.css` | `.w-*` → `fm-*`/`fh-*` |

## 5. 전역 백드롭·reduced-motion

- `PlayerBackdrop`(`PlayerBackdrop.tsx:10-19`)이 `imageSrc` 가 없으면 `FadingImageBackground` 를 렌더한다. `FadingImageBackground.tsx`: 이미지 10장(`/images/background1~10.webp`, `:6-13`), 20초 교차(`:7,65-79`), 초기 이미지 무작위(`useState` 초기화 `:30-32`), **마운트마다 10장 전체 프리로드**(`:51-56`).
- 흐름 화면에 적용하는 방법: ① 마법사 한 번 마운트 + 단계가 바뀌어도 언마운트하지 않는 상위 레이아웃(`FlowShell`)에 백드롭을 둔다 — 단계별로 마운트하면 이미지가 매번 바뀌고 프리로드가 반복된다. ② 시안은 화면별 고정 이미지(`BG` 표)이고 앱은 무작위 교차이므로, 정지 이미지는 `imageSrc` 로 하니스·Design QA 에서만 쓰고 운영은 현행 교차 페이드를 쓰는 안과, 사전 흐름 화면별 고정 이미지로 통일하는 안이 있다(결정이 아니라 plan 판단 — 시안 정본은 화면별 고정이므로 고정이 시안과 같다). 이미지 파일은 시안 5장이 앱 `public/images/` 와 동일(`background8.webp` 바이트 동일 확인).
- 스크림: 시안 2단(`flow-base.css:18` `scrim-top → scrim-bottom`) vs `PlayerBackdrop` 3단(`player-shared.css:32`, 중간 `.10`). 글자 가독성(대비 3:1)은 `fit.mjs` PC 로 측정하므로 재사용 시 PC 를 통과하는지 확인(미측정).
- `prefers-reduced-motion`: `.pz-root` 하위는 전역 규칙이 `animation/transition` 을 끈다(`player-tokens.css:77-79`). `FadingImageBackground` 는 추가로 교차 타이머 자체를 건너뛴다(`:59-63`). 흐름의 스피너(`w-spin`)·단계 점 전환은 `pz-root` 안이면 자동 적용, `sh-*` 는 별도 규칙 필요(§4-3).

## 6. `player-case.ts`·`fixtures/` 구조 재사용과 파일 구조·소유권

### 6-1. 재사용

| 자산 | 재사용 | 사전 흐름 매핑 |
|---|---|---|
| `lib/class/player-case.ts` `deriveBandUi`·`BandUi` | 부분 | FM06c: `idle=off`, `connecting=pending`, `connected=on`, `unsupported`, 접촉 불량=`leadoff`. **L/R 구분이 없다**(`DeviceStatus` 는 단일 `'lead_off'`, `lib/api/session.ts` `DeviceStatus`) → 시안 `leadoffl/leadoffr` 는 `ElectrodeContact{left,right}` 새 필드 필요(A8, I4 범위). `weak/lost/low` 는 사전 흐름에서 쓰지 않음 |
| `CamUi`(`on/off/denied/nodevice/none`) | **그대로** | FM06d `camon/camdenied`, FH05 `cam-off/cam-denied/nodevice` |
| `MicUi`(`on/off/denied/muted/none`) | 확장 필요 | FM06d `micnodev`(장치 없음)·`unsupported` 없음 → `flow-case.ts` 의 `FlowMicUi` 로 확장 |
| `NetUi`·`deriveNetUi`(`NET_DOWN_AFTER_MS`) | 부분 | FM10 `offline`/FH10 `error-network` 은 브라우저 `offline` 이벤트 기반 단일 상태가 필요(`down` 만) |
| `member-player-case.ts`(`MemberCaseInput`·`memberInput(partial)`) | **패턴만** | 시안 토큰(`place`·`mode`·`band`·…) → 입력 객체 → 문구·상태 파생 순수함수라는 구조를 `flow-case.ts` 가 따른다. 필드가 달라 복사 후 확장 |
| `fixtures/member-cases.ts`(`CASE_OVERRIDES` 표 + `render(ctx)` 래퍼) | 패턴만 | 사전 흐름은 `screen→cases[]` 라 위 하니스 계약에 맞는 새 픽스처 |
| `fixtures/__selftest.ts` | 패턴 | 균형 규칙 위반 주입 더미 → 신규 흐름용 `__selftest_flow*` |

### 6-2. 파일 구조 제안과 소유권(두 트랙이 같은 파일을 안 고치게)

```
frontend/src/
  components/class/flow/
    flow-tokens.css                      [F0 공용]
    shared/  FlowShell · FlowTopBar · FlowFooter · FlowCard · FlowButton · FlowChip
             FlowSteps · FlowRow · FlowSegment · FlowField · FlowSheet(PlayerSheet 래퍼)
             FlowStateScreen · MicLevelRing · flow-shared.css                 [F0 공용]
    member/  FM01~FM10 컴포넌트 · member-flow.css(fm-*)                       [회원 트랙]
    host/    FH01~FH10 컴포넌트 · host-flow.css(fh-*)                         [상담사 트랙]
  lib/class/flow/
    flow-harness.ts · flow-case.ts · flow-state.ts                            [F0 공용]
    member-flow-case.ts · host-flow-case.ts                                   [각 트랙]
    fixtures/member-cases.ts · host-cases.ts  (export const flowCases)        [각 트랙]
  pages/design/ClassFlowCasesPage.tsx                                         [F0 공용]
frontend/e2e/class-flow/  lib.mjs · fit.mjs · symmetry.mjs · stability.mjs · shots.mjs   [F0 공용]
frontend/tests/class-flow-*.test.ts(x)   (shared / member-* / host-* / harness)
```

| 충돌 위험 파일 | 소유 |
|---|---|
| `App.tsx`(라우트) | **F0 가 두 하니스·사전 흐름 페이지 라우트를 lazy 스텁으로 선등록**하고 이후 트랙은 건드리지 않는다 |
| `lib/api/session.ts`(타입·API) | F0 단독(여러 조사에서 필드 추가가 겹침) |
| `PlayerSheet.tsx`·`PlayerShell.tsx`·`player-shared.css` | F0 단독, **기본값이 현행 동작인 추가 props 만**(`class-player-shared.test.tsx` 유지) |
| `pages/class-join-page.tsx`·`components/class/ClassWaitingRoom.tsx`·`WaitingForStart.tsx`·`MemberEndScene.tsx` | 회원 트랙 단독 |
| `pages/sessions/ClassPlayerPage.tsx`·`SessionCreatePage.tsx`·`SessionListPage.tsx`·`SessionDetailPage.tsx` | 상담사 트랙 단독 |
| `ClientSession*Page.tsx`·회원 홈 | 회원 트랙 단독(셸형은 `sh-*` 만 import) |

테스트 파일명 규칙: 기존은 `class-player-<대상>.test.ts(x)`(예: `class-player-member-view.test.tsx`, `class-player-shared.test.tsx`)이므로 `class-flow-<대상>.test.ts(x)`. vitest 환경 지정은 파일 첫 줄 `// @vitest-environment jsdom`(예: `class-player-harness.test.tsx:1`).

## 7. 기존 테스트 — 사전 흐름 관련 목록과 처리

프론트 단위(`frontend/tests/`). "갱신" = 신규 컴포넌트·문구에 맞춰 수정, "삭제" = 대상이 사라짐, "유지" = 변경 불필요.

| 파일(테스트 수) | 다루는 것 | 영향 | 처리 |
|---|---|---|---|
| `class-join-waiting.test.ts`(6) | `/join?code=ABC123` 진입, 준비 중 시작·종료·취소 감지, 상태 API 실패 폴백 | 코드 진입 제거·페이지 교체 | 삭제 후 신규 입장 페이지 테스트로 이식(시나리오는 유지) |
| `class-join-waitlist.test.ts`(5) | join 응답 대기열 판별, 5초 `join` 재호출 승격 | 사전 흐름에서 FM08·`getSession` 폴링으로 변경 | 갱신(재호출 단언 → 폴링) |
| `class-waitlist.test.ts`(4) | `isParticipantWaitlisted` | 함수 유지 시 영향 없음 | 유지 |
| `class-waiting-room.test.ts`(446줄) | 닉네임 정리(`:134-153`)·게스트 입장 게이트(`:183,195`)·회원 게이트(`:225`)·마이크/카메라/스피커(`:271-409`)·자동 입장(`:420`)·트랙 정리(`:435`) | 게스트·닉네임 제거, 점검이 FM06d 로 이동 | 닉네임·게스트 테스트 삭제, 기기 점검·자동 입장·정리는 갱신 이식 |
| `class-waiting-room-flow.test.ts`(5) | 설문·밴드·기기 건너뛰기 단계 이동, 대기 왕복 상태 보존, 저장 실패 처리 | 마법사 5단계(+동의 FM06a) | 갱신 |
| `class-waiting-room-band-check.test.ts`(6) | `WaitingRoomBandCheck` 연결·접촉 | FM06c 로 교체(접촉 불량 L/R 추가) | 갱신(연결 로직 단언 유지) |
| `class-waiting-room-presence.test.ts`(217줄) | presence 훅·호스트 인원 TTL | 훅 유지, 대기열 회원 제외 조건 추가 시 갱신 | 유지 + 케이스 추가 |
| `waiting-room-readiness-panel.test.ts`(4) | 호스트 로비 준비 패널·리마인드 | FH06 교체 | 삭제 후 이식(재전송 ack 단언 재사용) |
| `waiting-room-reminder.test.ts`(2) | 리마인드 ack | 재전송 API(S6) 확장 | 유지 |
| `pre-checkin-panel.test.ts`(2) | `PreCheckinPanel`(설문) | FM06b 교체 | 갱신 |
| `waiting-room-checkin.browser.cjs` | 실 라우트 브라우저(`/join?code=…`·by-code 모킹) | 코드 라우트 제거 | 삭제 후 신규 e2e |
| `member-end-scene.test.tsx`(6) | 종료 카드·시트·게스트 "홈으로"·역할별 이동 | 라이트 카드 제거·게스트 제거·신청 1탭 | 갱신 |
| `member-end-duration.test.ts`(4) | `formatEndDuration` | 서버 `ended_at` 기반으로 바뀌면 | 갱신(또는 삭제) |
| `report-email-request-panel.test.tsx`(5) | OTP·게스트 신청 | OTP·게스트 제거(`:60,77,93` 삭제), 회원 신청(`:44`)·참가 정보 없음(`:87`) | 갱신 |
| `self-checkin.test.ts`(299줄) | `subjective_state` 파싱(`:91-130`)·`SelfCheckinPanel` UI | 파싱은 유지, UI 는 시트 재스타일·완료 시 버튼 비활성 | 파싱 유지, UI 갱신 |
| `report-progress.test.ts`(247줄) | 파서(`:98-127`)·레거시 스텝퍼(`:128-188`)·`useReportProgress`(`:189~`) | 신규 단계 목록은 새 컴포넌트 | 유지(기록 화면용 스텝퍼 유지 시) + 신규 테스트 |
| `class-player-member-fullview.test.tsx` | M18~M21 전체 화면 카드(대기열 `:87-115`, 종료 `:116-162`) | `FullCard` 공용화·문구("수업"→"클래스", 대기열 문구) | 갱신 |
| `class-player-host-container.test.tsx` | 종료 후 카드(`:248-260`)·하니스 C17(`:386-410`)·코드 복사(`:370-377`) | 4단계화·코드 제거 | 갱신, 코드 복사 테스트 삭제 |
| `class-player-page-live.test.tsx` | 종료 후 `/record` 이동(`:195-216`)·대기실(open)·세팅(ready) 옛 워크스페이스(`:233-247`) | D6 결정·FH05/FH06 교체 | 갱신 |
| `host-class-workspace.test.tsx`(197줄) | 모니터링 카드·정렬·상세. 대기 상태 BGM 분기(`:174-180`) | 대부분 진행 중/비호스트 모니터 | 유지, BGM 분기만 갱신 |
| `member-session-scene.test.tsx`(3) | 진행 씬 속성·대기열 | 진행 화면(비범위) | 유지 |
| `session-prejoin-theme.test.tsx` | `SessionPreJoinPreview`(세팅 프리뷰) | FH05 교체 | 삭제 또는 갱신 |
| `session-location-editor.test.tsx`·`session-location.test.ts`·`session-reminder.test.ts` | 방식·주소·일정 API | A2(방식 서버 저장)·5분 단위로 payload 변경 가능(상담사 조사 소관) | 유지(영향 확인 필요) |
| `client-report-modal.test.tsx` | `ClientSessionDetailPage` 조회 중·실패(`:77`)·완료 모달 | 오류 풀스크린 템플릿 전환 시 실패 단언 변경 | 갱신(해당 1건) |

E2E: `e2e/full-journey.mjs:187-203`(`내담자 코드 참여 → 대기실 → 명상 화면`, `/join?code=` 직접 진입) 갱신, `e2e/class-player/live.mjs`(회원 `/join?code=` 진입) 갱신, `e2e/explore.mjs:15` SKIP 정규식의 `\/join` 항목은 경로 변경 시 갱신.
백엔드(코드 입장·게스트 제거 시, 상세는 I1·I7): `test_sdd021_session_class_flow.py`(코드 입장·게스트 멱등·대기열 `:285-305`), `test_func_fixes.py:116`, `test_func_fixes_4th.py:65,85`, `test_mb2_low_fixes_4th.py:286` 등 — 이 조사에서 열어 보지 않은 파일은 §9 에 적는다.

## 8. 변경 목록(요약)

### 프론트

| 파일 | 변경 | 규모 |
|---|---|---|
| `components/class/player/shared/PlayerShell.tsx`·`PlayerSheet.tsx`·`player-shared.css` | 기본값 유지 추가 props(`inertDock`, `scrim`, `size`, `dismissible`, 불투명도), 선택 `place` | M |
| `components/class/player/shared/PlayerTopBar.tsx`·`PlayerDock.tsx` | `variant="flow"`·`variant="cards"` 추가 | S |
| 신규 `components/class/flow/shared/*` + `flow-tokens.css` + `flow-shared.css` | §6-2 | L |
| 신규 `lib/class/flow/{flow-harness,flow-case,flow-state}.ts`, 하니스 페이지, `App.tsx` 라우트 | §3-2 | M |
| 신규 `e2e/class-flow/*` | `measureFlowSymmetry`·F1~F6·`caseUrl`·`runCli` | L |
| 기존 테스트 | §7 | M |

### 백엔드

| 항목 | 변경 | 분류 | 기존 데이터 호환 | 필요 테스트 |
|---|---|---|---|---|
| 해당 없음 | I10 은 프론트·측정 자산 조사. 백엔드 변경은 도출되지 않음 | - | - | - |

(재사용 자산 조사 범위에서 백엔드 필수·권장·보류 변경은 **0건**이다.)

**프론트만으로 가능한 대체안**: `PlayerSheet` 확장이 부담이면 사전 흐름 전용 `FlowSheet` 를 `flow/shared/` 에 새로 만들고 `useSheetMode`·`IconCircleButton` 만 재사용(SDD-208 파일 무수정). 이 경우 포커스 복귀·Esc·바깥 클릭 로직(`PlayerSheet.tsx:26-60`)을 복제하게 되므로 확장 쪽을 권장.

## 9. 위험·주의

- **회귀**: `PlayerSheet`/`PlayerShell` 확장은 기본값이 현행 동작이어야 한다. `class-player-shared.test.tsx` 와 하니스 자가 검증(`selftest.mjs`)이 계속 통과해야 한다.
- **전역 타이포 재발**(§4-3 ③): 이식 직후 PC(글자 대비) 규칙을 사전 흐름용 fit 에 넣지 않으면 `.fl-h1` 이 어두운 글자가 되어도 눈으로만 잡힌다.
- **셸형 라이트 토큰**: `.pz-root` 밖에서는 `--mb-purple` 등이 정의되지 않는다. `.sh-scope` 선언을 빠뜨리면 버튼·칩이 투명/기본색이 된다.
- **하니스 prod 포함**: 사전 흐름 하니스를 같은 방식으로 무가드로 두면 dev 에 2번째 `/design/*` 하니스가 생긴다. 시안(`designs/…/*.html`)이 정본이므로 운영에는 필요 없다.
- **측정 뷰포트 변경**: 4개 뷰포트·`SHORT_VIEWPORTS` 는 그대로. FM06 시트가 높이를 넘기는 짧은 뷰포트(390×600)에서의 동작은 시안 측정에 없다(미측정).
- **시안 vs 코드 사이드 시트 기준 불일치**: 회원 시안 1100px, 코드·상담사 시안 1000px(§2) → 시안 정정 또는 코드 분기 확인.

## 10. 사용자 결정 필요

| # | 질문 | 옵션 | 기본값 제안 | 영향 |
|---|---|---|---|---|
| 1 | 사전 흐름 하니스 라우트를 운영(dev 배포) 번들에 포함할지(SDD-208 R12 미해결 항목) | ① 현행 선례 유지(무가드) ② `import.meta.env.DEV` 에서만 등록(dev 배포에서도 제외 — Design QA 는 로컬 vite 로) ③ 무가드 유지 + 별도 환경변수로 제어 | ① | ②는 dev 서버에서 시안 대조 불가. ①은 정적 픽스처만 노출(개인정보 없음, 읽어서 확인) |

(그 외는 구현·구조 판단이라 plan 에서 결정하며 사용자 정책 결정이 아니다. 접두사 하이브리드·소유권 분리 제안은 §4·§6 에 근거를 적었다.)

## 11. 확인하지 못한 것

1. **현재 dev 배포물에 하니스 청크가 있는지**: 코드·워크플로(`App.tsx:61,203`, `deploy-dev.yml:45`)로만 추정했다. 빌드·배포 서버 접근은 하지 않았다(`frontend/dist` 는 하니스 커밋 이전 빌드).
2. **`PlayerBackdrop` 3단 스크림이 시안 글자 대비(PC 3:1)를 통과하는지**: 측정하지 않았다.
3. **시트·카드 실측값**: 하니스를 실행하지 않았다(읽기 전용, dev 서버 기동이 `node_modules/.vite` 에 쓴다).
4. **`SensorTracker` 의 실제 props·크기**(시안 288×64, LED 3개): I4 소관이라 열지 않았다. 사전 흐름 재사용 가능 여부는 I4 결과 필요.
5. **`HostLiveContainer`·`HostTopBar`·`MemberTopBar` 의 상단 바 사용 방식**: `PlayerTopBar` 를 감싸는 트랙별 래퍼의 세부는 열지 않았다.
6. **백엔드 테스트 중 코드 입장·게스트 의존 범위**: `backend/tests/` 전체를 훑지 않았고, 위 4개 파일만 대기열 관련으로 확인(I1·I7 에서 최종 목록).
7. **시안 `tokens-b.css`(B안) 채택 여부**: 문서(`기획B.md`)를 읽지 않았다.
8. **`.fl-root` 의 `100vw` 가 세로 스크롤바가 있는 환경(데스크톱)에서 가로 넘침을 만드는지**: 시안 측정은 `--hide-scrollbars` 로 돌렸다(`member-b-measure.mjs:305`, `lib.mjs:83`). 앱에서는 `100%` 권장이나 실측하지 않았다.

## 다른 조사와의 겹침·충돌

- **I9**: `PlayerSheet` 높이 상한·스크림·`FullScene`/`FullCard` 공용화·`HostEndingCard` 위치가 겹친다. I9 는 이 문서의 `FlowSheet`/`FlowStateScreen` 이름을 기준으로 삼아도 된다.
- **I4(밴드·전극)**: `ElectrodeContact{left,right}` 와 `SensorTracker` 재사용은 I4 결과에 의존.
- **I1/I7(코드 제거)**: §7 의 코드 의존 테스트 목록 최종본은 I1·I7 조사와 합쳐야 한다.
