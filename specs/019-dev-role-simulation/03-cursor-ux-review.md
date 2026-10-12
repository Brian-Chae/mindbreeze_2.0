# SDD-019 — UX/프론트 설계 리뷰: 역할 시뮬레이션 패널

> 역할: UX/프론트 설계 리뷰어  
> 근거: `00-research-brief.md`, `LoginPage.tsx`, `ClientLoginPage.tsx`, `resolvePostLoginPath`, `authStore`/`auth.ts`, Vite env 분리(`.env.dev` / `.env.prod`)  
> 범위: 설계만. 코드 수정 없음.

---

## 패널 IA/배치

### 현재 로그인 IA (코드 근거)
`LoginPage.tsx`는 풀블리드 배경 + 중앙 세로 스택이다다.

```
[브랜드 로고/타이틀]
[역할별 헤딩: 상담사 로그인 | 시스템 관리자 로그인]
[이메일/비밀번호 폼]          ← platform_admin 모드에서는 숨김
[또는 구분선]
[Google 로그인]
[카카오(disabled)]
[비밀번호 찾기 / 회원가입]
[기관 계정 안내 문구]
```

`ClientLoginPage`는 별도 라우트(`/login/client`)로 내담자 로그인을 담당한다. Brian 요구는 “로그인화면 아랫쪽”이므로 **1차 마운트 지점은 `LoginPage`**, 단 client 역할 시뮬레이션 검증을 위해 **동일 패널을 `ClientLoginPage`에도 조건부 공유**하는 것을 권고한다(컴포넌트 1개, 페이지 2곳).

### 권고 배치: “본문 아래, 시각적으로 격리된 2단 레이아웃”

```
┌─────────────────────────────────────────────┐
│  (기존) 프로덕션 로그인 카드 영역            │  ← 변경 최소화
│  폼 / Google / 링크                          │
├─────────────────────────────────────────────┤  ← 시각 단절선
│  ░ DEV ONLY ░ 역할 시뮬레이션               │
│  [빠른 역할 시드 4버튼]                      │
│  [사용자 추가 인라인 폼]                     │
│  [사용자 리스트 — 클릭 = 즉시 로그인]        │
└─────────────────────────────────────────────┘
```

| 결정 | 권고 | 이유 |
|------|------|------|
| 위치 | 기존 로그인 블록 **아래**, 같은 세로 스택의 마지막 자식 | Brian 요구와 일치. 기존 CTA를 가리지 않음 |
| 스크롤 | `min-h-screen` 유지, 패널이 길면 **페이지 스크롤 허용** (오버레이/모달 금지) | 모달은 “가짜 로그인” 인지 부하↑, 개발자 플로우에 불필요 |
| 폭 | 본문 폼(`w-[280px]`)보다 넓게 **`w-full max-w-[420px]`~`480px`** | 역할 배지·이메일·상태 한 줄 표시 |
| 수직 리듬 | 본문과 패널 사이 `mt-10` + dashed divider | “실서비스 UI” vs “도구” 분리 |
| z-index | 본문과 동일 `relative z-10` 스택. 플로팅 FAB/사이드바 금지 | 로그인 화면을 대시보드처럼 만들지 않음 |
| `?role=platform_admin` | 패널 **항상 표시**(dev일 때). Google-only 모드여도 시뮬레이션은 독립 | platform_admin 빠른 진입이 핵심 가치 |

### 패널 내부 IA (위에서 아래)

1. **헤더**: `DEV` 칩 + `역할 시뮬레이션` 제목 + 한 줄 경고(“비밀번호 없이 로그인 · prod 미포함”)
2. **퀵 시드 행**: 4역할 원클릭 생성+로그인 (또는 생성만)
3. **추가 폼**: 이름 / 이메일 / 역할 select / [추가] — 선택적으로 [추가 후 즉시 로그인] 토글
4. **필터 칩**: 전체 | platform_admin | org_admin | counselor | client
5. **리스트**: 행 클릭 = 즉시 로그인. 행 우측 보조 액션(삭제)은 아이콘만, 클릭 전파 차단
6. **푸터 유틸**: `목록 새로고침` · `시뮬레이션 유저만 정리`(선택)

