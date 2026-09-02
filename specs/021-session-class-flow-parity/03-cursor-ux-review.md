# SDD-021 UX/프론트 리뷰 — 클래스 세션 1.0 패리티 (SessionScreen / GuestMeditationScreen)

> **역할**: UX/프론트 리뷰어  
> **입력**: `00-research-brief.md`, 2.0 현행 코드·디자인 프로토타입  
> **범위**: 코드 수정 없음. 호스트·게스트 흐름·레이아웃 적응·리스크 정리.

---

## 호스트 화면 UX

### 1. 진입점·정보 구조

| 1.0 | 2.0 현행 | 권고 |
|---|---|---|
| LectureScreen → "입장" → SessionScreen | SessionListPage → SessionDetailPage → "시작" → SessionLivePage | **명상수업(meditation)·그룹 클래스**는 Detail의 "시작" 또는 "입장(LIVE)" CTA로 `/sessions/{id}/live` 진입 유지. 상세 페이지의 `access_code` 복사 UI(`SessionDetailPage` L231–242)는 LIVE 진입 전 **선행 안내**로 재사용. |

**화면 골격**: 2.0 어드민 `AppShell` + 밝은 톤(`bg-white`, `#F5EDFC` 사이드바, `#5F0080` CTA) 유지. 현행 `SessionLivePage`의 `max-w-3xl` 단일 컬럼은 **모니터링 테이블 수용 불가** → LIVE 명상 모드에서는 `max-w-7xl` + 2열 그리드로 확장.

```
┌─ AppShell header ─────────────────────────────────────────────┐
│  [클래스명]  sub: LIVE          [클래스 시작|종료]  [연결 상태] │
├───────────────────────────────────────────────────────────────┤
│  ▼ 세션코드 안내 배너 (ready/scheduled)                        │
│  ┌─ Dashboard 4-box ─────────────────────────────────────┐   │
│  │ 참여자 │ 접촉불량 │ 기기연결실패 │ 배터리부족          │   │
│  └───────────────────────────────────────────────────────┘   │
│  ┌─ 참가자 모니터링 테이블 (주 영역) ───┐ ┌─ 요약 사이드 ─┐ │
│  │ 자리│이름│접촉│연결│배터리│평균│현재│업로드│ │ 평균 휴식도 │ │
│  └──────────────────────────────────────┘ └───────────────┘ │
│  ▼ (접기) 녹음 / 화상 — 온라인 세션만                          │
└───────────────────────────────────────────────────────────────┘
```

근거: 1.0 SessionScreen은 시작 전 코드 안내 + 시작 후 DashboardBox 4종 + 참가자 테이블이 핵심(`00-research-brief.md` L10–17). 2.0 `SessionLivePage`는 녹음·화상·마커만 있고 테이블 부재(L115–213).

---

### 2. 세션코드 안내 (시작 전)

**상태**: `session.status ∈ { ready, scheduled }`

| 요소 | UX 스펙 |
|---|---|
| 배너 문구 | 1.0 패리티: **"수강생에게 세션코드를 알려주세요"** + `access_code` 대형 mono 표시 |
| 코드 표시 | `SessionDetailPage`와 동일 스타일: `#F5EDFC` 배경, `font-mono tracking-[0.16em]`, **복사** 버튼 |
| 참가 대기 | "참가자 {n}명 대기 중" 실시간 카운터. 0명일 때 보조 문구: "참가자가 `/join`에서 코드 입력 후 입장하면 시작할 수 있습니다" |
| 연결 표시 | 1.0 `connected && sessionLogs.length > 0` → 헤더 우측 **소켓 연결 뱃지**(녹색 점 + "실시간 연결") / 끊김 시 amber 경고 |

시작 전에는 테이블 영역을 **빈 상태(empty state)** 로 두되, 입장한 참가자는 **행이 실시간 추가**되어 호스트가 "누가 들어왔는지" 확인 가능해야 함(1.0 폴링 + Socket `OPERATOR.init` 패리티).

---

### 3. "클래스 시작" CTA

