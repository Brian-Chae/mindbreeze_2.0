# SDD-245 UI 실측 감사 보고서

> 2026-10-25 · 제품 코드 변경 없음 · Stage ①~③ 문서용 감사. 측정값과 통일 제안은 별도다.

## 결론

핵심 원인은 **같은 셸 안에서 다시 적용하는 padding/max-width**, **도메인별 CSS/인라인 클래스의 중복**, **일반 버튼·카드·제목의 공용 스타일 계약 부재**다. 외곽 셸만 바꾸거나 전역 button CSS를 덮어쓰면 해결되지 않는다. 홈 자체도 역할별 차이가 있으므로 회원·상담사 홈을 우선해 토큰을 정의하고 관리자 홈까지 함께 이관하는 방향을 제안한다.

- 기준 코드 `62017dd80f364605a0a8857e8eeba92e048929f6`, 감사 시작 시 `origin/develop`과 차이 0/0.
- 실제 로컬 앱 Vite development mode 빌드, Playwright `chromium.launch({channel:'chrome'})`, Chrome 155.0.8059.85.
- 390×844 / 1440×900, deviceScaleFactor=1, ko-KR, Asia/Seoul. 상담/AI/디자인 경로 플래그를 감사 빌드에서 true로 켜 비공개 경로도 조사했다. 현재 운영 플래그와 같다는 의미는 아니다.
- 94개 App.tsx 경로 선언 + `/app/*` 수동 분기 + 보조 정상/토큰 표본 = **109개 인벤토리 항목, 324개 역할×viewport 캡처**. 인벤토리와 상태 집계는 [coverage-summary.json](coverage-summary.json), 모든 개별 상태는 [coverage.md](coverage.md).
- 플랫폼 관리자 기준 홈은 로그인 이후 실제 진입 `/admin/orgs`. `/admin` 리다이렉트도 별도 측정했다.
- 모든 API는 합성 읽기 응답. auth refresh도 mock. 자동 읽음 처리 등 비GET 시도는 405로 차단했고 로그에 남겼다. 계정·비밀번호·토큰·DB·서버 SSH를 사용하지 않았다. 폰트 CDN의 공개 GET만 allowlist로 받아 로컬 캐시하며 CSS/폰트 URL·SHA256·크기와 loaded FontFace를 JSON에 기록한다.
- 초기 외부 폰트 차단 측정은 최종본으로 쓰지 않는다. 최종 `fixtureRevision:3` 측정은 Pretendard Variable loaded를 확인한다. 존재하는 fontFamily 문자열만으로 실제 로딩을 주장하지 않는다. 소스가 지정한 Inter/Noto Sans KR/Fraunces/JetBrains Mono도 필요한 경우 같은 CDN allowlist로 로드한다.
- 기존 Vitest는 **17 실패 / 2,984 통과**, 272파일 중 8실패. [실패 목록](vitest-baseline.txt). 테스트가 갱신한 SDD-234 산출물은 원복했고 본 감사에 포함하지 않았다.

## 실측 방법과 읽는 법

`build.cjs` → `measure.cjs` → `summarize.py`. 모든 DOM 수치는 `getComputedStyle`·`getBoundingClientRect`에서 추출한다. 단계별 도구와 합성 fixture를 이 폴더에 보존했다. 재실행하면 capture/measurement를 덮어쓰므로 구현 단계는 **별도 after 출력 디렉터리**를 지정하도록 도구를 확장한 뒤 실행한다.

- [page-matrix.md](page-matrix.md): 모든 페이지×역할×폭의 frame x·내부 시작선·max-width·padding·제목 size/weight/y/상단 margin·frame gap과 홈 대비 delta.
- [component-matrix.md](component-matrix.md): 버튼 4종·카드·입력·탭·칩 대표값. [style-differences.md](style-differences.md): padding 4방향·font·색·border·shadow·hover의 차이 항목. 원시 selectors와 기준 elements는 JSON에 보존.
- [section-gap-matrix.md](section-gap-matrix.md): 각 section/article sibling 간 실제 거리와 홈 frame gap 스케일 비교. 의미가 같은 섹션끼리 일대일 매칭한 결과는 아니다. 음수는 겹침/동일 행 후보여서 차이 판정을 유보한다.
- `measurements/*.json`: 전체 버튼/링크 후보, 모든 카드·입력·제목·wrapper·섹션 후보, normal/hover, fontFaces, 미등록 API, 차단한 자동 쓰기 시도.
- `captures/*.png`: 모든 표본의 원래 viewport 캡처. 내부 스크롤 아래 내용의 계산 스타일은 수집하지만 이 viewport PNG만으로 모든 스크롤 위치의 육안 검증을 주장하지 않는다.