### 시각 스타일 제안 (순수 Tailwind, 다크 AI 톤)

기존 로그인은 **흰 pill 입력 + `#5F0080` CTA + 글래스 Google 버튼**이다. 시뮬레이션 패널은 의도적으로 **다른 시각 언어**를 쓴다.

```
컨테이너:
  rounded-2xl border border-cyan-400/20 bg-slate-950/85
  backdrop-blur-md shadow-[0_0_0_1px_rgba(34,211,238,0.08)]
  p-4 text-slate-100

헤더 칩:
  inline-flex items-center rounded px-1.5 py-0.5
  font-mono text-[10px] tracking-widest
  bg-amber-400/15 text-amber-300 border border-amber-400/30
  → "DEV"

구분선:
  border-t border-dashed border-white/15

입력:
  rounded-lg (pill 금지) bg-slate-900/80 border border-slate-700
  text-sm text-slate-100 placeholder:text-slate-500
  focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30

역할 배지 (리스트):
  platform_admin → bg-fuchsia-500/15 text-fuchsia-300
  org_admin      → bg-sky-500/15 text-sky-300
  counselor      → bg-violet-500/15 text-violet-300
  client         → bg-emerald-500/15 text-emerald-300

상태 점:
  active   → bg-emerald-400
  inactive → bg-slate-500
  locked   → bg-red-400

행 hover:
  hover:bg-white/5 cursor-pointer
  클릭 중: opacity-60 + "로그인 중…" 오버레이 텍스트
```

**의도적 대비**: 프로덕션 CTA는 둥근 purple pill, 시뮬레이션은 **각진 다크 + cyan/amber 액센트**. 스샷만 봐도 “이건 개발 도구”로 읽혀야 한다. 브랜드 purple을 패널 CTA에 재사용하지 말 것.

---

## 사용자 추가/리스트 플로우

### A. 사용자 추가

```
[이름*] [이메일*] [역할 ▼]  (□ 추가 후 바로 로그인)
              [추가]
```

| 필드 | 규칙 | UX 메모 |
|------|------|---------|
| 이름 | 필수, 1~50자 | 한글/영문 허용 |
| 이메일 | 필수, 형식 검증 | 기본 자동완성 제안: `{role}.{timestamp}@dev.local` 버튼(선택) |
| 역할 | `platform_admin` / `org_admin` / `counselor` / `client` | 한글 라벨 + 영문 value |
| 추가 후 바로 로그인 | 기본 **ON** (개발자 목적에 부합) | OFF면 리스트에만 append |

**성공 시**
1. 토스트/인라인 success: `생성됨 · {role}` (2초)
2. 리스트 최상단 prepend
3. 토글 ON이면 즉시 `impersonate/login` → `authStore` 세션 세팅 → `resolvePostLoginPath(user, next)` 재사용

**실패 시**
- 이메일 중복: 필드 하단 에러 + 해당 리스트 행 하이라이트 스크롤
- 백엔드 403(비-dev): “시뮬레이션 API가 비활성입니다” — UI도 같이 숨겨야 정상
- 네트워크: 기존 Login 에러 pill과 **다른** 다크 톤 인라인 에러(패널 내부)

**org 의존 역할 (`org_admin`, `counselor`)**
- 생성 시 org 미지정이면 UX상 **숨은 기본 org**를 백엔드가 붙인다고 가정하되, 패널에 `org: Demo Org` 보조 텍스트를 노출해 “왜 대시보드가 비어 있지?” 혼란을 줄인다.
- org 선택 UI는 MVP에서 **생략**(속도 우선). 필요 시 Phase 2로 `org_id` select.

### B. 사용자 리스트

각 행(권고 정보 밀도):

```
● 홍길동
  counselor@dev.local
  [counselor]  active · onboarded
                         [🗑]
```

| 표시 | 출처/의미 |
|------|-----------|
| 이름 | `user.name` |
| 이메일 | `user.email` (mono, truncate) |
| 역할 배지 | `user.role` |
| 상태 | `user.status` (active 등) |
| 온보딩 | `onboarding_completed` → `onboarded` / `needs onboarding` |
| 시뮬레이션 플래그 | `is_simulated` 또는 이메일 도메인/`@dev.local` — 배지 `SIM` (선택) |

