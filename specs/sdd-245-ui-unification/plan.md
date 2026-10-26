# 앱 전체 UI 통일화 구현 계획

> **For agentic workers:** 구현 승인 후 `superpowers:subagent-driven-development`로 아래 Task를 실행한다. 이번 턴은 문서·감사만 수행한다.

**Goal:** 화면 정보 구조를 유지하고 역할별 홈에 기반한 공통 스타일 계약으로 페이지 이동 시 시각적 편차를 없앤다.

**Architecture:** 기존 `design-system/tokens/`를 정본으로 정리하고 생성 CSS/Tailwind preset을 같은 값으로 연결한다. AppShell/ClientShell에 공용 PageFrame과 UI primitive를 연결하고 각 페이지의 중복 여백·임의 스타일을 순차 이관한다. 전역 button/div 선택자로 일괄 덮어쓰지 않는다.

**Tech Stack:** 현재 저장소 React 19/TypeScript, Tailwind 3, CSS 변수, Vitest, Playwright Chrome. 의존성 추가 없음.

**Spec:** [spec.md](spec.md), [audit/report.md](audit/report.md). 감사 값은 `audit/measurements/*.json`, 정적 위치는 `audit/code-audit.md`.

## 공통 제약

- 구현 전 Brian의 SDD 방향 승인 필요. 사용자 요청상 이번 턴 구현 금지.
- 정보 구조/문구/API/동작/권한/플레이어 몰입 화면 변경 금지. 로그인 FIX 소유 파일 제외.
- `node_modules` 심볼릭 링크는 그대로 사용하고 커밋하지 않는다. 기존 SDD-234 산출물은 변경하지 않는다.
- 390×844, 1440×900을 주 기준으로 하고 768/1024 경계·1920 최대 폭을 보조 검증한다.
- 토큰 원본 변경→기존 생성기 실행→생성물 diff 검증. 기존 `--mb-*`와 Tailwind alias 관계를 명시하고 새로운 병렬 정본을 만들지 않는다.

## 토큰 정본 제안 — 실측값과 채택값을 분리

회원·상담사 홈에 있는 일반 컨트롤을 우선한다. 관리자 홈도 편차가 있으므로 원래 값을 그대로 고정하지 않는다. 아래 **제안**은 spec 결정 필요 2번의 승인 대상이며 구현 완료 값이 아니다.

| 토큰/용도 | 모바일 제안 | 데스크톱 제안 | 실측 근거·선택 이유 |
|---|---:|---:|---|
| page gutter | 16px | 40px (768~1023:32px) | 390 홈 4역할 16, 1440 홈 콘텐츠 inset 40. 32는 기존 셸 md 단계, 보조 실측 후 확정 |
| page frame max-width | 1280px border-box | 1280px border-box | 회원 `.mh-home` 1280px(내부 gutter 포함), 상담사 `.ch-home` 데스크톱 1200px(외부 gutter 별도). 1280 border-box 안에 40×2를 포함하면 내부 1200으로 동일. 모바일 둘 다1280 선언. 두 겹 padding 금지 |
| page top padding | 16px | 32px | 회원/상담사 홈 content 또는 내부 frame의 실측. 타이틀 헤더는 별도 |
| page title | 22px/700, line-height 30px | 22px/700, line-height 33px | 홈 셸 실측. 모바일 subtitle 유무로 생긴 y 차이는 header variant 내 정렬 |
| section title | 18px/800, 27px | 18px/800, 27px | 회원·상담사 홈 주요 섹션. 상단 hero 제목과 구별 |
| hero title | 현 홈 규모 보존 | 현 홈 규모 보존 | 일반 page-title을 hero/랜딩에 강제하지 않음 |
| section gap | 24px | 24px | 홈 주 grid/stack 실측 및 parity CSS. 내부 소그룹은 12/16px |
| button sm | 44px 이상 | 44px | 홈 링크/유틸리티 44px. 작은 화면의 입력/주 CTA와 구별 |
| button md | 48px | 44px | 회원 홈 코드 CTA 실측 48/44px |
| button lg / hero | 48px | 48px | 상담사 홈 '지금 바로 시작' 실측 48px. 높이 52 선언보다 실제 cascade 48이 우선 |
| button px / font | md 16px / 14px·600 | md 16px / 15px·600 | 회원 홈 코드 CTA. sm은 12px padding, lg는 24px padding **채택 제안**, 길이에 따른 줄바꿈 허용 |
| primary | radius 9999px, #5F0080 / #FFF | 동일 | 홈 코드·새 클래스 CTA. hover #4B0066는 측정 결과와 비교 후 정본화 |
| secondary | radius 12px, #F4EDF8 / #5F0080 | 동일 | 회원 홈 '전체 보기' pill 아닌 12px 버튼. border 1px는 outline modifier에서만 |
| ghost | radius 12px, 투명 / #5F0080 | 동일 | 홈 텍스트 링크는 radius 0도 존재. 12px focus/hover 면을 공용 variant로 제안 |
| icon | 44×44px, radius 9999px | 동일 | 홈 알림 아이콘. 사각 유틸리티는 icon-square modifier radius 12px(홈 carousel) |
| hero inverse modifier | #FFF / #5F0080 | 동일 | 상담사 홈 흰 CTA. primary와 같은 기하, 색상만 반전 |
| card | radius 20px, padding 24px | 동일 | 회원·상담사 홈 `.mc-card` 실측. 소형 내부 panel은 16px padding modifier |
| card border/shadow | 1px #E8E2ED / 0 2px 8px rgba(53,33,63,.024) | 동일 | 홈 일반 카드/패널 실측. hero shadow none 예외 |
| input/select | 48px, radius12, px16, font16 | 44px, radius12, px16, font15 | 관리자 홈 입력 모바일48. 데스크톱 기존 높이 편차는 44로 채택 **제안**. textarea는 min-height만 |
| tab | 44px 이상, radius9999, font14/600 | 44px, font15/600 | 홈에 tab 부재 → 홈 실측값이라고 주장하지 않음. 기존 shell-kit tab+44px 터치 계약을 재사용하는 **제안** |
| chip | 비조작 28px 이상, radius9999, px10, font13/600 | 동일 | 홈 chip 계열 기반 **정규화 제안**. 클릭 chip은 44px 이상 별도 버튼 계약 |

