# SDD-215 Plan — 클래스 읽기·화면 구조 전환

- 상태: Stage ② 설계 완료·검토 요청. 아래 코드는 **승인 후 구현 계획**이며 이번에는 구현하지 않는다.
- 작성일: 2026-10-19 / 기준 체크아웃: SDD-214 완료 후 SDD-215 문서 브랜치
- 기준: [spec.md](spec.md), 구현 전 게이트: [verify.md](verify.md)

## 1. 기술 선택과 실제 기준선

현재 `App.tsx`는 `/sessions`·`/sessions/:id`·`/sessions/new`, 세션 live/player/record, `/app/*`, `/join`, `/class/:sessionId/enter`를 등록한다. 부모 클래스/상담 라우트는 아직 없다. `SidebarNav`·layout/BottomTabBar·client/BottomTabBar가 각각 내비를 갖고 `class`·`chat`·`report`·`notification` 키로 배지를 계산한다. 표시 문구와 키를 분리하고 세 곳 모두 검증한다.

`ClientAppPage`는 상담사 연결이 없으면 연결 화면으로 분기한다. 새 회원 홈·부모 라우트와 구 URL 어댑터는 명시적으로 먼저 등록한다. `/app/*`의 채팅·리포트·알림·프로필·상담사 연결 분기는 유지하되 세션 목록/상세 분기는 새 경로로 통합한다. 기존 회원 상세는 부모 해석 실패 시에만 직접 렌더링하는 제한적 폴백이다. 기존 목록·상세의 동일성/무손실 이관은 요구하지 않는다.

저장소 package.json은 React 19·React Router 7·Vite 8·Vitest 5 계열이다. AGENTS의 일반 스택 설명을 근거로 버전을 바꾸지 않는다. 기존 `apiClient`·인증/오류 처리·훅 방식을 사용하며 TanStack Query 등 새 의존성을 도입하지 않는다. 서버·DB·마이그레이션 변경은 없다.

### 데이터 흐름

```text
현재 인증 컨텍스트
  → 부모 읽기 API wrapper(5종)
  → 명시적 DTO 검증/가시 데이터 adapter
  → 읽기 상태 hook(로딩/성공/빈값/오류/404)
  → CH / MC / CN 페이지
  → 검증된 부모·sessionId로 새 회차 상세/회원 회차 선택
  → 기존 입장·진행·기록 흐름
```

화면이 URL의 부모 ID를 sessionId로 넘기지 않도록 부모/회차 링크 함수를 구분한다. 로그아웃·사용자/역할 전환 시 읽기 캐시를 비우고 요청 취소·응답 세대 검사를 적용한다. 이전 계정 응답이 늦게 도착해 새 화면에 표시되지 않아야 한다.

## 2. 인터페이스·데이터 처리

| 모듈 | 새 인터페이스 설계 | 확정/제약 |
|---|---|---|
| `lib/api/class-structure.ts` | `getClasses`, `getClass`, `getClassSessions`, `getCounseling`, `getCounselingDetail` | 경로 5종 고정. 인자/응답 envelope는 T01 정적 계약 확인 후 타입화 |
| `lib/class-structure/read-model.ts` | `ClassId`, `RelationshipId`, `SessionId`를 구분하는 타입, `ReadState<T>`, `DisplayField<T>` | 새 프론트 타입. 서버 필드라고 주장하지 않음. `any` 금지 |
| 같은 read-model | `DisplayField<T>`는 `value`/`no_data`, 화면 요청은 loading/success/error/not_found | 값 0·false와 누락 분리. 빈 배열은 성공 상태의 별도 표현 |
| `lib/class-structure/adapters.ts` | 호스트/회원 클래스 모델, 상담 일정 모델, 혼합 홈 모델 | 원본 `seq` 유지, 권한 밖 행 복원 금지, 개인 출석/수료 추정 금지 |
| `hooks/use-class-structure.ts` | 목록/상세·회차 로딩, 재시도, 요청 해제 | 상세와 회차는 같은 부모 키로 공유. 목록 N+1 금지 |
| `lib/class-structure/navigation.ts` | 새 부모/회차 URL 및 `resolveSessionRoute`(비동기), 부모·회차 일치 확인 | 구 링크는 해석 어댑터. 호스트 실패는 `/classes`, 회원은 권한 있는 상세만 제한적 폴백 |
| `components/class/structure/read-state.tsx` | 공통 로딩/빈 안내/오류/404/필드 누락 | 사용자에게 개발 용어·서버 원문 오류 미노출 |