**인터랙션**
- **행 전체 클릭** → 즉시 로그인 (확인 모달 없음 — 속도가 목적)
- **삭제 아이콘** → `stopPropagation` + 확인 없이 soft-hide 또는 hard delete(백엔드 정책 따름). 실수 방지로 undo 토스트 3초 권고
- **키보드**: 리스트 `role="listbox"`, 행 `option`, Enter = 로그인
- **로딩**: 클릭한 행만 skeleton/spinner. 전역 로그인 폼 loading과 분리된 `simLoadingUserId` 상태

### C. 즉시 로그인 시퀀스 (프론트)

```
click row
  → setSimLoading(userId)
  → POST /auth/dev/simulate-login { user_id }   // 또는 email
  → authStore.setSession(tokens, user)          // 기존 login과 동일 경로 권고
  → navigate(resolvePostLoginPath(user, next))
  → finally clearSimLoading
```

**중요**: 기존 `login(email, password)` / Google 플로우를 우회하되, **세션 저장·리다이렉트 함수는 공유**한다. 리다이렉트만 새로 짜면 client onboarding 분기(`LoginPage` vs `ClientLoginPage`)가 어긋난다.

`LoginPage`의 `resolvePostLoginPath`를 **모듈로 추출**해 시뮬레이션·일반 로그인·Client 페이지가 공유하도록 설계하는 것을 UX/유지보수 측면에서 권고한다(구현은 별도).

### D. 리스트 데이터 소스

| 옵션 | 평가 |
|------|------|
| A. 시뮬레이션으로 만든 유저만 | ✅ 권고. 노이즈↓, “도구” 정체성 명확 |
| B. DB 전체 유저 | ❌ 운영 데이터 노출·클릭 사고 위험 |
| C. A + 시드 프리셋 4명 고정 | ✅ 권고 보강. 빈 리스트 cold start 해소 |

Cold start: 패널 마운트 시 리스트가 비면 “퀵 시드로 시작” empty state를 4역할 버튼 바로 아래로 둔다.

---

## 역할 전환 UX

목표: **30초 안에 4역할을 왕복**한다.

### 1) 로그인 화면에서의 전환 (1차)

| 패턴 | 동작 | 권고 |
|------|------|------|
| 퀵 시드 4버튼 | `PA` `OA` `CS` `CL` — 없으면 생성 후 로그인, 있으면 해당 역할 대표 계정으로 로그인 | ✅ 최우선 |
| 리스트 필터 + 클릭 | 역할별 계정 여러 개 비교 | ✅ |
| URL `?role=` | 기존 platform_admin 모드 전환용. 시뮬레이션과 **혼동하지 말 것** | 유지하되 패널과 독립 |

퀵 시드 라벨(가독성):

```
[Platform Admin] [Org Admin] [Counselor] [Client]
```

모바일/좁은 폭: 2×2 그리드 `grid grid-cols-2 gap-2`.

### 2) 로그인 이후의 전환 (2차 — 강력 권고)

로그인 화면으로 매번 로그아웃하는 것은 Brian pain의 절반만 해결한다. 역할 UI를 본 뒤 **다시 로그아웃 → 로그인 패널** 루프가 남는다.

권고: **dev 전용 “역할 스위처” floating bar** (로그인 페이지가 아닌 앱 셸)

```
하단 또는 좌하단:
  [SIM] counselor ▾  |  전환: PA · OA · CS · CL  |  로그아웃
```

- `import.meta.env` gating 동일
- 클릭 시 동일 simulate-login API → soft navigate (full reload 최소화)
- **prod 빌드에서 dead-code eliminate**

이 2차 UI 없이 1차 패널만 가면 “역할 오가기” UX는 불완전하다. MVP 스코프에 **최소한 로그아웃 후 패널 재진입이 1클릭**(헤더에 “SIM 로그인으로” 링크)이라도 넣길 권고.

### 3) 역할별 기대 랜딩 (기존 코드와 정합)