| 조건 | 1.0 | 2.0 권고 |
|---|---|---|
| 활성화 | `connected && sessionLogs.length > 0` | `socketConnected && joinedParticipantCount >= 1` |
| 비활성 tooltip | (암묵적) | "참가자 1명 이상 입장 + 실시간 연결 필요" |
| 위치 | 화면 주 CTA | `AppShell` `rightSlot` — 현행 `SessionLivePage` L115–122 패턴 유지 |
| 클릭 후 | `OPERATOR.startSession` → 테이블·Dashboard 노출 | `transitionSession(id, 'start')` → 배너 접힘, 테이블 full-focus, **세션 타이머** 시작 |

**시작 확인 모달**(선택): 그룹 10명+ 클래스에서만 "N명과 함께 시작합니다" 1회 확인. 1.0에는 없으므로 MVP는 생략 가능.

**클래스 정보 모달**: 1.0 "클래스 정보" → 헤더 `⋯` 또는 "정보" 링크로 `SessionDetailPage` 요약(제목·유형·소요시간·메모)을 **읽기 전용 Sheet**로 제공.

---

### 4. 참가자 뇌파 모니터링 테이블 (시작 후)

**컬럼 (1.0 패리티 + 2.0 스키마 정합)**

| 컬럼 | 1.0 필드 | 표시 UX |
|---|---|---|
| 자리번호 | `seatNumber` | 2자리 mono (`01`). **웹에서는 서버 자동 배정**(입장 순서) — UI는 유지, 입력 단계 생략 |
| 이름 | user/guest name | `SessionParticipant.user_name \|\| guest_name` |
| 접촉상태 | `deviceStatus` (LeadOff) | 아이콘+라벨: ● 정상(녹) / ● 불량(적). LeadOff 시 행 배경 `#FDECEC` tint |
| 기기연결 | band connected | `band_connected` → "연결됨"(보라) / "미연결"(회색). LINK BAND optional이면 "미착용" 별도 상태 |
| 배터리 | `bandBattery` | `%` + 수평 mini-bar. `<20%` 적색, Dashboard "배터리부족" 카운트 연동 |
| 평균 두뇌휴식도 | `avgEfficiency` | `%` bold, 보라 `#5F0080` |
| 현재 두뇌휴식도 | `efficiencies[]` 최신 | `%` + 전 대비 ▲/▼ (작은 delta). 실시간 pulse animation(1Hz 이하) |
| 데이터 업로드 | record upload | "완료" / "전송 중" / "지연" badge |

**DashboardBox 4종** (테이블 상단, `OperatorAppPage` stats 카드 톤):

```
┌──────────┬──────────┬──────────┬──────────┐
│ 참여자 12 │ 접촉불량 2│ 연결실패 1│ 배터리부족 1│
└──────────┴──────────┴──────────┴──────────┘
```

클릭 시 해당 조건 행 **필터 토글**(재클릭 해제).

**행 인터랙션**

- **롱프레스(모바일) / ⋯ 메뉴(데스크톱)**: 자리번호·이름 수정 모달(1.0 패리티). 웹에서는 context menu가 더 자연스러움.
- **행 클릭**: 우측 사이드 패널에 해당 참가자 미니 차트(최근 2분 휴식도 sparkline) — 1.0에는 없으나 가로 레이아웃 여유 활용.

**테이블 UX (가로 웹)**

- `sticky` 헤더 + 본문 `overflow-x-auto` (≥1280px: 전 컬럼 노출, 1024–1279: 업로드·평균 컬럼 collapsible)
- 10명 이상: zebra `#FAFAFA` / 키보드 ↑↓ 행 포커스(a11y)
- 실시간 갱신: Socket push + 3–5초 폴링 fallback(1.0 `OPERATOR_INTERVAL_TIME` 패리티)

**디자인 토큰**: `OperatorAppPage` `SessionRunning`의 seat grid·측정 상태색(`#5F0080` measuring, `#D2AEFC` paired)을 **테이블 badge**로 축소 적용. 어드민 밝은 톤 유지 — 다크 immersive(1.0 게스트)와 대비.

---

### 5. "클래스 종료" CTA

