# 조사 02 — 세션 생성·수정 API 역할 가드와 client 정상 경로 유무 (SDD-211 Phase 0 항목 3)

> 조사일 2026-10-18 · 읽기 전용(코드 수정·DB/서버/테스트 실행 없음) · 근거는 `파일:줄`(ROOT=`/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0`, `backend/app/` → `app/`, `frontend/src/` → `fe/`).
> 근거 없는 것은 `미확인`. 테스트 관련 판단은 grep·정독(휴리스틱)이며 실행 결과가 아니다.

## 0. 한 줄 결론

- 세션 **생성·수정 계열 6개 라우트가 전부 `get_current_user` 만** 쓴다(역할 검사 0). 서비스 안에도 role 검사가 없다.
- **현재 저장소에서 client(회원) 토큰으로 이 라우트들을 호출하는 정상 경로는 발견되지 않았다**(프론트·e2e·부하테스트·백엔드 테스트·docs 전수). 프론트는 라우트 가드가 이미 `counselor`/`org_admin` 으로 막고 있고, "클래스 신청하기"는 세션 생성이 아니라 **상담사에게 채팅 메시지 전송**이다.
- 그래서 **`counselor`·`org_admin` 허용 가드는 알려진 호출자를 깨지 않는다.** 남는 `미확인`은 (a) 이미 배포된 **구 Capacitor 앱 번들**과 (b) **운영/개발 DB 에 role=client 인 호스트 세션이 이미 있는지** 두 가지다.
- 가드 효과는 "client 가 새로 호스트가 되는 것"을 막는 것이다. **이미 client 가 호스트인 세션이 있다면** 그 세션의 호스트 전용 조작(전이·초대 등)은 가드 대상이 아니어서 계속 가능하다.
- 부수 영향: **`platform_admin` 은 현재 API 로 세션을 만들 수 있는데** `("counselor","org_admin")` 가드는 이를 막는다(알려진 호출자 없음, §4 결정).

---

## 1. 대상 엔드포인트와 현재 Depends

`app/api/v1/session.py`, `router = APIRouter(prefix="/sessions")`(:69). 수정은 **PATCH 가 아니라 PUT** 이다(파일 전체에 `router.patch` 없음).

| 동작 | 메서드·경로 | 라우트 줄 | 현재 Depends(role) | 서비스 | 서비스 안 role 검사 |
|---|---|---|---|---|---|
| 생성 | `POST /sessions` | :86-92 | `get_current_user` (:89) | `session_service.create_session` (`app/services/session_service.py:333`) | 없음 — `host=db.get(User,id)` 후 `require_active_user_org`(:336-339)만 |
| 템플릿 저장(생성 변형) | `POST /sessions` + `is_template=true` | :86 | 동일 | `create_session`→`_create_template`(`:342-343`, 정의 `:475`) | 없음 |
| 수정 | `PUT /sessions/{id}` | :203-210 | `get_current_user` (:207) | `update_session` (`:767`) | 호스트 판정만(`_get_session_as_host`, :768) |
| 삭제 | `DELETE /sessions/{id}` | :213-220 | `get_current_user` | `delete_session` (`:896`) | 호스트 판정만 |
| 복제 | `POST /sessions/{id}/duplicate` | :288-311 | `get_current_user` (:296) | `duplicate_session` (`:568`) | 호스트 판정(:585)만 → 새 호스트 = 요청자 |
| 템플릿 저장 | `POST /sessions/{id}/save-as-template` | :314-331 | `get_current_user` (:322) | `save_as_template` (`:623`) | 호스트 판정(:631)만 |
| 새 실행 | `POST /sessions/{id}/new-run` | :272-282 | `get_current_user` (:275) | `start_new_run` (`:1126`) | 호스트 판정(:1136)만 |
| 상태 전이 | `POST /sessions/{id}/{open,start,end,cancel}` | :251-269 | `get_current_user` (:254) | `transition_status` (`:941`) | 호스트 판정(:945)만 |
| 초대 기반 생성 | 해당 없음 | — | — | — | 세션을 만드는 초대 경로는 없다. `POST /client/invite`(`app/api/v1/client.py:59-74`)는 내담자 연결 초대이며 세션을 만들지 않고, 이미 인라인 `role != "counselor"` → 403 `상담사만 초대할 수 있습니다`(:66-69)를 쓴다 |

