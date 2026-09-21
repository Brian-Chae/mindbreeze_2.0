# 클래스 입장·시작·종료 프로세스 + 독립형 플레이어 UI 기획

> 작성일: 2026-09-21 · 작성: Claude (기획 브리프: Brian)
> 목표: "입장 단일 버튼 + 클래스 = 가상의 방 + 상태에 따라 화면이 전개되는 독립형 플레이어" 재설계 기획.
> 구현 아님 — 상세 기획서. 모든 현황 서술은 코드 근거(파일:라인) 기반.

---

## 0. 요약 (TL;DR)

- **문제**: "시작"과 "입장" 버튼이 병존하고, 실제 상태 전이는 제3의 화면(라이브 페이지)에서 일어나 상담사가 흐름을 예측할 수 없음. "오픈(대기)" 단계가 상태 머신에 없어 준비 시간(회원 입장·밴드 착용·상태 파악)이 화면 로직으로만 암묵 처리됨.
- **해결**:
  1. 상태 머신에 **`open`(오픈/대기) 상태 추가** — `ready/scheduled → open → in_progress → completed`
  2. 목록·상세의 버튼을 **"입장" 단일 버튼**으로 통일 — 입장하면 상태에 맞는 화면이 자동 전개
  3. 상담사·회원이 **동일한 풀스크린 독립형 플레이어**(`ClassPlayerPage`)를 사용 — 역할·상태에 따라 씬(Scene)과 컨트롤만 달라짐
  4. 오픈·진행중 상태에서 상담사의 **페이지 이탈을 보수적으로 차단**(브라우저 이탈 경고 + 라우터 블로커 + 2단계 종료 확인)
- **DB 마이그레이션**: `Session.status`는 `String(20)` + CHECK 제약 없음 → **`open` 값 추가는 마이그레이션 불필요**. 오픈 시각 기록용 `opened_at` 컬럼 추가 시에만 add_column 1건(권장).

---

## 1. 현황 분석 (코드 근거)

### 1.1 백엔드 상태 머신 — "오픈(대기)" 상태 없음

- `backend/app/services/session_service.py:24-30` `TRANSITIONS`:

  | 액션 | 허용 출발 상태 | 도착 상태 |
  |---|---|---|
  | `start` | `ready`, `scheduled` | `in_progress` |
  | `pause` | `in_progress` | `paused` |
  | `resume` | `paused` | `in_progress` |
  | `end` | `in_progress`, `paused` | `completed` |
  | `cancel` | `ready`, `scheduled`, `in_progress`, `paused` | `cancelled` |

- `ready/scheduled → in_progress` **직행**. 오픈/대기 단계 없음.
- `ACTIVE_STATUSES = ("ready", "scheduled", "in_progress", "paused")` (`session_service.py:22`)
- `transition_status()` (`session_service.py:335-392`):
  - `start` 시 그룹 수업은 대기열 제외 참가자 ≥ 1 필요 (SDD-021, `:345-351`)
  - `start` 시 `started_at` 최초 1회 기록 (`:355-356`)
  - `end` 시 `ended_at` 기록 + 오디오/비디오 finalize + 상담사·회원 리포트 자동 생성 (SDD-084/086, `:364-387`)
  - 모든 전이마다 `state_version` +1 (SDD-026) 후 WS `session_state_changed` 발행 (`:360`, `:390`, `_notify_session_state :421-436`)