| 항목 | UX |
|---|---|
| 위치 | 시작 후 동일 `rightSlot`. 라벨 **"클래스 종료"** (1.0 패리티, 2.0 `finishSession` L85–100) |
| 확인 | Modal: "진행 중인 측정을 종료하고 클래스를 마칩니다" + 참가자 수 요약 |
| 종료 후 | 1.0 → Lecture 복귀 / 2.0 → `/sessions/{id}/record`(현행) 또는 목록. **명상수업**은 게스트 `GuestComplete` 트리거 후 호스트도 record 페이지 이동 |
| 진행 중 부가 | 온라인: 녹음·화상 자동 stop(`SessionLivePage` L90–93). 오프라인 명상: 녹음 섹션 **접힌 상태 기본** |

---

## 게스트 화면 UX

### 1. 진입 흐름 (회원가입 입력 생략 반영)

1.0 6단계(자리번호→동의→코드/성별/실명/생일→대기→명상→완료)를 2.0 웹에 **압축**:

```
/join
  │
  ├─ [1] 코드 입력 ─────────────── ClassJoinPage step 'code' (현행 유지)
  │
  ├─ [2] 참여 확인 ─────────────── step 'details'
  │       · 로그인 사용자: "○○○님으로 참여" (실명/성별/생일 **재입력 없음**)
  │       · 게스트: **이름 1필드만** (현행 L198–214)
  │       · 자리번호: **UI 생략** → join API 응답 `participant_id` + 서버 seat 자동 배정
  │
  ├─ [3] 동의 + LINK BAND (조건부) ── 신규 step 'consent' (1.0 GuestConsentScreen)
  │       · 이용약관/개인정보 + EEG consent (`consent_eeg`)
  │       · linkband_mode !== 'none' 일 때 BLE 연결 CTA
  │       · Safari/Firefox: "Chrome/Edge 권장" 배너 (CLAUDE.md Web Bluetooth 제약)
  │
  ├─ [4] 대기 ─────────────────── step 'waiting' (강화)
  │
  ├─ [5] 명상 ─────────────────── `/join/{sessionId}/meditate` (신규)
  │
  └─ [6] 완료 ─────────────────── `/join/{sessionId}/complete` (선택, 1.0 GuestComplete)
```

**로그인 사용자 프로필 활용**

- `joinSessionByCode(code, {})` — 현행 `class-join-page.tsx` L125
- 표시: "프로필에 등록된 이름(김○○)으로 참여합니다" + (선택) 아바타 이니셜
- **재입력 금지**: 성별·생년월일·실명 필드 렌더하지 않음 (Brian 요구 핵심)

**게스트**

- 이름만 (`maxLength=80`, `autocomplete=name`) — 현행과 동일
- 이후 consent 단계에서 EEG 미동의 시에도 **대기·명상 입장 가능**(LINK BAND optional). 차트·휴식도 영역은 "밴드 연결 시 표시" empty state

---

### 2. 대기 화면 (GuestWaitingScreen → 2.0)

**레이아웃**: 게스트 전용 **보라 톤** (`ClassJoinPage` `bg-[#F8F6FA]`, `purple-900` — 어드민과 시각 분리). 1.0 비디오 배경은 웹에서 **정적 그radient + subtle loop video(optional, muted)** 로 대체 — autoplay·데이터 정책 고려.

| 영역 | UX |
|---|---|
| Hero | "호스트가 시작할 때까지 잠시 쉬어가세요" + 클래스명 |
| 웰컴 3단계 | 1.0 3-step carousel → **가로 3-card** (데스크톱) / **세로 accordion** (모바일). 예: "편안히 앉기" → "밴드 착용 확인" → "호흡 준비" |
| 상태 | 폴링 5초(현행 L80–84) + **WebSocket** `session.status` 변경 시 즉시 전환 |
| 밴드 상태 | 하단 sticky bar: 연결됨/미연결/접촉불량 — LeadOff 시 amber toast |
| 전환 | `status === 'in_progress'` → **0.5s fade** 후 명상 화면 route replace (뒤로가기 시 대기 복귀 방지) |

현행 gap: `waiting` step에서 `in_progress` 텍스트만 표시(L243–245)하고 **명상 route 자동 이동 없음** — 패리티 구현 필수.