**좌표 해석:** 회원 홈 desktop은 셸 padding=0, 내부 `.mh-home` padding=40, frame x=240 → 본문 시작선 x=280이다. 일반 셸은 x=240+padding40 → x=280이다. 셸 padding 0/40의 차이를 그대로 40px 결함이라고 쓰지 않는다. 회원 클래스는 내부 max-width1040으로 중앙 정렬되어 x=320이 되므로 실제 홈 대비 +40px이다. 카드 padding은 외곽 페이지 여백에 합산하지 않는다.

**분류 한계:** 일반 버튼은 후보 height≤64px에서 본문 우선으로 대표를 고른다. primary/secondary/ghost/icon은 색·class·aria 기반 수집 분류이며 기능의 동등성까지 확정하지 않는다. 통계 타일·카드형 링크는 전체 raw controls에는 있지만 일반 버튼 대표에서 제외한다. 홈에 input/tab 등이 없으면 N/A이며 다른 페이지 값을 홈 실측이라고 채우지 않는다. CSS `radius=9999px`의 차이는 실제 곡률 반경 차이가 아니다.

## 불일치 상위 10개

순위는 사용자 체감(이동 시 시작선 변화, 빈번한 컨트롤 차이)와 범용 수정 가능성을 기준으로 선정했다. 단순 최대 delta 순위가 아니다. 서로 다른 용도인 공개 랜딩/몰입 플레이어의 큰 차이는 제외했다. 수치는 **현재 관측**이고 수정 결과가 아니다.

| # | 페이지·역할·viewport | 항목 | 홈 → 현재 | 홈 대비 차이 | 코드 근거 |
|---|---|---|---|---|---|
| 1 | `/app/reports` 회원 390 / 1440 | 본문 시작선 x | 16→32 / 280→312 | **+16 / +32px** | `frontend/src/pages/client/ClientReportListPage.tsx:311`, `ClientShell.tsx:43` |
| 2 | `/app/participation-profile` 회원 390 | 본문 시작선 x | 16→32 | **+16px** | `frontend/src/pages/settings/participation-profile-page.tsx:11` |
| 3 | `/app/classes` 회원 1440 | 본문 x / max-width | 280→320 / 1280→1040 | **+40 / −240px** | `frontend/src/components/class/structure/member-class-views.tsx:36` |
| 4 | `/app/classes/sample-class` 회원 1440 | 본문 시작선 x | 280→320 | **+40px** | 같은 `member-class-views.tsx:36` wrapper |
| 5 | `/classes` 상담사 1440 | 본문 시작선 x | 280→264 | **−16px** | `frontend/src/components/class/structure/structure-shell.css:5` |
| 6 | `/admin/data-center` 플랫폼 390 / 1440 | 본문 시작선 x | 16→30 / 280→304 | **+14 / +24px** | `frontend/src/pages/data-center/data-center.css:3`, `:33` |
| 7 | `/clients/invite` 상담사 390 | 주 CTA 높이 / radius | 홈 hero 48→40 / pill→6px | **높이 −8px**; CSS radius 9999→6 | `frontend/src/pages/clients/ClientInvitePage.tsx:115` |
| 8 | `/clients/invite` 상담사 390 | 카드 radius | 홈 일반 카드20→8 | **−12px** | `frontend/src/pages/clients/ClientInvitePage.tsx:79` |
| 9 | `/org/requests` 상담사 390 | 페이지 제목 size / weight | 22/700→30/300 | **+8px / −400(weight)** | `frontend/src/pages/org/MyRequestsPage.tsx:57` |
| 10 | `/app/classes` 회원 390 | 섹션 stack gap / 카드 padding | 24→20 / 24→20 | **−4 / −4px** | `frontend/src/components/class/structure/member-class-views.tsx:36`, `:58` |

참여 프로필 desktop은 max-width672의 읽기 폭도 함께 작용하여 시작선 x536(홈280 대비+256)이다. 이 전체 차이를 오류로 단정하지 않는다. 내부 읽기 폭은 유지할지 spec 결정 필요에 별도 남겼고, 모바일 이중 padding과 분리했다. 채팅·문서 폭도 같은 원칙을 적용한다.

## 역할별 홈 기준

| 역할 / 홈 | 모바일 본문 시작선 | 데스크톱 본문 시작선 | frame 최대 폭(계산값) | 셸 제목 |
|---|---:|---:|---|---|
| 회원 `/app` | 16 | 280 | 1280px, desktop 내부 padding40 포함 | 22px / 700 / line-height30·33 |
| 상담사 `/dashboard` | 16 | 280 | 모바일1280, desktop1200px + 바깥 gutter40×2 | 동일 |
| 기관 `/dashboard/org` | 16 | 280 | 별도 상한 none | 동일 |
| 플랫폼 `/admin/orgs` | 16 | 280 | 별도 상한 none | 동일 |