T01에서 최종 계약을 확인할 때 필드별 출처·필수/선택·nullable·호스트/회원 차이를 기록한다. 문서 초안이나 DB 스키마를 API 명세로 변환하지 않는다. 필수 ID·권한/상태 계약이 미확인인 화면은 연결하지 않는다. 선택 메타 미제공은 데이터 없음으로 구현할 수 있다. 정기형/다회차 합성 fixtures는 레이아웃 검증용이며 서버 생성 지원의 증거가 아니다.

목록 호출은 화면별 최대 `/classes` 1회, `/counseling` 1회(새로고침·재시도·확인된 페이지 요청 제외). 상세 진입 때만 해당 부모 상세/회차를 요청한다. MC01 다음 일정은 제공된 집계만 사용한다. 서버 검색 미확인 시 현재 로드된 목록에서만 필터링하고 페이지 일부의 개수를 전체 수로 표시하지 않는다.

부모 목록·상세 10개 화면은 GET만 사용한다. CH30/상담 회차 상세의 기존 회차 취소, 새 경로로 재배치한 위저드의 기존 생성·초대, 입장·공유 엔진 동작은 별도 경계다. 기존 API/권한·확인 절차를 재사용하며 새 클래스/관계 쓰기 API는 만들지 않는다. 검증에서는 모든 쓰기·메일을 모의 처리한다. 상담 임시 관계는 가짜 내담자명 없이 ‘상담 일정’으로 표현하고 검증된 상담사명만 사용한다.

기존 `lib/api/session.ts`의 `getSession`은 회차 상세·구 링크 해석에 재사용한다. 코드/참여자/장소는 기존 세션 읽기 계약 그대로이고 출석·멤버십으로 재해석하지 않는다. CH30은 기존 `SessionDetailPage.tsx`를 축소 재구성해 클래스/상담 부모 문맥을 명시적으로 받는다. 보강·강사 변경·복제·삭제·템플릿·참여자 편집 메뉴는 옮기지 않는다. 취소는 기존 `transitionSession` 계약만 재사용한다.

`resolveSessionRoute`는 검증된 부모 문맥이 있으면 가시 회차 집합과 대조하고, 없으면 `getSession` 1건의 확인된 필드를 사용한다. 상담 관계 ID는 `area`로 추측하지 않는다. 확인 불가 시 Spec §5의 역할별 실패 처리를 적용하며 관계 상세 전수 조회는 금지한다. 부모 불일치·404·권한 오류에는 폴백으로 데이터를 보여주지 않는다.

알림에는 비동기 `resolveStructureNotificationTarget`을 가산해 일반 session 대상만 위 해석기를 거친다. AppShell·ClientShell·NotificationCenterPage·ClientNotificationPage가 클릭 시 이를 사용한다. report/chat/직접 입장 이벤트 해석은 재사용한다. 위저드·대시보드·AI 안내·공유 엔진의 나가기/상세 링크도 같은 경로 함수를 쓰며 API URL 문자열은 치환하지 않는다.

위저드 재배치는 컨테이너 경로만 바꾸는 작업이 아니다. CreateWizard·wizard-steps·CreatedScreen 및 host-create-flow의 기본 제목/초대 안내에 영역별 문구 인자를 가산해 terms 사전을 사용한다. 기존 하네스 기본값과 생성 오케스트레이션은 유지하되 `/counseling/new`의 5단계·완료 화면에서 명상 ‘클래스’ 문구가 나오지 않아야 한다.

## 3. SDD-209 재사용과 라우트 통합