세션 행을 생성하는 코드는 `session_service.py:374`(일반), `:480`(템플릿), `:549`(`_clone_session_config`, 복제·템플릿 저장 공용) 3곳뿐이다(`grep "Session(" app`). 이 3곳에 도달하는 라우트는 위 `POST /sessions`·`duplicate`·`save-as-template` 이고 그 외 경로(에이전트·기관·클라이언트 포털 등)에서는 `session_service.create_session|duplicate_session|save_as_template|start_new_run|update_session` 를 호출하지 않는다(`grep` → 호출은 `app/api/v1/session.py:92,210,282,304,326` 5곳뿐).

### 1.1 역할 가드 인프라 — 이미 있다

`app/api/deps.py:75-86` 의 `require_roles(*roles)` 는 이미 존재한다(SDD-015). `get_current_user`(:14-56)는 **매 요청 DB 에서 user 를 읽어** `{"id","role","email","name","org_id"}` 를 반환한다(role 은 JWT 클레임이 아니라 `users.role`, :39-50). 따라서 역할 변경은 즉시 반영된다. 정지(403)·삭제(401)·대기(403) 계정은 이미 여기서 걸러진다(:36-47).

`require_roles` 사용 현황: `reports.py`(`("counselor","org_admin")` 다수, `("counselor",)` :98), `dashboard.py:25`(`org_admin`,`platform_admin`), `onboarding.py:128-204`, `agent_counselor.py:44`(`counselor`), `agent.py:34`(`client`). 세션 라우트(`session.py`)에는 쓰이지 않는다(`grep require_roles app/api/v1/session.py` → 0건).

### 1.2 role 문자열 실제 값

- `users.role` 은 자유 문자열 컬럼(`String(20)`, 주석 `counselor, client, org_admin, platform_admin`; `app/models/user.py:101`). DB CHECK/Enum 은 확인하지 못함(`미확인`).
- 로그인 요청 role 패턴: `^(client|counselor|org_admin|platform_admin)$`(`app/schemas/auth.py:99,156`). 가입 요청 role: `^(counselor|client)$`(:28).
- 소속 membership role: `counselor`/`org_admin` 만(`app/models/user_org_membership.py:27`). 전역 `users.role` 은 "주 소속 미러"여서 **부 소속에서만 org_admin 인 사용자의 전역 role 은 `counselor` 로 남는다**(`backend/tests/test_mb2_auth4_mid_fixes.py:153-160` 주석·단언) → `("counselor","org_admin")` 가드에는 영향 없음.
- 프론트 타입 `UserRole` 에는 `'admin'` 이 더 있다(`fe/lib/api/auth.ts:6`). 백엔드 로그인 패턴(:99)에는 `admin` 이 없으므로 실질 사용되지 않는 값으로 보인다(`미확인`: 백엔드 어디에도 `role == "admin"` 이 없는지는 전수하지 않음).
- 철자: `platform_admin`, `org_admin`, `counselor`, `client`(소문자, 언더스코어). "회원/내담자"는 모두 `client`.

---

## 2. 호출자 전수 (세션 생성·수정·복제·템플릿·새 실행)

### 2.1 프론트엔드 (`frontend/src`)

API 클라이언트: `fe/lib/api/session.ts` — `createSession`(:238-239 `POST /sessions`), `updateSession`(:241-242 `PUT /sessions/{id}`), `duplicateSession`(:254-258), `saveSessionAsTemplate`(:261-264), `createSessionFromTemplate`(:271-274, `duplicateSession` 위임). `new-run` 을 부르는 프론트 코드는 **없다**(`grep "new-run\|newRun" fe` → 0건).