---

### 3. 명상 화면 (GuestMeditationScreen → 2.0)

**상태**: `session.status === 'in_progress'` (1.0 `sessionLogState STARTED`)

**정보 계층 (1.0 세로 → 2.0 가로 adaptive)**

```
데스크톱 (≥1024px)
┌─────────────────────────────────────────────────────────┐
│  [클래스명]                    [경과 타이머  12:34 / 50:00] │
├───────────────────────────────┬─────────────────────────┤
│                               │  밴드 상태               │
│     두뇌휴식도 (Hero)          │  ● 연결  배터리 78%     │
│         72 %                  │  ● 접촉  정상           │
│     (large, #5F0080)          ├─────────────────────────┤
│                               │  BrainChart (sparkline)  │
│     BrainChart (주 영역)       │  최근 5분               │
│     실시간 뇌파/휴식도 곡선     │                         │
└───────────────────────────────┴─────────────────────────┘

모바일 (세로, 1.0에 가까움)
┌──────────────────┐
│ 타이머            │
│ 두뇌휴식도 72%    │
│ BrainChart       │
│ 밴드 상태 bar     │
└──────────────────┘
```

| 컴ponent | UX 스펙 |
|---|---|
| **두뇌휴식도** | 1.0 실시간 `%` — 48–72pt bold. 값 변경 시 gentle count-up. 밴드 미연결: "—" + "LINK BAND를 연결하면 표시됩니다" |
| **BrainChart** | `ReportDetailPage` `EegTimelineChart` 변형 — **실시간 sliding window**(최근 60–120초). 게스트 화면은 `#F5EDFC` area fill + `#5F0080` stroke (밝은 배경) |
| **타이머** | `started_at` 기준 경과 / `duration_min` 목표. mono `12:34 / 50:00`. 1.0 진행시간 패리티 |
| **LeadOff** | 전체 폭 amber banner: "센서 접촉을 확인해 주세요" — 차트·% dimmed |
| **종료** | 호스트 `end` → `session.status === 'completed'` 감지 → **Complete 화면** 자동 전환. 게스트 CTA 없음(수동 이탈만 "나가기" link) |

**몰입 톤**: 게스트 명상은 어드민보다 **약간 어두운 보라 gradient** (`#2D1045` → `#5F0080`) 허용 — 1.0 immersive 유지. 단, 차트·숫자는 WCAG AA 대비 확보.

---

### 4. 완료 화면 (GuestCompleteScreen — 선택)

| 항목 | UX |
|---|---|
| 트리거 | 세션 `completed` |
| 본문 | "수업이 종료되었습니다" + (측정 있으면) 평균 휴식도 요약 |
| 리포트 신청 | 1.0: 휴대전화번호 → 2.0: **로그인 사용자**는 프로필 phone 자동 / **게스트**는 phone optional input → Report 파이프라인 연결 |
| CTA | "리포트 신청" / "나중에" / "홈으로" |
| MVP | 리포트 없이 "완료" + `/` 복귀만으로 Phase 1 가능 — 기획 결정 필요 |

---

## 모바일→웹 적응

### 1. 레이아웃 축 전환 원칙

| 관심사 | 1.0 (RN 세로) | 2.0 (웹 가로) | 적응 규칙 |
|---|---|---|---|
| 호스트 모니터링 | 단일 TableView scroll | �ide data table + sidebar | **Primary = 테이블**. 부가(녹음·화상)는 collapsible |
| 호스트 Dashboard | 상단 4 box | 4-column grid (`OperatorAppPage` stats L208–217) | `<768px`: 2×2 grid |
| 게스트 대기 | Full-screen video | Card center + optional video | video는 `prefers-reduced-motion` 시 static |
| 게스트 명상 | Vertical stack | Split 60/40 (chart / metrics) | breakpoint `lg:` — mobile-first 구현 |
| CTA | Bottom fixed | `AppShell` header (host) / bottom sticky (guest mobile) | thumb zone: guest 주요 CTA 하단 |

### 2. 진입 디바이스 매트릭스