- `Session.status`: `String(20)`, default `"scheduled"` (`backend/app/models/session.py:26`). **Enum 아님.**
- Alembic 전체에서 `sessions.status`에 대한 CheckConstraint **없음** (CHECK 존재 파일은 `e036a0000007`의 data_exports, `e036a0000008`의 signup_applications 뿐) → **status 값 추가는 DB 변경 불필요.**
- 녹음/녹화 시작 가드: `audio_service.py:55`, `video_service.py:62` — `status in ("scheduled", "in_progress", "paused")` 일 때만 시작 허용.
- EEG Raw 업로드(`eeg_raw_service.py`)는 참가자 소유 검증만 하고 **세션 status를 확인하지 않음** → 참가자가 조인하고 밴드를 연결하면 상태와 무관하게 EEG가 흘러들어옴. `eeg_query.py`·`report_service.py`에는 `started_at/ended_at` 기반 구간 필터가 없음 → **대기 중 수집 EEG가 리포트 집계에 섞일 수 있음** (→ §3.3 결정 포인트).
- 회원 코드 참여 가드: `join_session_by_code()` — `completed/cancelled`만 차단 (`session_service.py:696`) → **ready 상태에서도 코드로는 이미 입장 가능.**

### 1.2 "시작"과 "입장" 버튼 현황 — 혼란의 근원

| 위치 | 버튼 | 실제 동작 | 근거 |
|---|---|---|---|
| 클래스 목록 | **"시작"** (ready/scheduled일 때만) | `navigate(/sessions/:id/live)` — **상태 전이 없음, 이동만** | `SessionListTable.tsx:76-84` |
| 클래스 목록 | **"입장"** (항상) | in_progress/paused → `/live`, 그 외 → `/sessions/:id` 상세 | `SessionListTable.tsx:85-97` |
| 세션 상세 | **"시작"** (ACTIONS_BY_STATUS) | 역시 `navigate(/live)`만 (SDD-083 주석: "프리뷰에서 확인 후 시작") | `SessionDetailPage.tsx:25-32, 84-88` |
| 라이브 페이지 | **"클래스 시작"** (isPreStart) | 여기서 비로소 `transitionSession(id, 'start')` | `SessionLivePage.tsx:700-709, 408-431` |
| 라이브 페이지 | **"클래스 종료"** (isRunning) | `window.confirm` 1회 → `end` 전이 | `SessionLivePage.tsx:504-528` |

- 정리하면 **"시작" 버튼도 사실 "입장"이다** — 두 버튼 모두 이동만 하고, 진짜 시작은 라이브 페이지 안의 세 번째 버튼이 담당. 목록에서는 같은 행에 "시작"/"입장"이 나란히 노출되어 어떤 것이 무엇을 하는지 알 수 없음 (Brian 지적과 정확히 일치).
- 라이브 페이지 진입 시 ready/scheduled면 `SessionPreJoinPreview`(카메라/마이크 프리뷰, SDD-083/085)가 뜨고, 프리뷰의 "시작" 확정이 `start` 전이 + (동의 후) 녹음·녹화 개시로 이어짐 (`SessionLivePage.tsx:755-767, 434-437`).

### 1.3 화면 구조 현황 — 상담사와 회원이 완전히 별개 UI

- **상담사**: `SessionLivePage.tsx` — `AppShell`(관리 콘솔 레이아웃, 상단바+타이틀) **내부**에 렌더 (`:725-730`). 풀스크린 아님. 구성: 코드 배너(`SessionCodeBanner`) → 프리조인 프리뷰 → 셀프뷰(`SessionHostVideoView`) → 모니터 요약(`SessionMonitorSummary`) → 참가자 카드 그리드/테이블(`SessionParticipantCardGrid`/`SessionMonitorTable`) → 호스트 밴드 → 녹음/화상/마커(접기).
- **회원(게스트·로그인 공통, 코드 경로)**: `class-join-page.tsx` — 자체 step 머신 `code → details → waiting(welcome→guide→wait) → meditation → complete` (`:21-23`). waiting/meditation은 **검정 풀블리드 풀스크린 immersive** (`:358-379, 398-452`), Wake Lock 사용 (`:147`). 3~4초 폴링으로 `in_progress` 감지 시 자동으로 명상 화면 전환 (`:157-259`).
- **회원(로그인, 세션 상세 경로)**: `ClientSessionDetailPage.tsx` — `in_progress`일 때만 "세션 입장하기" 활성, **ready/scheduled면 비활성**("아직 시작되지 않음", `:95-118`). 코드 직접 입력 경로는 ready에서도 입장 가능하므로 **경로 간 정책 불일치**. Brian이 원하는 "오픈 상태에 회원이 먼저 들어와 밴드를 착용"하는 흐름과 정면 모순.
- 상태 라벨·뱃지 매핑이 3곳에 중복: `StatusBadge.tsx:5-21`, `class-join-page.tsx:32-39`, `ClientSessionDetailPage.tsx:10-33`. 프론트 상태 타입: `SessionStatus` union (`lib/api/session.ts:6`).