| 호출부 | 줄 | 화면 접근 가드 | 사용 토큰 role |
|---|---|---|---|
| `fe/components/class/flow/host/CreateWizardContainer.tsx` `createSession` | :11,18, `fe/lib/class/flow/host-create-flow.ts:9,90` | `/sessions/new` → `RoleGuard role={['counselor','org_admin']}` (`fe/App.tsx:192`) | counselor / org_admin |
| 같은 파일 `saveSessionAsTemplate` | :11,149 | 위와 동일 | counselor / org_admin |
| `fe/pages/sessions/SessionDetailPage.tsx` `duplicateSession`·`saveSessionAsTemplate` | :10,14,243,258 | `/sessions/:id` → `RoleGuard ['counselor','org_admin']` (`fe/App.tsx:193`) | counselor / org_admin |
| `fe/components/session/session-location-editor.tsx` `updateSession` | :2,23 (`SessionDetailPage.tsx:21,367` 안에서만 렌더) | 상동 | counselor / org_admin |
| `fe/pages/sessions/ClassPlayerPage.tsx` `duplicateSession` | :17,1414 | `/sessions/:id/player` 는 **RoleGuard 없음**(`fe/App.tsx:196`). 그러나 호출은 `if (isHost && (isSetup\|\|isLobby\|\|isCancelled\|\|isEnded))` 블록(:1274-1428) 안의 `onStateAction`. `isHost = session.host_id === currentUserId`(:344) | **호스트 본인의 토큰**(역할은 호스트의 role). 호스트가 client 면 그 client |
| 클라이언트 앱(`/app/*`): `fe/pages/client/*`, `fe/components/client/*` | — | `RoleGuard role="client"` (`fe/App.tsx:166-167`) | client — **세션 생성·수정·복제 호출 없음**. 세션 API 는 `listSessions`(GET)·`useEnterClass`(`POST /sessions/{id}/enter`, `fe/hooks/useEnterClass.ts:61`)·`class-flow.ts` 입장·체크인·EEG 계열만 사용 |
| "클래스 신청하기" | `fe/pages/client/ClientSessionListPage.tsx:7-8,158` (`sendChatMessage`), `ClientHomePage.tsx:396` | client | **상담사에게 채팅 메시지 전송**이지 세션 생성이 아님 — 화면에 `ApplySheet`(`fe/components/class/flow/shell/ApplySheet.tsx`) 만 쓰며 `createSession` import 없음. 기획서도 "현행 신청은 상담사에게 채팅 메시지 전송"으로 기술(`docs/class-session-restructure/기획-상세-회원내클래스.md:100`) |

`/sessions/*` 목록·신규·상세 라우트가 `['counselor','org_admin']` 로 이미 가드(`fe/App.tsx:191-193`)돼 있고, `RoleGuard` 는 역할 불일치 시 `/` 로 리다이렉트한다(`fe/components/auth/RoleGuard.tsx:28-33`, 리다이렉트 :32). **platform_admin 은 이 목록에 없어 UI 로는 세션을 만들 수 없다.**

`ClassPlayerPage` 의 복제 버튼은 호스트용 화면이므로 호스트가 counselor/org_admin 이면 그 토큰으로 호출된다. 호스트가 client 인 레거시 세션이 있다면 그 사용자 토큰으로 호출되는 유일한 프론트 경로가 된다(가드 적용 시 403 — 데이터 존재 여부는 `미확인`).

### 2.2 e2e·스크립트·부하 테스트

| 파일 | 줄 | 호출 | 토큰 |
|---|---|---|---|
| `frontend/e2e/journeys.mjs` | :20-24, :77-80 | `POST /sessions` | `apiLoginFull('counselor')`(:20), `apiLogin('counselor')`(:77) — 내담자 계정은 `participant_ids` 에 id 로만 사용(:21,24) |
| `frontend/e2e/full-journey.mjs` | :170-173 | `POST /sessions` | `counselor()` 토큰(:171) |
| `frontend/e2e/class-player/live.mjs` | :188-191 | `POST /sessions` | `apiLogin('counselor')`(:188) |
| `frontend/e2e/journeys.mjs` | :139-148 | 관리자 API 접근 테스트 | `platform_admin`·`client` 토큰이지만 `/admin/users` 만 호출 — 세션 호출 아님 |
| `backend/scripts/loadtest/loadtest_mb2.py` | :4-5,72-86 | `GET /sessions`(counselor), `POST /sessions/{id}/features`(client) | 세션 생성·수정 없음 |
| `.github/workflows/*.yml`, `scripts/*.sh`, `backend/scripts/` | — | 세션 생성 curl 없음(`grep "POST.*sessions"` → docs 만 히트) | — |
| `backend/*_cron.py` | — | 세션 생성·수정 API 호출 없음. 스위프만 `transition_status` 를 **서비스 직접 호출**(`session_service.py:1106`) — HTTP 가드 무관 | — |