| 역할 | 랜딩 | UX 주의 |
|------|------|---------|
| platform_admin | `/admin/orgs` (`next`가 `/admin*`면 존중) | `?role=platform_admin` 없이도 시뮬레이션으로 진입 가능해야 함 |
| org_admin | `/dashboard/org` | org 미연결 시 빈 대시보드 → 생성 시 기본 org 필수 |
| counselor | `/dashboard` | onboarding 미완이면 배너만 뜨는지 확인 |
| client | `/app` 또는 `/onboarding/client` | 시뮬레이션 생성 시 `onboarding_completed` 기본값을 **선택 가능**하게(토글) 하면 양쪽 화면 QA 가능 |

### 4) 전환 피드백

- 전환 직전: 짧은 toast `→ Org Admin으로 전환`
- 전환 후 첫 화면: 기존 Sidebar의 역할 라벨이 바뀌는지가 “성공” 신호 (`SidebarNav` roleLabel)
- 실패 시 로그인 화면 잔류 + 패널 에러 (흰 화면/루프 금지)

---

## dev 전용 노출 gating

### 브리프 쟁점에 대한 UX 측 판정

브리프: “`debug: bool = True`로 충분한가?”

**반박**: `debug` 기본값이 `True`이고 환경 식별자가 없다(`config.py`). UX/프론트만 `import.meta.env.DEV`에 의존하면 **dev API를 가리키는 prod-like 빌드**나 **preview 빌드**에서 패널이 사라지거나, 반대로 staging에 남을 수 있다. **이중 게이트**가 필수다.

### 권고 게이트 매트릭스

| 레이어 | 조건 | 실패 시 동작 |
|--------|------|--------------|
| 1. 빌드 타임 (프론트) | `import.meta.env.MODE !== 'production'` **AND** `import.meta.env.VITE_ENABLE_ROLE_SIM === 'true'` | 패널 컴포넌트 자체가 번들에 포함되지 않도록 dynamic import + dead code 제거 가능하면 이상적. 최소: 렌더 `null` |
| 2. 런타임 (프론트) | 부트 시 `GET /auth/dev/sim/status` → `{ enabled: true }` 확인 후에만 마운트 | API disabled면 패널 미표시 (UI만 남고 403 나는 상태 금지) |
| 3. 서버 (백엔드) | `ENVIRONMENT=development` (또는 `enable_role_simulation=True` **명시 opt-in**, default **False**) | 모든 `/auth/dev/sim*` → 404 권고(403보다 존재 은닉) |
| 4. 배포 | `.env.prod` / 프로덕션 이미지에 `VITE_ENABLE_ROLE_SIM` 미설정, 백엔드 플래그 false | CI 체크: prod 빌드 artifact에 `역할 시뮬레이션` 문자열 검사(선택) |

**UX 노출 규칙**
- prod: DOM에 패널 노드 **0개** (CSS hide 금지 — 실수로 노출·접근성 트리 잔존)
- staging: 기본 OFF, 필요 시 플래그로만 ON
- local `vite` dev: `.env.local`에 `VITE_ENABLE_ROLE_SIM=true` 권장
- 패널 헤더에 항상 `DEV` 칩 — 실수로 staging 켠 경우에도 인지 가능

**하지 말 것**
- `hostname === 'localhost'`만으로 판별 (팀원이 dev 도메인에서 QA 불가)
- `debug=True` 단독 의존
- 쿼리 `?sim=1`로 prod에서도 여는 백도어

### 로그인 폼과의 격리

- 패널은 `<DevRoleSimPanel />` 단일 컴포넌트
- `LoginPage` / `ClientLoginPage` 하단에 `{isRoleSimEnabled && <DevRoleSimPanel />}`
- 일반 폼 state(`email`, `password`, `error`)와 **완전 분리** — 시뮬레이션 에러가 보라색 로그인 에러 pill에 섞이면 안 됨

---

## UX 리스크 및 개선 포인트