일반 카드: 회원·상담사 `.mc-card` radius20, padding24, border1 #E8E2ED, shadow `rgba(53,33,63,.024) 0 2px 8px 0`. 관리자 홈은 radius16 카드도 존재한다. 회원 홈 코드 CTA는 390에서48px/1440에서44px, radius9999, px16, font14/15, weight600. 상담사 hero CTA는48px. 기관 홈 '초대 발송'은42px, 플랫폼 홈 등록 CTA는42.5px로 관리자 홈 자체도 통일이 필요하다.

## 토큰·컴포넌트 코드 감사

[code-audit.md](code-audit.md)에 파일:행과 재현 명령, 페이지 파일별 집계·자체 CSS36개·라우터 전체를 수록했다. [code-counts.json](code-counts.json)은 매치 원문이다.

| 정적 집계 | 전체 비테스트 소스 | pages 폴더 |
|---|---:|---:|
| px-[…] | 5 | 1 |
| rounded-[…] 계열 | 28 | 19 |
| h-[…] (min-h 포함) | 134 | 69 |
| #hex 문자열 | 4,780 | 2,238 |

raw button 894개, 고정 className599개에서 **374종**, 동적 className185개/86종, className 없음110개. 문자열 변종은 실제 시각 변종 수가 아니다. 동일한 시각 스타일도 class 순서/variant에 따라 여러 문자열일 수 있어 AST에서 토큰 정렬·중복 제거 후 집계했다.

- 기존 `design-system/tokens/` 및 generated CSS/Tailwind preset은 존재한다. 전역 Button/Card/Input/Select/Tabs primitive는 없고 도메인 FlowButton/FlowCard가 있다.
- `design-system/build/outputs/css/tokens.base.css:104` radius-lg20과 Tailwind preset mb-lg16처럼 동일 개념 명칭도 어긋난다.
- 셸 기본 padding은 동일해도 `contentPad` override·내부 wrapper가 차이를 만든다. 단일 전역 CSS 교체 대신 PageFrame+용도별 UI 이관이 필요하다.

## 제안·작업 분할

토큰 전체 수치와 근거는 [plan.md](../plan.md)의 '토큰 정본 제안'에 있다. 요약: gutter16/40, frame1280 border-box, 일반 제목22/700, 기본 CTA48/44+pill, 카드20/24, input48/44+radius12, 섹션24. 모바일에서 더 작은 기존 CTA를 정본으로 복제하지 않는다. 탭/입력은 홈에 없는 역할도 있어 채택 제안임을 명시했다.

파일이 겹치지 않는 A 토큰·공통 셸, B 회원·회원 리포트, C 상담사·일반 업무/공개, D 기관·플랫폼·데이터센터 4개 워커. [소유권](task-ownership.json), 20~29 구현 인시 + 독립 검증3~5시간 추정. 로그인 FIX 및 라이브 플레이어 소유 파일은 제외한다. 이 문서는 구현 명령이 아니다.

## 비교 캡처

- [회원 홈 ↔ 리포트 모바일](compare-member-reports-mobile.png)
- [회원 홈 ↔ 클래스 데스크톱](compare-member-classes-desktop.png)
- [회원 홈 ↔ 참여 프로필 모바일](compare-member-profile-mobile.png)
- [플랫폼 홈 ↔ 데이터 센터 모바일](compare-admin-data-mobile.png)
- [상담사 홈 ↔ 회원 초대 모바일](compare-host-invite-mobile.png)

PNG는 원 viewport를 비율 변경 없이 나란히 붙인 HTML을 Chrome으로 캡처했다. 원본은 `captures/`, 배치 HTML은 `compare-*.html`이다.

## 검증 경계와 결정 필요

- 전체 경로를 방문했다는 사실과 모든 업무 상태를 검증했다는 사실은 다르다. 기본 진입·합성 정상/빈상태, 유효 토큰 없음 안내, redirect, role 안내, 시안/플레이어를 구별한다. 실제 dev API/폰/키보드·BLE·라이브 미디어 동작은 검증하지 않았다.
- `/report-view`, `/membership-invite`의 토큰 없는 상태와 합성 query token 있는 보조 표본을 각각 수집했다. 초대 수락·비밀번호 저장·리포트 발송은 수행하지 않았다.
- hover는 대표 4종과 normal 비교를 수집했다. 홈에 없는 variant를 추정하거나 모든 토글/탭/모달·오류 상태를 검사했다고 말하지 않는다. focus/disabled 및 전체 AA는 구현 전 verify의 필수 게이트다.
- 공개 폰트 파일은 /tmp 캐시에 보관하며 커밋하지 않는다. JSON SHA256이 재현 근거다. OS fallback 글꼴이 섞이는 기호/미지원 glyph까지 동일하다고 보장하지 않는다.
- 결정 필요는 [spec.md](../spec.md) 끝 3개: 플레이어 몰입 화면 제외, 관리자 홈까지 같은 토큰 이관, 좁은 내부 읽기 폭 유지. 각 추천안을 제시했으며 질문을 기다리며 이번 감사를 중단하지 않았다.