| 기존 파일/구조 | 사용 방침 |
|---|---|
| `components/class/flow/shell/ShellFrame.tsx` | 디자인 하네스 전용. production AppShell/ClientShell에 중첩하지 않음 |
| `ClassCard.tsx`, `ClassRow.tsx`, `StatusChip.tsx`, `MethodChips.tsx`, `ShellSheet.tsx` | 기존 props의 의미와 필수 값이 실제 계약에 맞을 때만 import. 값이 없으면 새 읽기 컴포넌트 사용. 재사용하려고 가짜 band/mode/status를 채우지 않음 |
| `shell-data.ts`, `host-shell-data.ts` | 기존 SessionDto 변환 유지. 새 부모 DTO를 억지로 넣지 않음 |
| `HostClassListView`, `HostDetailView`, `MemberHomeView`, `MemberClassListView`, `ClassDetailView` | 구 화면 보존 대상이 아닌 재사용 후보. 새 부모/CH30는 새 구조 컴포넌트로 조합. 공유 엔진·회원 폴백에 필요한 동작만 유지 |
| `shell-kit.css`·기존 시안 토큰 | 시각 기준으로 재사용하되 전역 수정 금지. 신규 CSS는 `.cs-structure` 안에 한정 |
| AppShell/ClientShell | 새 페이지용 opt-in 변형으로 레이아웃 적용. 공통 내비 목적지를 새 경로로 갱신. 입장·플레이어·기록 흐름은 보존하고, 기존 세션 목록·상세·위저드 라우트는 새 경로로 교체(Brian 2026-10-19: 기존 세션은 테스트 데이터, 보존 불필요) |

App.tsx의 신규 페이지는 현재 역할 경계를 따른다. 호스트는 counselor/org_admin, 회원은 client만 진입한다. URL 허용이 조회 권한을 대신하지 않는다. 플랫폼 관리자 권한을 추가하지 않는다. `/app` 홈 → 새 부모/회차 선택 → 구 URL 어댑터 → 나머지 `/app/*` 순으로 구성한다. `/classes/new`·`/counseling/new`를 동적 부모 ID보다 구체적인 경로로 등록하고 위저드 영역·완료/취소 링크를 연결한다. `/clients`는 기존 독립 페이지로 이동한다.

구 `/sessions/:id`는 호스트 이동 어댑터이며 원래 상세를 렌더링하지 않는다. `/app/sessions/:id`는 부모 해석 성공 시 새 부모의 `?session=<id>`로 이동하고, 부모만 미확인일 때 권한을 확인한 기존 회원 상세를 직접 렌더링한다. 이 컴포넌트는 sessionId/복귀 경로를 props로 받아 pathname 재파싱·자기 URL 재이동 루프를 피한다. 401/404는 공통 오류 처리다. 구 파일을 삭제하지 않고 라우트·호출 대상을 교체한다.

## 4. 프론트 파일 소유 표

**이 표는 미래 구현 소유권이며 이번 수정 허용 경로를 넓히지 않는다.** 같은 파일은 정확히 한 트랙만 수정한다. H/M/C 병렬 작업은 D·F의 인터페이스 고정 이후 각자 별도 워크트리에서 수행한다. 공통 파일 변경 요청은 담당자에게 전달하며 다른 워커가 직접 고치지 않는다. 파일 추가 시 표에 먼저 단일 소유자를 등록한다. 기존 파일 이름은 유지하고 새 파일은 kebab-case로 작성한다.