### 1.4 이탈 처리 현황 — 무방비

- `beforeunload`·`useBlocker` 사용처 **0건** (frontend/src 전체 grep 결과 없음).
- 진행중 상태에서 상담사가 새로고침·뒤로가기·탭 닫기를 해도 아무 경고 없음. 세션은 `in_progress`로 방치되고, 녹음·녹화는 클라이언트 MediaRecorder가 죽으며 중단(3초 청크 업로드 방식이라 기존 청크는 서버에 보존 — `useVideoRecorder.ts:10-13`, `useAudioRecorder.ts` 동일 패턴)되지만 서버에는 stop/finalize 신호가 가지 않음.
- 유일한 확인 절차는 종료 버튼의 `window.confirm` 1회 (`SessionLivePage.tsx:506`).

---

## 2. 클래스 수명주기 재정의 (상태 머신 확장)

### 2.1 새 상태 머신

```
ready/scheduled ──(open)──▶ open ──(start)──▶ in_progress ⇄(pause/resume) paused
      │                      │                     │
      └────────(cancel)──────┴─────(cancel)────────┤
                                                   └──(end)──▶ completed
```

- `TRANSITIONS` 변경안 (`session_service.py`):

  | 액션 | 허용 출발 상태 | 도착 상태 | 비고 |
  |---|---|---|---|
  | **`open`** (신규) | `ready`, `scheduled` | **`open`** | 상담사 미디어 세팅 완료 후 "클래스 오픈" |
  | `start` | **`open`** (+과도기: `ready`, `scheduled` 유지) | `in_progress` | 그룹 참가자 ≥1 가드 유지 |
  | `pause` / `resume` | 기존 동일 | 기존 동일 | |
  | `end` | `in_progress`, `paused` | `completed` | **open에서는 end 불가** (Brian: "종료는 진행중일 때만") |
  | `cancel` | `ready`, `scheduled`, **`open`**, `in_progress`, `paused` | `cancelled` | open 상태의 정상 퇴로는 cancel(=클래스 닫기) |

- `start`의 출발 상태에 `ready/scheduled`를 과도기 동안 남기는 이유: 구버전 클라이언트·기존 테스트·1:1 즉석 세션의 하위 호환. 플레이어 UI가 전면 적용되면 `open`만 남기고 제거(§7 Phase C).
- `ACTIVE_STATUSES`에 `open` 추가 (`session_service.py:22` — 중복 개설 방지·목록 필터에 사용됨).
- `state_version` 증가·WS `session_state_changed` 발행은 기존 로직 그대로 `open` 전이에도 적용됨 (transition_status 공통 경로).

### 2.2 상태별 허용 매트릭스

| | ready/scheduled | **open (오픈/대기)** | in_progress | paused | completed |
|---|---|---|---|---|---|
| 상담사 입장(플레이어) | O (세팅 씬) | O (대기 씬) | O (라이브 씬) | O | O (종료 씬, 읽기 전용) |
| 회원 입장(코드/상세) | **X (변경)** — "아직 오픈 전" 안내 | **O** — 대기실 입장, 밴드 착용 | O — 바로 진행 화면 합류 | O | X (완료 안내) |
| 밴드 연결·신호 확인 | 상담사 본인만 | **O (핵심 목적)** | O | O | X |
| 음성 녹음·영상 녹화 | X | **X** (가드: audio/video_service의 허용 status에 open을 **넣지 않음** → 자동 차단) | O | O(일시정지) | X |
| EEG 리포트 분석용 저장 | X | **X — 표시용만** (§3.3) | O | O | X |
| 상담사 이탈 | 자유 | **경고+확인** | **경고+확인 (최고 강도)** | 경고+확인 | 자유 |
| 종료(end) | X | **X** | O | O | — |
| 취소(cancel=클래스 닫기) | O | O | O | O | X |