### 2.3 모바일(Capacitor) · 구 앱

- `frontend/capacitor.config.ts` 에 `server.url` 이 **없다**(전체 14줄 중 `webDir: 'dist'`, :6) → 앱은 **번들된 웹 자산**으로 동작한다. 기획서도 "구 앱(Capacitor 번들, 강제 업데이트 없음)"을 전제로 한다(`docs/class-session-restructure/기획.md:67`).
- 현재 저장소의 번들 자산(`frontend/android/app/src/main/assets/public/`)은 `.gitignore` 대상 로컬 빌드물이라(`frontend/android/.gitignore:96`) **배포된 앱 버전을 대표하지 못한다**. 스토어에 나간 과거 번들이 무엇을 호출하는지는 **조사 불가 → `미확인`**.
- 간접 증거: 프론트 `/sessions/new` 의 `RoleGuard(['counselor','org_admin'])` 는 최소 2026-10-05 `d30a689d`(sdd-136 하드닝) 이전부터 존재(`git log -S` 로 확인, 최초 SessionCreatePage 라우트는 가드 없음 `2a55ac95`). client 앱 셸(`/app/*`)에는 세션 생성 UI 가 없다. 그러나 이는 **과거 번들이 client 토큰으로 `POST /sessions` 를 쏘지 않았다는 증명이 아니다.**
- 기획서에 있는 `POST /api/v1/sessions/request`(`docs/MVP_1.5_내담자_앱_기획.md:1028,1321`)는 **백엔드·프론트에 구현이 없다**(`grep "sessions/request" backend/app frontend/src` → 0건) — 계획 문서에만 존재.
- 셀프 트레이닝·클라이언트 주도 예약: 백엔드 API 목록(`app/api/v1/` 디렉터리)에 training/booking 라우터가 없다. `CLAUDE.md` 도 셀프 트레이닝을 MVP3 범위로 둔다 → **현재 호출자 없음**.

### 2.4 백엔드 테스트 (`backend/tests`)

`POST /api/v1/sessions` 리터럴 호출 40건 + 헬퍼(`_create_class`/`_create_group_class`/`_create_session`) 경유 다수. **client 토큰으로 생성·수정 성공을 기대하는 테스트는 발견하지 못했다**(호스트 변수 `host`/`counselor`/`host_auth` 만 헤더로 사용). 세션 생성 헬퍼 중 기본 role 이 `client` 인 `_register` 정의(`test_mb2_test_quality_fixes.py:59`, `test_sdd016_org_admin_onboarding.py:26`)가 있으나, 전자는 호스트를 별도 `_counselor(...)`(:74)로 만들어 쓴다(:277,312,330,914,943). 방법의 한계: **변수 추적 기반 휴리스틱**이라 모든 호출의 토큰 role 을 증명한 것은 아니다 — 가드 적용 후 **전체 `pytest` 실행이 유일한 확정 수단**(`미확인`).

가드 적용 시 영향을 받을 가능성이 있는 패턴(확인된 것만):