| 트랙/단일 소유자 | 파일(저장소 루트 기준) | 작업 |
|---|---|---|
| D 데이터 담당 | `frontend/src/lib/api/class-structure.ts` | 신규 API wrapper·DTO |
| D | `frontend/src/lib/class-structure/read-model.ts` | 신규 읽기 타입 |
| D | `frontend/src/lib/class-structure/adapters.ts` | 신규 표시 변환 |
| D | `frontend/src/lib/class-structure/navigation.ts` | 신규 링크 생성 |
| D | `frontend/src/hooks/use-class-structure.ts` | 신규 요청 수명 관리 |
| D | `frontend/tests/class-structure-data.test.ts` | API·누락·권한 노출·취소 단위 검증 |
| F 셸·통합 담당 | `frontend/src/App.tsx` | 라우트·RoleGuard 연결 |
| F | `frontend/src/components/layout/SidebarNav.tsx` | 두 영역 IA·키 기반 배지 |
| F | `frontend/src/components/layout/BottomTabBar.tsx` | 호스트 모바일·더보기 |
| F | `frontend/src/components/client/BottomTabBar.tsx` | 회원 모바일·더보기 |
| F | `frontend/src/components/layout/AppShell.tsx` | opt-in 셸 변형·드로어 |
| F | `frontend/src/components/client/ClientShell.tsx` | opt-in 셸 변형·드로어 |
| F | `frontend/src/lib/terms.ts` | 가산 키·영역별 라벨 |
| F | `frontend/src/lib/api/notifications.ts` | 부모 대상·일반 session 알림 새 경로 해석 |
| F | `frontend/src/components/class/structure/structure-shell.tsx` | 공통 셸 어댑터 |
| F | `frontend/src/components/class/structure/structure-shell.css` | 격리된 시각 스타일 |
| F | `frontend/src/components/class/structure/read-state.tsx` | 공통 상태·공개 문구 |
| F | `frontend/tests/class-structure-navigation.test.ts` | 내비·배지·알림·역할 회귀 |
| F | `frontend/tests/terms-guard.test.ts` | 상담 영역 미적용을 가정한 FE-GUARD-07 갱신 |
| F | `frontend/tests/class-flow-shell-terms.test.ts` | 기존 검사 보존·새 영역 경계 확인 |
| F | `frontend/src/pages/sessions/legacy-session-redirect-page.tsx` | 구 URL 해석·회원 폴백, 신규 파일 |
| F | `frontend/src/pages/client/ClientAppPage.tsx` | 구 세션 분기 정리·나머지 탭 유지 |
| F | `frontend/src/components/class/flow/host/CreateWizardContainer.tsx` | 새 경로 영역·완료·취소·뒤로 연결 |
| F | `frontend/src/components/class/flow/host/CreateWizard.tsx` | 영역별 제목·제출 문구 props |
| F | `frontend/src/components/class/flow/host/wizard-steps.tsx` | 5단계 본문·입력 안내 영역별 문구 |
| F | `frontend/src/components/class/flow/host/CreatedScreen.tsx` | 완료·이동 안내 영역별 문구 |
| F | `frontend/src/lib/class/flow/host-create-flow.ts` | 기본 제목·초대 안내 문구만 영역 분리, 생성 계약 불변 |
| F | `frontend/src/pages/notifications/NotificationCenterPage.tsx` | 비동기 알림 클릭 경로 |
| F | `frontend/src/pages/client/ClientNotificationPage.tsx` | 회원 알림 클릭 경로 |
| F | `frontend/src/pages/DashboardPage.tsx` | 목록·생성·상세 링크만 전환 |
| F | `frontend/src/pages/OrgDashboardPage.tsx` | 회차 링크만 전환 |
| F | `frontend/src/components/session/SessionCard.tsx` | 공통 카드 링크 전환 |
| F | `frontend/src/pages/agent/counselor-agent-page.tsx` | 상담사 AI 안내 회차 링크 |
| F | `frontend/src/pages/agent/counselor-agent-utils.ts` | 일정 경로·화이트리스트 전환 |
| F | `frontend/src/pages/class/EntryPage.tsx` | 입장 화면의 목록 복귀 링크만 |
| F | `frontend/src/pages/sessions/ClassPlayerPage.tsx` | 목록/상세/복제 완료 링크만, 진행 엔진 불변 |
| H 호스트 담당 | `frontend/src/pages/classes/host-classes-page.tsx` | CH01 |
| H | `frontend/src/pages/classes/host-class-detail-page.tsx` | CH02·CH03 경로별 탭 |
| H | `frontend/src/pages/sessions/SessionDetailPage.tsx` | CH30·상담 회차 공통 축소 상세, 부모/회차 props·취소 |
| H | `frontend/src/components/class/structure/host-class-views.tsx` | 호스트 표시 컴포넌트 |
| H | `frontend/tests/host-class-structure.test.tsx` | CH 상태·행 이동 검증 |
| M 회원 담당 | `frontend/src/pages/client/member-structure-home-page.tsx` | MC01 |
| M | `frontend/src/pages/client/member-classes-page.tsx` | MC02 |
| M | `frontend/src/pages/client/member-class-detail-page.tsx` | MC03 |
| M | `frontend/src/pages/client/ClientSessionDetailPage.tsx` | 제한적 폴백 props·새 목록 복귀 링크 |
| M | `frontend/src/pages/client/ai-agent-page.tsx` | 입장 실패 시 새 경로 해석 |
| M | `frontend/src/components/class/structure/member-class-views.tsx` | 회원 표시 컴포넌트 |
| M | `frontend/tests/member-class-structure.test.tsx` | MC 혼합/빈/누락 상태 검증 |
| C 상담 담당 | `frontend/src/pages/counseling/counseling-list-page.tsx` | CN01·CN07, 역할은 명시적 props |
| C | `frontend/src/pages/counseling/counseling-detail-page.tsx` | CN02·CN08, 역할은 명시적 props |
| C | `frontend/src/components/class/structure/counseling-views.tsx` | 임시 관계 표시·새 회차/공유 엔진 링크 |
| C | `frontend/tests/counseling-structure.test.tsx` | 타인·본문 미노출·순번 검증 |
| Q 독립 검증 담당 | `frontend/e2e/class-structure/fixtures.ts` | 합성 계약·시계·역할 fixture |
| Q | `frontend/e2e/class-structure/cases.ts` | Verify case manifest |
| Q | `frontend/e2e/class-structure/read.spec.ts` | 읽기/역할/연결 E2E |
| Q | `frontend/e2e/class-structure/visual.spec.ts` | 시안·앱·차이·측정 |
| Q | `frontend/e2e/class-structure/playwright.config.ts` | localhost 전용 4뷰포트·출력 경로 |