### 2.3 "open" 상태 도입 필요성 판단

- **필요**. 현재는 `ready`가 "생성됨"과 "회원 받는 중"을 겸하고 있어:
  - 상담사가 라이브 페이지에 들어오지도 않았는데 회원이 코드로 입장 가능 (`join_session_by_code`가 ready 허용)
  - 회원은 상담사가 준비됐는지 알 수 없고, 로그인 회원 상세 경로는 반대로 in_progress까지 입장 자체가 막힘
  - "회원이 먼저 들어와 밴드를 착용하고 오늘 상태를 파악하는 준비 시간"이 상태로 존재하지 않아 화면 로직으로만 암묵 처리
- `open`을 명시 상태로 두면: 회원 입장 허용 시점 = 상담사가 준비를 마친 시점으로 일원화되고, 녹화·분석 시작 시점 = `start`로 명확히 분리됨.

### 2.4 DB 변경 판단

- `status` 값 추가: **마이그레이션 불필요** (String(20), CHECK 없음 — §1.1).
- **`opened_at` 컬럼 추가 (권장, nullable)**: 대기실 경과 시간 표시·운영 지표(오픈→시작 소요)용. `add_column` 1건, 기존 행 NULL 허용이라 무중단. 없어도 기능은 동작하므로 구현 시 판단 여지 있음.
- 프론트 `SessionStatus` union(`lib/api/session.ts:6`)·`StatusBadge`·라벨 매핑 3곳에 `open` 추가 필요 (TypeScript exhaustive 매핑이라 컴파일로 누락 검출됨).

---

## 3. 상담사·회원 공통 독립형 플레이어 UI

### 3.1 원칙

- **클래스 = 하나의 가상의 방.** 입장하면 "지금 방이 어떤 상태인가"에 따라 화면이 전개된다. 사용자가 상태를 계산해서 버튼을 고르지 않는다.
- **단일 플레이어 컴포넌트**: 신규 `ClassPlayerPage` — 풀스크린(검정 immersive, 회원 명상 화면과 동일 톤), **AppShell 밖** 최상위 라우트. 상담사·회원 모두 이 페이지 하나를 사용하고, 역할(role)과 세션 상태(status)에 따라 씬과 컨트롤만 달라진다.
- 라우트:
  - 상담사: `/sessions/:id/player` (기존 `/sessions/:id/live`는 리다이렉트로 유지 → 점진 제거)
  - 회원·게스트: `/join?code=...` → 코드 확인·참여 처리 후 동일 플레이어로 진입 (join 게이트는 유지, 이후 화면은 공통)
- Wake Lock(기존 `useWakeLock`)·풀블리드 배경(`FadingImageBackground`)은 플레이어 공통 셸로 승격.

### 3.2 상태 × 역할 씬 매트릭스