| 테스트 | 줄 | 내용 | 가드 후 |
|---|---|---|---|
| `test_session.py` `test_07_타인_수정_삭제_403` | :104-115 | 다른 **상담사**가 PUT·DELETE → 403 | 영향 없음(counselor 는 가드 통과, 이후 호스트 판정 403 `host 상담사만 가능합니다`) |
| `test_sdd095_class_template.py` `test_11_타인_복제_403` | :267-272 | 다른 상담사 복제 → 403 | 영향 없음 |
| `test_sdd028_run_scaling.py` `test_05_new_run은_host만_가능하다` | :137-143 | 다른 상담사 new-run → 403 | `new-run` 에 가드를 걸어도 영향 없음 |
| `test_sdd209_b5b_ownership.py` `test_AZ10_참가자_자격으로_호스트_API_불가` | :205-232 | **client 회원**이 start/open/cancel/invite/live-metrics/livekit-token/참가자삭제 → 403 | 이 목록은 생성·수정 라우트가 아니므로 영향 없음. 단 `transition`(open/start/end/cancel)에 가드를 확대 적용하면 **detail 문구가 바뀌어도 상태코드 403 은 동일** |
| `test_session_chat.py` `test_09_채팅토글_참여자403_...` | :268-278 | client 가 `chat-enabled` → 403 | 동일 |
| 서비스 직접 호출 | `test_sdd075_org_management.py:125,134` 등 `session_service.create_session(str(users[2].id), ...)` | 라우트 우회 | 가드 무관 |

`org_admin` 으로 세션을 만드는 API 테스트는 발견되지 않았다. `platform_admin` 으로 세션을 만드는 API 테스트도 없다(`platform_admin` 은 admin API 테스트에만 등장).

### 2.5 문서

- `docs/MIND_BREEZE_2.0_개발_기획서.md:215` — `POST /sessions` 권한을 **Counselor** 로 명시. 가드는 문서 계약과 일치시키는 방향.
- `docs/MVP_1.5_내담자_앱_기획.md:1028` — `POST /sessions/request`(세션 신청, P1) 계획. **미구현.** 구현 시 별 엔드포인트라 `POST /sessions` 가드와 무관.
- 재설계 문서도 상담 관계 생성을 상담사 전용으로 둔다(`docs/class-session-restructure/기획-상세-상태머신권한.md:223` "상담 관계 생성: 상담사 O, 회원 X(상담 신청은 채팅)").

---

## 3. 403 응답 형식 관례

- 전역 오류 처리: `HTTPException` 은 FastAPI 기본 본문 `{"detail": "<문자열>"}` 로 나간다. `app/main.py:113-125` 는 422(`{"detail": [...]}`)와 처리되지 않은 500 만 재정의하고 403 은 건드리지 않는다.
- **`require_roles` 의 403**: `{"detail": "이 작업을 수행할 권한이 없습니다"}` (`app/api/deps.py:80-83`). 테스트가 이 문구를 고정한다: `backend/tests/test_report.py:245-258`(`test_report_10_자동승인_설정은_상담사만_변경`, client 토큰 → 403 + 문구 단언), `test_report_bulk_actions.py:83-86`(client 토큰 `approve-all` → 403).
- 서비스 내부 호스트 판정 403 은 `host 상담사만 가능합니다`(`session_service.py:748`). 인라인 역할 판정 403 도 있다: `app/api/v1/client.py:66-69` `상담사만 초대할 수 있습니다`, `app/services/chat_service.py:1159` `상담사만 초대 후보를 조회할 수 있습니다`.
- **권장**: 세션 생성·수정 라우트에는 기존 `require_roles("counselor","org_admin")` 를 그대로 쓴다. 신규 문구·형식을 만들 필요가 없고 `reports.py` 와 동일 본문이 된다. 프론트는 이미 client 에게 이 화면을 노출하지 않으므로 UX 문구 변경은 불필요.
- **의존성 순서 주의(일반 FastAPI 동작, 이번에 실행 검증 안 함)**: 가드는 의존성이라 body 검증(422)보다 먼저 403 으로 응답한다고 알려져 있다. 즉 client 가 잘못된 body 를 보내도 422 가 아닌 403. 비로그인은 가드 안의 `get_current_user` 가 401 (`deps.py:19-20`). `test_session.py:59-61`(`test_02_비로그인_세션_생성_401`)는 영향 없음.

---

## 4. 결론 — 차단 가능한 역할