| 디바이스 | 호스트 | 게스트 |
|---|---|---|
| PC (Chrome) | **Primary target**. Full table + sidebar | BLE 가능. Split meditation layout |
| 태블릿 landscape | SessionRunning seat grid(`OperatorAppPage` L286) **보조 뷰** 토글 — 테이블 ↔ grid | 1.0 태블릿(자리번호) 대체: auto seat |
| 모바일 | 모니터링 가능하나 가로 scroll 필수. "간소 뷰"(이름·현재휴식도·상태만) | `/join` UX 유지. 명상은 1.0 세로 stack |
| Safari iOS | 호스트 OK | **BLE 불가** → EEG empty state + 안내 |

### 3. 상태 매핑 (1.0 ↔ 2.0)

| 1.0 sessionLogState | 2.0 session.status | 호스트 UI | 게스트 UI |
|---|---|---|---|
| READY (입장~시작 전) | `ready` / `scheduled` | 코드 배너 + 대기 테이블 | waiting |
| STARTED | `in_progress` | Dashboard + full table + 타이머 | meditation |
| COMPLETED | `completed` | 종료 → record | complete |
| — | `paused` | 2.0 신규 — "일시정지" banner, 테이블 freeze | waiting 유지 + "잠시 멈춤" overlay |
| — | `cancelled` | error + 목록 복귀 | error + `/join` reset |

### 4. 네비게이션·IA

- **호스트**: 사이드바 `세션 관리` 유지. LIVE 중 sidebar **활성 highlight** + breadcrumb `세션 > {title} > LIVE`
- **게스트**: `AppShell` **미사용**. `/join` 독립 mini-flow — 로고 + "나가기"만
- **딥링크**: `/join?code=ABC123` query 지원 → code step skip

---

## UX 리스크 및 개선 포인트

| # | 리스크/쟁점 | 영향 | 권고 |
|---|---|---|---|
| 1 | **Web Bluetooth 미구현** — 2.0 frontend에 `useBand`/BLE 훅 없음 | 게스트 명상·호스트 테이블 핵심 데이터 공백 | Phase 0: mock/WS relay. consent step에 browser detect + "PC Chrome에서 밴드 연결" 가이드. `linkband_mode=none`이면 EEG UI 전체 graceful hide |
| 2 | **실시간 채널 부재** — 1.0 Socket `OPERATOR.*` vs 2.0 `/record` WS only | 테이블·Dashboard stale, 시작 조건 불안정 | 세션 namespace WS 신설 또는 polling interval 단축(≤3s). "실시간 연결" 뱃지는 실제 socket state 연동 |
| 3 | **자리번호(seatNumber) UI 생략** | 호스트·현장 혼선 ("3번 자리"口頭 안내 불가) | 서버 auto-seat + 테이블 "자리" 컬럼 유지. Detail/LIVE에 **좌석 배치도(optional)** — `OperatorAppPage` grid 토글 |
| 4 | **ClassJoin waiting → meditation 자동 전환 없음** (현행 L243–245) | 1.0 핵심 패리티 깨짐 | `in_progress` detect 시 route replace + optional short chime(haptic 대체: visual pulse) |
| 5 | **SessionLivePage `max-w-3xl`** + 명상/상담 UI 혼재 | 호스트 테이블·화상·녹음 한 화면에 crowding | `type===meditation && participant_mode===group` → **ClassLiveLayout** 분기. 화상·녹음 default collapsed |
| 6 | **로그인 프로필 필드 결손** (name/email만 API 노출) | "재입력 생략"이 빈 이름으로 fallback | join 시 profile fetch — name 없으면 **1필드만** 예외 허용. UX copy: "프로필 이름이 없어 확인이 필요합니다" |
| 7 | **시작 버튼 조건 불일치** — 2.0은 무조건 start 가능(`SessionLivePage` L115–118) | 참가자 0명 시작 → 빈 클래스 | 1.0 패리티: disabled + tooltip. DetailPage에서 premature start 시 LIVE redirect 차단 검토 |
| 8 | **게스트·호스트 톤 분리** — ClassJoin purple vs AppShell admin | brand 혼선 | 게스트 flow 전용 `GuestShell` (purple). 호스트는 white/`#F5EDFC` 유지 |
| 9 | **LeadOff·접촉불량 대량 발생** | Dashboard "접촉불량" red — 현장 panic | 임계치 debounce(3초 sustained). 호스트에게 **그룹 액션** toast: "N명 접촉 확인 필요" |
| 10 | **GuestComplete / Report 연계 미정** | 1.0 리포트 신청 phone flow 단절 | MVP: complete → "리포트는 상담사 발급" copy. Phase 2: phone → Report API |
| 11 | **폴링 5초만으로 시작 감지** | 최대 5초 lag | waiting step: status poll **2s** + WS. 전환 중 skeleton |
| 12 | **온라인+명상 hybrid** | LiveKit + EEG 테이블 동시 — cognitive overload | default tab: "뇌파" | "화상". 명상수업 offline default offline |