| 세션 상태 | 상담사 씬 | 회원 씬 |
|---|---|---|
| ready/scheduled | **① 세팅(Setup)**: 카메라/마이크 프리뷰(기존 `SessionPreJoinPreview` 재사용) + 클래스 정보 + **[클래스 오픈]** 버튼 | 입장 게이트에서 차단: "상담사가 아직 클래스를 열지 않았습니다" + 자동 재시도(폴링/WS) |
| **open** | **② 대기실(Lobby)**: 클래스 코드 크게 표시(`SessionCodeBanner` 변형) + 참가자 카드 그리드(`SessionParticipantCardGrid` — 입장·밴드 착용·신호 실시간) + 호스트 셀프뷰 소형 + **[시작하기]** 버튼(그룹: 참가자 ≥1 시 활성) | **② 대기실**: 기존 waiting 3단계 재사용 — Welcome(`WelcomeText`) → 밴드 착용 가이드(`BandGuidePanel`) → 시작 대기("상담사가 곧 시작합니다") |
| in_progress | **③ 라이브(Live)**: 셀프뷰(`SessionHostVideoView`) + 모니터 요약/카드 그리드 + 마커·녹음 컨트롤 + 경과 타이머 + **[종료]** 버튼 | **③ 진행(Session)**: 기존 `GuestMeditationPanel`(명상 immersive) 자동 전환 |
| paused | ③에 일시정지 배지 + [재개] | ③에 일시정지 안내 오버레이 |
| completed | **④ 종료(Ended)**: 요약 안내 + [기록 보기 → /sessions/:id/record] | **④ 종료**: 기존 `GuestCompletePanel`(리포트 메일 신청) |

- 씬 전환 트리거: WS `session_state_changed`(이미 존재, `state_version` 중복·역순 방지 포함) 우선 + 폴링 폴백(기존 3~5초 폴링 패턴 유지). 회원 코드 경로의 자동 전환 로직(`class-join-page.tsx:157-259`)이 그대로 플레이어의 상태 구독부가 된다.
- **상담사 전용 컨트롤 노출 규칙**: `role === 'host'`일 때만 [클래스 오픈]/[시작하기]/[일시정지·재개]/[종료]/[클래스 닫기(취소)] 렌더. 회원에게는 [나가기]만.
- 기존 화면의 처리 방침:
  - `SessionLivePage.tsx` → 플레이어의 상담사 ②·③ 씬으로 **분해 이전** (모니터링·녹음·마커·밴드 로직은 훅/컴포넌트 단위로 그대로 재사용). 페이지 자체는 리다이렉트만 남기고 폐기.
  - `class-join-page.tsx` → step 머신 중 `code/details`(참여 게이트)만 남기고, `waiting/meditation/complete` 렌더는 플레이어 씬으로 이전.
  - `ClientSessionDetailPage.tsx` → 액션 버튼을 "세션 입장하기" 단일로 유지하되 활성 조건을 `open || in_progress || paused`로 변경.

### 3.3 상태별 데이터 정책 (녹화·분석)

- **open(대기)**:
  - 음성·영상 녹화 시작 불가 — `audio_service.py:55`·`video_service.py:62`의 허용 status에 `open`을 추가하지 않는 것만으로 서버측 차단 완성.
  - EEG: 밴드 연결·신호 품질·착용 상태 **실시간 표시는 허용** (대기실의 핵심 목적). 단 리포트 분석 포함 여부는 결정 필요:
    - 현황: EEG Raw 업로드는 status 무관, `eeg_query`·`report_service`에 started_at 구간 필터 없음(§1.1) → 그대로 두면 대기 중 EEG가 리포트에 섞임.
    - **제안**: 리포트 집계 시 `started_at ~ ended_at` 구간 필터를 추가해 "분석 = 진행중 데이터만"을 보장. (대기 중 데이터는 표시용으로만 소비하고 저장은 되어도 집계에서 제외 — 업로드 차단보다 단순하고 밴드 연결 확인 UX를 해치지 않음.)
- **start 시점**: 기존 SDD-083/085 흐름(프리뷰에서 확정한 미디어 조합 → 동의 → 녹음·녹화 개시)을 ② 대기실 → ③ 라이브 전환에 그대로 연결. 미디어 프리뷰·확정은 ① 세팅 씬에서 이미 끝났으므로 [시작하기]는 전이+녹화 개시만 담당.

---

## 4. 버튼 단순화 — "입장" 단일 버튼