카드형 링크·152px 통계 타일·리스트 행은 button 태그여도 일반 버튼 높이 계약 대상이 아니다. 정상/hover 측정은 실제 요소의 selector·용도를 보존해 비교한다. 색 대비가 불충분하면 토큰 색 조정안을 별도 검토하고 정보 구조나 의미 색은 유지한다.

## 컴포넌트 계약

- `PageFrame({ children, width: 'standard'|'reading'|'form'|'full', className? })`: 외곽 최대 폭·gutter·top padding을 한 곳에서 소유. standard=1280px border-box. reading/form의 **내부** 폭은 기존 페이지 값을 보존하며 외곽 제목 시작선은 standard. full은 채팅/기존 특수 화면의 승인된 예외만.
- `Button({ variant: 'primary'|'secondary'|'ghost'|'icon', size: 'sm'|'md'|'lg', tone?: 'default'|'inverse'|'danger', ...nativeButtonProps })`: native disabled/type/aria/ref 유지. icon에 aria-label 필수, color-only 의미 전달 금지. 링크는 `ButtonLink`가 동일 class 생성기를 사용하고 `<button><a>` 중첩 금지.
- `Card({ padding: 'default'|'compact'|'none', children, ...nativeProps })`: radius/border/shadow만 소유. 기존 그리드/행/열/클릭 핸들러는 페이지가 보유.
- `Input`, `Select`, `Textarea`: native 요소 wrapper, onChange/value/ref/aria 보존. 캘린더·시간 wheel의 구조를 바꾸지 않는다.
- `Tabs`, `Chip`, `PageHeading`: 우선 스타일 API만 통일. 기존 role/tab keyboard semantics를 그대로 재사용하고 기능 재작성 금지.
- `audit/style-targets.json`(구현 단계 신규): `{route, role, viewport, selector, semanticKind, expected, tolerance, exceptionReason?}`. 현재 감사 selector는 DOM 위치 기반이므로 새 wrapper 도입 시 안정적인 data-ui/기존 role selector로 명시 매핑한다. 매핑 누락은 실패다.

## Task 분할과 파일 소유권

정확한 기존 파일 목록은 [task-ownership.json](audit/task-ownership.json)의 workers A/B/C/D가 정본이다. 같은 파일은 한 워커만 수정한다. 목록은 수정 가능 범위이며 모두 바꾸라는 뜻이 아니다. API/lib/hooks/stores 및 도메인 동작은 소유 범위 밖이다. 이관 중 필요한 공동 파일은 담당자에게 요청하며 다른 워커가 직접 수정하지 않는다.