| 역할 | 가드 `("counselor","org_admin")` 적용 시 | 알려진 호출자 | 비고 |
|---|---|---|---|
| `counselor` | 통과 | 프론트 마법사·상세·e2e 전부 | |
| `org_admin` | 통과 | 프론트 라우트 허용(`fe/App.tsx:191-193`) | org_admin 은 호스트가 되어 자기 세션을 만들 수 있다. 타인 세션 수정은 기존 호스트 판정으로 계속 403(`조사/R9-강사모델권한.md:127`) |
| `client` | **403** | **없음**(프론트 UI 없음·e2e 없음·테스트 없음·"신청"은 채팅) | 구 앱 번들은 `미확인` |
| `platform_admin` | **403 (현재는 통과)** | 알려진 호출자 없음(UI 라우트 가드에 없음, e2e 에 세션 호출 없음) | 운영자가 API 로 직접 세션을 만든 이력은 `미확인`. 가드에 `platform_admin` 을 추가하면 현행 유지, 제외하면 동작 변경 → **사용자 결정 필요**(기본값 제안: 기획서대로 제외) |

**남는 `미확인`**
1. 이미 스토어에 배포된 Capacitor 앱 번들(과거 버전)이 client 토큰으로 `POST /sessions`·`PUT /sessions/{id}`·`duplicate` 를 호출하는지 — 번들 접근 불가.
2. `users.role = 'client'` 인 사용자가 `sessions.host_id` 인 세션이 운영/개발 DB 에 존재하는지 — DB 조회 금지. 존재하면 가드가 `PUT`/`duplicate` 를 막지만 전이·초대 등 호스트 전용 조작은 그대로 가능 → **M0 사전 조회(집계 건수만)에 "host 의 role 분포" 1개 쿼리를 추가**할 것을 제안(`SELECT u.role, count(*) FROM sessions s JOIN users u ON u.id=s.host_id GROUP BY 1`, 개인정보 컬럼 미조회).
3. `users.role` DB 제약(CHECK/Enum) 유무 — 모델상 자유 문자열(`app/models/user.py:101`), 마이그레이션 미확인.
4. 백엔드 테스트 전수 영향 — 가드 추가 후 `pytest` 전체 실행으로만 확정(변수 추적 휴리스틱의 한계).
5. 백엔드 어디에도 `role == "admin"` 이 없는지(프론트 `UserRole` 에만 `'admin'` 존재).

### 4.1 가드 적용 범위 제안 (기본값)

- **필수**: `POST /sessions`(:86), `PUT /sessions/{id}`(:203), `POST /sessions/{id}/duplicate`(:288), `POST /sessions/{id}/save-as-template`(:314), `POST /sessions/{id}/new-run`(:272) — "세션 행을 만들거나 호스트가 편집하는" 진입점.
- **선택(Phase 0 비포함 권장)**: `DELETE`·상태 전이·초대 등은 호스트 판정이 이미 막고 있고(client 가 호스트가 될 수 없게 만들면 자연 차단), 문구 변경 위험(`host 상담사만 가능합니다` → `이 작업을 수행할 권한이 없습니다`)을 줄이기 위해 제외.
- 문구 변화: client 가 **타인의** 세션을 수정하려 할 때 현재 403 `host 상담사만 가능합니다` → 가드 후 403 `이 작업을 수행할 권한이 없습니다`(상태코드 동일, detail 만 변경). 이 detail 을 단언하는 기존 테스트는 없다(`test_report.py:123` 은 reports 경로).
- `authorize_session`(조사 01)과의 관계: 역할 가드(전역 role 화이트리스트, 라우트 의존성)와 호스트 판정(세션 소유, 서비스)은 **층이 다르다.** 가드는 `require_roles` 로, 호스트 판정은 `authorize_session` 으로 분리해 구현 순서를 독립시킨다.
- 신규 테스트(verify 게이트용): client 토큰 `POST /sessions`·`PUT`·`duplicate`·`save-as-template`·`new-run` → 403 + `이 작업을 수행할 권한이 없습니다`; platform_admin 결정 반영; org_admin·counselor 정상 201/200; 비로그인 401 유지.