- **클래스 목록(`SessionListTable`)·세션 상세(`SessionDetailPage`)에서 "시작" 버튼 제거.** 동작 열에는 **[입장]** 하나만 남기고, 목적지는 상태 불문 `/sessions/:id/player`.
- 플레이어가 상태를 보고 알아서 씬을 전개하므로 "어떤 버튼을 눌러야 하나"라는 질문 자체가 사라짐:
  - ready → 세팅 씬 (+[클래스 오픈])
  - open → 대기실 씬 (+[시작하기])
  - in_progress → 라이브 씬 (+[종료])
  - completed → 종료 씬
- 세션 상세의 `ACTIONS_BY_STATUS`(`SessionDetailPage.tsx:25-32`)에서 `start`를 빼고, 상세 페이지는 정보 조회·참여자 관리·[입장]·[클래스 닫기(취소)]만 담당.
- 상태 전이 버튼(오픈/시작/종료)은 **플레이어 안에만 존재** — 전이 책임 위치가 한 곳으로 수렴.

---

## 5. 이탈 보수 처리 (open·in_progress·paused)

- **브라우저 이탈(새로고침·탭 닫기·주소 이동)**: 플레이어에서 상담사 role + 상태가 `open/in_progress/paused`이면 `beforeunload` 핸들러 등록 → 브라우저 기본 확인 대화상자 강제. (현재 사용처 0건이므로 신규 훅 `useLeaveGuard`로 도입.)
- **SPA 내 라우팅 이탈(뒤로가기·메뉴 클릭)**: React Router v6 `useBlocker`로 차단 → 자체 확인 모달:
  - open: "클래스가 오픈된 상태입니다. 나가면 회원들이 대기실에 남겨집니다. [클래스 닫기] / [계속 진행] / [나가기(상태 유지)]"
  - in_progress: "클래스가 진행 중입니다. 녹음·녹화가 중단될 수 있습니다. [클래스 종료 후 나가기] / [계속 진행]" — **단순 [나가기] 없음** (최고 강도)
- **종료 확인 2단계화**: 현행 `window.confirm` 1회(`SessionLivePage.tsx:506`) → 전용 모달로 승격: 종료 시 일어나는 일(녹음·녹화 종료, 리포트 자동 생성, 회원 화면 종료 — SDD-084/086 근거) 고지 + 명시적 [클래스 종료] 버튼.
- **복구 경로**: 이탈·크래시 후 재입장하면 플레이어가 서버 상태 기준으로 해당 씬으로 복원 (상태 조회 + WS join snapshot은 기존 인프라 그대로). in_progress 재입장 시 녹음·녹화 재개 안내 배너 표시 (청크 업로드 구조라 기존 데이터는 보존됨 — `useVideoRecorder.ts` 주석 근거).
- 회원 이탈은 보수 처리 대상 아님(자유 이탈) — 단 meditation 중 [나가기]는 기존 `resetJoin`+BLE 해제 로직 유지 (`class-join-page.tsx:341-355`).

---

## 6. UX 흐름 상세 (상담사 여정 기준)

1. **클래스 생성** → 목록에 `ready`로 표시, 동작 버튼은 [입장] 하나.
2. **[입장]** → 플레이어 ① 세팅 씬: 카메라/마이크 프리뷰·토글(기존 SDD-085 UX 그대로), 클래스 정보 확인.
3. **[클래스 오픈]** → `open` 전이. ② 대기실 씬 전환: 클래스 코드 대형 표시, 참가자 실시간 그리드.
4. **회원 입장**: 코드 입력 또는 회원 앱 상세의 [세션 입장하기](open부터 활성). 회원 플레이어 = Welcome → 밴드 착용 가이드 → 시작 대기. 상담사는 그리드에서 착용·신호·배터리 상태 실시간 확인 ("오늘 상태 파악").
5. **[시작하기]** (그룹: 참가자 ≥1 활성) → `start` 전이 + 녹음·녹화·EEG 분석 저장 개시(동의 플로우 기존 유지). 상담사 ③ 라이브 씬, 회원은 자동으로 명상/세션 화면 전환.
6. **진행 중**: 모니터링·마커·일시정지/재개. 이탈 시도는 §5 규칙으로 차단.
7. **[종료]** (진행중에만 노출) → 2단계 확인 → `end` 전이 → 녹화 finalize + 리포트 자동 생성(기존 SDD-086) → 상담사 ④ 종료 씬([기록 보기]), 회원 완료 씬(리포트 메일).