| Task / 워커 | 소유 파일군·산출물 | 선행/예상시간 |
|---|---|---|
| T1 / A 토큰·공통 셸 | `design-system/tokens/**`, 생성 outputs, `tailwind.config.cjs`, `index.css`, `mb-tokens.css`, `mobile-foundation.css`, layout/폼/공통 UI, `ClientShell.tsx`, class/structure CSS·wrapper, home-card-parity.css. 신규 `components/ui/*`, `layout/page-frame.tsx` | 먼저 계약 고정, 5~7시간 |
| T2 / B 회원·회원 리포트 | `pages/client/*`, 회원 설정/참여 프로필, `components/client/*`(A 소유 제외), reports/report 컴포넌트. 회원 홈·목록·설정·리포트 스타일 이관 | T1 계약 후, 4~6시간 |
| T3 / C 상담사·공통 업무·일반 공개 | Dashboard, classes/sessions/counseling/clients/records/reports/chat/settings/가입·공개 안내 페이지, dashboard/class/일반 flow/session-summary/chat/settings 컴포넌트. 플레이어·로그인·시안 제외 | T1 계약 후, 7~10시간 |
| T4 / D 기관·플랫폼·데이터 센터 | OrgDashboard/OrgPublic, pages/admin/org/data-center, components/admin/org/data-center. 좁은 테이블 controls도 공통 variant 사용 | T1 계약 후, 4~6시간 |

총 구현 20~29 인시 + 독립 회귀/리뷰 3~5시간. A 완료 후 B/C/D 병행 시 12~17시간 예상(리뷰·보완 포함, 측정 기반 추정이며 약속 아님). 토큰 소유 A는 이후 요청된 값 수정도 단독 수행한다. 감독은 제품 코드를 동시에 수정하지 않고 diff/측정/테스트를 재검증한다.

### T1 상세 체크리스트

- [ ] 기존 토큰 원본→생성 CSS→preset 매핑 표 작성, `radius-lg`의 20px/16px 불일치를 재현하는 계약 테스트 RED.
- [ ] 4개 홈과 대표 중복 inset 페이지에 data-ui selector 계약을 정하고 PageFrame 계산 좌표 RED 검사. 기존 셸와 frame의 padding 중복도 실패 처리.
- [ ] 위 컴포넌트 인터페이스와 토큰 생성물 구현. 로그인 FIX diff 목록을 읽어 해당 파일·간접 영향 확인.
- [ ] `tests/sdd245-ui-primitives.test.tsx`로 native type/disabled/keyboard/aria/ref 보존 검사, `tests/sdd245-token-contract.test.ts`로 CSS/preset 동일 수치 검사 GREEN.
- [ ] 홈 8표본 Chrome 실측과 캡처 검증. 768/1024/1920 max-width·여백 검증 후 계약 동결.

### T2~T4 각 워커 공통 체크리스트

- [ ] 자신의 모든 경로를 감사 인벤토리에 매핑하고 제외/리다이렉트를 확인. 새 테스트 `tests/sdd245-{member,host,admin}-styles.test.tsx` 중 각자 파일만 소유.
- [ ] 실제 편차가 있는 selector의 target assertion RED. 버튼형 카드와 일반 버튼을 구분하고 normal/hover/focus/disabled 표본 지정.
- [ ] 페이지별 한 겹씩 wrapper·공통 primitive로 이관. 레이아웃 순서·목록 column·문구·핸들러 변경 diff가 있으면 반려.
- [ ] 해당 페이지군 계산 스타일 재측정 GREEN, 한글 긴 제목/빈상태/권한 차이/오류/로딩 비교. 원본 가로 넘침이 있더라도 신규 overflow는 허용하지 않음.
- [ ] 각 워커 범위 캡처와 검사 결과를 감독에게 전달. 감독이 같은 Chrome 명령으로 재현한 후 다음 이관 허용.

## Review Focus

1. 390px 긴 버튼 문구·한글 제목: 글자를 잘라 버튼 높이만 맞추지 않는다(T2/T3/T4).
2. 회원/상담사/기관/플랫폼 role gate와 빈 데이터: 권한 없는 메뉴가 노출되거나 오류 화면을 정상 측정으로 통과시키지 않는다(T2/T3/T4).
3. 키보드 tab·disabled·focus: wrapper 도입 후 native 동작/링크 의미가 유지된다(T1 및 각 워커).
4. CSS cascade: mobile !important와 legacy 도메인 규칙이 새 토큰을 덮지 않는다. computedStyle로 확인(T1).
5. 독립 화면: 로그인 FIX·플레이어·채팅·리포트 내용 폭을 일괄 전역 CSS로 훼손하지 않는다(T1/T3).

## 검증·인계

[verify.md](verify.md)를 구현 전에 읽는다. 승인 후 T1→T2/T3/T4→통합 검증→summary 순서. 본 문서 작성으로 구현 승인을 간주하지 않는다. 커밋/푸시 대상은 해당 승인 범위에 한정하고 develop 반영은 DEPLOY 창구로 인계한다.