1. **뷰포트 붕괴**: 현재 `justify-center` 중앙 정렬 + 패널 추가 시 첫 화면에서 폼이 위로 밀리거나 CTA가 접힘. → `justify-center`를 `justify-start pt-24 pb-16`로 완화하거나, 패널을 접이식(`details`/chevron, 기본 펼침)으로.
2. **Client 로그인 사각지대**: 패널을 `LoginPage`에만 두면 client 랜딩(`/app`) QA 동선이 `/login`→시뮬레이션으로만 가능해 혼란. → 공유 컴포넌트를 `/login/client`에도 배치하거나, 시뮬레이션 후 client는 무조건 `resolvePostLoginPath`로 보낸다고 헤더에 명시.
3. **확인 없는 즉시 로그인**: 빠른 대신 잘못된 행 클릭·삭제 오클릭 위험. → 삭제는 분리 아이콘+undo; 로그인 클릭 하이라이트 150ms 지연은 과함, 대신 hover 링으로 타겟 명확화.
4. **빈 org / 빈 데이터**: org_admin·counselor 전환 후 “깨진 화면”을 버그로 오인. → 생성 응답에 `org_name` 표시, empty dashboard에 dev 전용 힌트는 과할 수 있으니 패널 쪽에 `기본 Demo Org 연결됨` 고지.
5. **온보딩 가드에 막힘**: client/counselor가 `onboarding_completed=false`면 원하는 화면 진입 실패. → 추가 폼에 `온보딩 완료로 생성` 체크(기본 ON for counselor/client 시뮬).
6. **platform_admin 모드와 이중 헤딩**: `?role=platform_admin`일 때 타이틀은 “시스템 관리자”인데 아래 패널에서 counselor를 누르면 인지 불일치. → 시뮬레이션 로그인 성공 시 `next`/`role` 쿼리에 의존하지 말고 **유저 role만**으로 리다이렉트(이미 `resolvePostLoginPath`가 그렇게 동작 — 유지).
7. **리스트에 실유저 혼입**: 전체 유저 리스트면 운영 계정 클릭 사고. → 시뮬레이션 유저만 + `SIM` 배지.
8. **역할 왕복 마찰**: 로그아웃 UI가 깊으면 패널 가치가 반감. → dev 스위처 바 또는 사이드바 하단에 `다른 역할로 전환` 진입점.
9. **시각적 브랜드 오염**: purple pill을 패널에 재사용하면 실사용자/스크린샷에 “정식 기능”으로 오인. → 다크 AI 톤 강제, DEV 칩 고정.
10. **접근성**: 행 클릭만 있고 버튼 role이 없으면 스크린리더가 “텍스트”로 읽음. → `button` 또는 `role="option"` + `aria-label="{name} ({role})로 시뮬레이션 로그인"`.
11. **동시 로딩 경합**: Google 로그인 중 시뮬 클릭 시 세션 덮어쓰기. → `simLoading` 중 본문 OAuth 버튼 disable 및 그 반대.
12. **게이트 실패 UX**: 프론트만 켜지고 API 404면 “고장”으로 보임. → status endpoint로 마운트 가드, 실패 시 패널 자체를 안 그림(에러 배너 최소).

---

## 최종 권고안

1. **`DevRoleSimPanel`을 로그인 본문 아래 격리 배치**하고, 다크 AI 톤(slate-950 + cyan/amber)으로 프로덕션 purple pill UI와 시각 분리한다.
2. **플로우는 “추가(기본: 즉시 로그인)” + “리스트 행 클릭 = 즉시 로그인” + “4역할 퀵 시드”** 3축으로 속도 최적화한다. 확인 모달은 쓰지 않는다.
3. **리다이렉트는 기존 `resolvePostLoginPath`를 단일 소스로 공유**하고, client 온보딩 여부는 생성 옵션으로 통제한다.
4. **gating은 `VITE_ENABLE_ROLE_SIM` + 서버 opt-in(default false) + status 프리플라이트** 삼중. `debug=True` 단독/CSS hide/쿼리 백도어는 금지. prod DOM에 패널 0.
5. **MVP에 “로그인 후 역할 재전환” 진입점**(스위처 바 또는 로그아웃 인접 링크)을 포함하지 않으면 Brian의 “역할별로 빠르게 오가기” 요구를 절반만 충족한다 — 패널과 함께 스코프에 넣을 것을 권고한다.
6. **리스트는 시뮬레이션 유저만**, cold start는 퀵 시드 empty state로 해소한다.

이 설계는 기존 이메일/비밀번호·Google·`?role=platform_admin` 흐름을 수정하지 않고 **하단 패널(+선택적 앱 내 스위처)만 추가**하는 격리 전략과 브리프 목표에 정합한다.