기존 `lib/api/session.ts`의 가산 선택 필드와 API는 그대로 소비한다. 소유 파일은 총 57개다. 표의 기존 파일은 명시한 라우팅·상세 축소·영역별 문구 범위만 수정한다. 구 SessionList/ClientHome/ClientSessionList 파일은 삭제하지 않고 새 경로의 진입 대상에서 제외한다. SessionLive/Record, 입장·진행 엔진, class/flow/shell 내부, banned JSON, package/lock, backend, DB/AWS 설정은 변경 대상이 아니다. 다른 링크 발행 파일이 발견되면 단일 소유자를 표에 먼저 추가한다. 광범위 문자열 치환으로 API `/sessions/*`까지 바꾸지 않는다.

문서 담당은 이 폴더의 spec·plan·verify만 소유한다. 후속 summary와 QA 증거 파일은 구현 승인 후 담당/경로를 등록한다. 워커 브랜치명·통합 브랜치는 branch-management 규칙을 따르되 이 문서 PR에서 생성·삭제하지 않는다.

## 5. 실행 순서와 작업별 종료 기준

승인 후 각 작업은 실패하는 핵심 검증 → 최소 구현 → 동일 검증 재실행 순서로 진행한다. 아래는 작은 단위로 분리한 체크리스트이며 아직 수행하지 않았다. 작업별 테스트 파일은 §4의 동일 소유자가 작성한다.

| 작업 | 소유자·선행 | 수행·검증 / 산출 |
|---|---|---|
| T00 | 문서 담당 | U-215-01 승인 기록, 대상 SHA·dirty 상태 확인, 변경 가능 범위 재확인. 승인 전 여기서 중단 |
| T01 | D / T00 | K-01 최종 정적 응답 계약·권한을 확인해 타입/fixtures 기준 확정. 실제 키·nullable·표시 가능 필드 표 작성. 필수 계약 미확인이면 해당 구현 보류 |
| T02 | D / T01 | 5 GET 경로·직렬화·공통 오류 처리 단위 테스트를 먼저 작성, wrapper 구현. 기존 인증 동작 유지 |
| T03 | D / T02 | null≠0·누락 seq·상태 불일치·상담 임시 관계·회원 필드 제외 테스트, 순수 adapter 구현 |
| T04 | D / T03 | 요청 취소·계정 전환·부분 실패·재시도·부모/회차 일치·N+1 방지 테스트, 새 URL/비동기 해석 함수 구현 |
| T05 | F / T01 | 현재 키·라벨·배지·RoleGuard·알림 characterization 검증, terms 키 가산 및 새 내비 모델 반영 |
| T06 | F / T05 | 신규 셸/누락/오류 컴포넌트와 영역별 copy 검사. 공유 입장·진행·기록 화면의 의도하지 않은 레이아웃 회귀 방지 |
| T07 | H / T04·T06 | CH01 빈/누락/검색·필터·카드 링크 테스트 → 목록 구현 |
| T08 | H / T07 | CH02 상태 불일치·CH03 표/타임라인·seq 유지 테스트 → 상세 구현, 쓰기 CTA 0 |
| T08a | H / T08 | CH30·상담 회차 변형: 부모 검증·축소 정보·기존 취소 확인/실패 복구·공유 엔진 연결 테스트 → 상세 재구성 |
| T09 | M / T04·T06 | MC01 두 영역·부분 실패·상담사 미연결 테스트 → 홈 구현 |
| T10 | M / T09 | MC02·MC03 개인 상태 없음/타임라인/회차 선택·회원 폴백 테스트 → 읽기 구현, AI 실패 시 새 경로 연결 |
| T11 | C / T04·T06 | CN01·CN07 빈 목록·임시 관계·내담자 링크 테스트 → 목록 구현 |
| T12 | C / T11 | CN02·CN08 가시 회차·본문 미노출·누락 seq·번호 빈칸 테스트 → 상세 구현 |
| T13 | F / T08a·T10·T12 | Spec §5의 새 경로·구 URL 어댑터·회원 제한 폴백 연결. 위저드 2경로 재배치·완료/취소 및 5단계/완료 문구 영역 분리. 알림 4곳·대시보드·카드·AI·공유 엔진 링크 전환. 루프/부모 불일치/권한·용어 검증 |
| T14 | Q / T13 | Verify의 case×viewport manifest, API 합성 fixture, 외부 네트워크 차단 후 기능·시각 검증 |
| T15 | Q·각 소유자 / T14 | Q가 실패 증거 전달 → 파일 담당자가 수정 → 영향 시나리오 재검증. 새 실패·회귀 0, 시각 차이 승인 |
| T16 | 문서 담당 / T15 | 후속 summary에 변경 파일·실행 결과·기준선 실패·미확인·남은 승인 기록. 구현 PR/최종 리뷰는 별도 승인 범위 |