---

## 최종 권고안

### A. 화면·라우트

1. **`SessionLivePage` 모드 분기**  
   - `meditation` + `group`: **ClassLiveHostView** (코드 배너 → Dashboard 4 → 모니터링 테이블 → collapsible 녹음/화상)  
   - `clinical`/`hypnosis` 1:1: 현행 UX 유지  

2. **게스트 `/join` step 확장**  
   - `code → details → consent? → waiting → /join/:id/meditate → /join/:id/complete`  
   - 로그인: details에서 이름·성별·생일 **零 입력**  
   - 게스트: **이름만**  

3. **디자인 소스**  
   - 호스트: `AppShell` + `SessionDetailPage` 코드 카드 + `OperatorAppPage` `SessionRunning` stats/sidebar  
   - 게스트: `ClassJoinPage` 톤 + 명상 Hero는 1.0 GuestMeditation **信息层次** (%, chart, timer)  

### B. 1.0 패리티 체크리스트 (UX 관점)

- [ ] 시작 전 세션코드 안내 문구 동일  
- [ ] 참가자 ≥1 + socket connected 시에만 "클래스 시작" 활성  
- [ ] 시작 후 Dashboard 4종 + 8컬럼 테이블  
- [ ] "클래스 종료" → 호스트 record/목록 복귀  
- [ ] 게스트 waiting → in_progress **자동** 명상 전환  
- [ ] 명상: 두뇌휴식도 % + BrainChart + 타이머  
- [ ] 회원가입 정보(성별/실명/생일) 재입력 없음  
- [ ] 자리번호 **입력** 생략, **표시** 유지  

### C. 구현 우선순위

| Priority | 항목 | 이유 |
|---|---|---|
| P0 | 호스트 모니터링 테이블 + 시작 조건 + 코드 배너 | Brian "매우 중요" 핵심 |
| P0 | 게스트 waiting→meditation + Hero/Chart/Timer shell | 1.0 GuestMeditation 패리티 |
| P0 | join flow 입력 생략 (로그인/게스트 분기) | 명시 요구 |
| P1 | consent + BLE browser gate | LINK BAND optional 대응 |
| P1 | Dashboard 4-box + 필터 | SessionScreen 운영 UX |
| P2 | GuestComplete / Report phone | 1.0 complete — 기획 확인 후 |
| P2 | Seat grid 보조 뷰 | OperatorAppPage 디자인 활용 |

### D. 1.0과 의도적 차이 (문서화 필수)

- **자리번호 입력 제거** — 현장 태블릿 대비 PC join; seat는 auto-assign  
- **화상·녹음** — 2.0 신규 capability; 명상 host default는 뇌파 테이블 우선  
- **paused 상태** — 1.0 없음; 2.0 추가 시 게스트 overlay 필요  
- **비디오 배경 대기** — 웹 performance/accessibility로 gradient 우선  

---

*리뷰 근거 파일: `00-research-brief.md`, `frontend/src/pages/sessions/SessionLivePage.tsx`, `frontend/src/pages/class-join-page.tsx`, `frontend/src/pages/sessions/SessionDetailPage.tsx`, `frontend/src/pages/design/OperatorAppPage.tsx` (SessionRunning), `frontend/src/lib/api/session.ts` (SessionParticipant)*