---

## 7. 구현 범위 및 단계

> Brian 선호(실용성·단순화·승인 반복 금지) 반영 — 승인 1회로 진행 가능한 3단계 구성. Phase A만으로도 핵심 혼란(버튼 병존·오픈 부재·이탈 무방비)이 해소되고, Phase B가 플레이어 통합을 완성한다.

### Phase A — 상태 머신 + 버튼 단순화 + 이탈 가드 (기존 화면 골격 유지)

- **BE** (마이그레이션: `opened_at` 채택 시 add_column 1건, 미채택 시 0건):
  - `TRANSITIONS`에 `open` 액션 추가, `start` 출발 상태에 `open` 추가, `cancel`에 `open` 추가 (`session_service.py`)
  - `ACTIVE_STATUSES`에 `open` 추가
  - `join_session_by_code`: `ready/scheduled` 입장 거부("아직 오픈 전") + `open`부터 허용 — 게이트 이동
  - (권장) 리포트 EEG 집계에 `started_at~ended_at` 구간 필터 추가
  - 테스트: 전이 매트릭스·조인 게이트 pytest
- **FE**:
  - `SessionStatus`에 `'open'` 추가 + `StatusBadge`·라벨 매핑 3곳 반영
  - `SessionListTable`·`SessionDetailPage`: "시작" 제거, [입장] 단일화(목적지 `/live` 유지)
  - `SessionLivePage`: ready → [클래스 오픈](open 전이) → 대기 UI → [시작하기] → 기존 진행 UI, 로 버튼 재배선
  - `ClientSessionDetailPage`: 입장 활성 조건 `open || in_progress || paused`
  - `useLeaveGuard` 훅 신설(beforeunload + useBlocker) + 종료 2단계 모달

### Phase B — 독립형 공통 플레이어

- `ClassPlayerPage` 신설 (풀스크린, AppShell 밖, `/sessions/:id/player`): 씬 셸 + 역할·상태 라우팅
- `SessionLivePage`의 모니터링·녹음·마커·밴드 블록을 씬 컴포넌트로 분해 이전, `/live` → `/player` 리다이렉트
- `class-join-page`의 waiting/meditation/complete 렌더를 플레이어 씬으로 이전 (join 게이트는 유지)
- Design QA: 회원 immersive 톤과 상담사 씬 시각 통일

### Phase C — 정리 (후속)

- `start` 출발 상태에서 `ready/scheduled` 제거 (open 경유 강제)
- `SessionLivePage`·구 step 렌더 코드 삭제, 라벨 매핑 단일 모듈화

### 리스크·미결정 사항

| 항목 | 내용 | 제안 |
|---|---|---|
| `opened_at` 컬럼 | 대기 경과 표시·지표용, add_column 1건 | 추가 권장 (무중단) |
| 대기 중 EEG의 리포트 포함 | 현재 구간 필터 없음 → 섞임 | started_at 구간 필터로 제외 |
| 1:1 즉석 세션 | 오픈 단계가 과할 수 있음 | 동일 플로우 적용하되 [오픈]→[시작] 연타 허용(강제 대기 없음)으로 단순화 |
| 진행 중 open 세션 방치 | 상담사가 오픈만 하고 이탈 | ACTIVE_STATUSES 포함으로 중복 개설 방지 + 목록에 "오픈" 뱃지 노출, 자동 만료는 도입하지 않음(단순화) |