병렬 구간은 T07~08a(H), T09~10(M), T11~12(C)만이다. 공유 D/F 작업은 먼저 고정하고 Q는 독립 검증한다. 같은 워크트리 동시 수정 금지, 공유 파일은 F/D만 수정한다. 각 트랙은 결과를 통합 담당에게 넘기고 공통 파일을 자체 수정하지 않는다.

## 6. 테스트 실행 계획

이번 문서 작업에서는 아래 명령을 실행하지 않는다. 구현 승인 후 로컬·합성 데이터로 수행하며 dev/prod URL·실제 사용자 계정·실제 BLE·메일 발송을 사용하지 않는다.

```bash
# frontend 디렉토리, 작은 기능 검증은 해당 파일만 지정
npx vitest run tests/class-structure-data.test.ts
npx vitest run tests/class-structure-navigation.test.ts tests/terms-guard.test.ts tests/class-flow-shell-terms.test.ts
npx vitest run tests/host-class-structure.test.tsx tests/member-class-structure.test.tsx tests/counseling-structure.test.tsx
npx playwright test --config=e2e/class-structure/playwright.config.ts
npm run build
npm run lint
npm test
```

Playwright config는 아직 없는 **계획 파일**이다. 로컬 앱·정적 시안 서버만 대상으로 하고 API는 route interception으로 응답한다. 시안은 `designs/` 상위를 루트로 제공해 상대 토큰·이미지가 정상 로드되게 한다. 모든 외부 요청은 실패 처리한다. 세션 진입/읽기는 모의 응답으로 확인하고 실제 세션 생성·종료는 실행하지 않는다.

T00/T01에서 승인된 코드 기준의 관련 기존 테스트를 먼저 실행해 기준선을 확보한다. SDD-214 summary의 frontend 11건 실패는 **과거 기록**이며 현재 동일하다고 단정하지 않는다. 기존 실패가 재현되면 이름·동일 SHA/환경·새 변경 전후 결과를 나누어 보고한다. 새 기능 테스트나 변경으로 생긴 실패는 0이어야 한다. 전체 통과라는 표현은 모든 실행 대상의 실제 결과가 뒷받침할 때만 사용한다.

## 7. 문서 PR 검증·승인

이번에는 첫 줄·참조 경로·화면 ID·case 명·파일 소유 중복·시나리오 추적성·git diff whitespace·변경 경계만 정적으로 검증한다. 이 체크아웃의 CI 설정은 sdd 브랜치 push 및 develop 대상 PR에서 실행된다. dev 배포는 develop push, 운영 배포는 수동 흐름이므로 호출하지 않는다. 기존 CI의 일회성 러너 검사 결과를 조회하되 DB나 운영 서비스에 직접 접속하지 않는다.

CI의 frontend Test와 일부 정보성 단계는 비차단(`continue-on-error`)이므로 job green만으로 단위 테스트 전부 통과라고 보고하지 않는다. 정확한 commit SHA·workflow·job/step 결과·비차단 실패 여부를 확인한다. CI 실패 시 문서 원인만 이 범위에서 수정하고, 코드/환경 원인은 결과와 근거를 보고한다.

U-215-01 승인과 구현 계약 확인, Verify 실행, 사용자 최종 리뷰는 서로 다른 게이트다. 이번 PR의 CI 통과가 어느 게이트도 대신하지 않는다.
