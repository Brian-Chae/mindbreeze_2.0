# MIND BREEZE 2.0 — MVP 1.5 내담자 앱 기획

| 항목 | 값 |
|------|-----|
| **현재 버전** | `v1.1.0` |
| **문서 상태** | `Draft` |
| **최초 작성** | 2026-05-23 |
| **최종 수정** | 2026-05-23 |
| **문서 소유** | Product / Brian |
| **상위 문서** | `docs/MIND_BREEZE_2.0_종합_기획.md` v1.3.0, `docs/MIND_BREEZE_2.0_기능명세서.md` v1.1.0 |

### 0.1 변경 이력

| 버전 | 일자 | 변경 요약 | 작성 |
|------|------|----------|------|
| `v1.1.0` | 2026-05-23 | 초안 — BT·CL 아키텍처 + CH·CA 상세 명세 + CS 안티패턴 + 구현 로드맵 | — |
| `v1.0.0` | 2026-05-23 | 최초 작성 | — |

---

## 0. 배경과 목적

### 0.1 문제 인식

MVP1은 **상담사·운영자 관점**에서 모든 기능이 설계·구현되었다. 내담자(Client)는:

- 상담사로부터 초대 이메일을 받고 가입까지는 가능 (F1.4, `ClientOnboardingPage`)
- 그러나 **가입 후 마땅히 머무를 공간이 없음**
- 채팅은 상담사가 개설한 방에만 존재 (`ChatPage`는 상담사용 AppShell)
- 내 일정 확인 불가, 세션 신청 불가, 리포트 조회도 별도 경로 없음
- 사실상 **내담자는 MVP1에서 "관리 대상"일 뿐, 제품의 사용자가 아님**

### 0.2 MVP 1.5의 목표

> **내담자를 제품의 1등 사용자로 만든다.**

MVP1에서 이미 구축된 백엔드(채팅·세션·리포트·알림 API) 위에 **내담자용 모바일 웹 셸**을 얹어, 내담자가 다음 4가지를 스스로 할 수 있게 한다:

1. 상담사와 **채팅**으로 소통
2. 내 **세션 일정** 확인·신청
3. 내 **리포트** 조회
4. 내 **프로필·알림** 관리

---

## 1. 서비스 개요

### 1.1 포지셔닝

| 구분 | 상담사 웹 (MVP1) | 내담자 앱 (MVP 1.5) |
|------|-----------------|-------------------|
| 사용자 | Counselor, OrgAdmin, PlatformAdmin | Client |
| 기기 | PC 우선 (데스크톱) | **모바일 우선** (스마트폰) |
| 레이아웃 | 사이드바 내비게이션 + AppShell | **하단 4탭** + 모바일 셸 |
| 진입 | `/login` → 대시보드 | `/login/client` → 오늘 화면 |
| 핵심 액션 | 세션 생성·운영, 내담자 관리, AI 기록 | 채팅, 일정 확인, 리포트 보기 |
| 디자인 톤 | 전문가 도구 (정보 밀도 ↑) | 개인 공간 (여백 ↑, 따뜻함 ↑) |

### 1.2 설계 원칙

| # | 원칙 | 설명 |
|---|------|------|
| 1 | **단일 코드베이스** | `frontend/` 내에 라우트만 분기. 새 프로젝트 생성 금지 |
| 2 | **Backend 재사용** | MVP1의 채팅·세션·리포트·알림 API를 그대로 사용 (신규 엔드포인트 최소화) |
| 3 | **모바일 퍼스트** | 390×844px 기준 설계. PC에서는 430px max-width居中 |
| 4 | **Role Guard 기반** | Client 역할은 상담사 페이지 접근 불가, Counselor 역할은 내담자 탭 UI 접근 불가 |
| 5 | **디자인 시스템 준수** | Clinical Garden 토큰 + `mb-btn`·`text-ink-primary` 등 일관 사용 |

---

## 2. IA (Information Architecture)

```
내담자 앱 (Client Mobile Web)
├── 📱 오늘 (Home)
│   ├── 다음 세션 카드 (예정·진행중)
│   ├── 최근 리포트 요약
│   └── 안 읽은 메시지 배지
│
├── 💬 채팅 (Chat)
│   ├── 채팅방 목록 (상담사별 1:1)
│   ├── 채팅방 (메시지·시스템 메시지)
│   └── 새 메시지 푸시 배지
│
├── 📅 세션 (Sessions)
│   ├── 내 세션 목록 (월간 캘린더)
│   ├── 세션 상세 (정보·참여자·자료)
│   └── 세션 신청 (상담사에게 요청)
│
└── 👤 프로필 (Profile)
    ├── 내 정보·상담사 정보
    ├── 리포트 목록·상세
    └── 알림 설정 (이메일 ON/OFF)
```

> **제외:** 케어(🧘)·게시판(📋) 탭 — MVP3 범위. LINK BAND — MVP2 범위(F9).

---

## 3. 화면별 상세 설계

### 3.1 BT — 하단 탭바 (Bottom Tab Bar)

- **위치:** 뷰포트 하단 고정 (safe-area-inset-bottom 대응)
- **구성:** 4개 탭 — 오늘 · 채팅 · 세션 · 프로필
- **디자인:** 
  - 높이 64px (아이콘 24px + 라벨 11px)
  - 활성 탭: `text-brand-primary` + filled 아이콘
  - 비활성 탭: `text-ink-secondary` + outlined 아이콘
  - 상단 border `border-[#EFEFEF]`
  - 배경 `bg-white`
- **상태:**
  - 채팅 탭: 안 읽은 메시지 수 뱃지 (빨간 점 + 숫자, 최대 99+)
  - 세션 탭: 다가오는 세션 수 (당일 기준)

### 3.2 CL — 클라이언트 셸 (Client Shell)

- **구조:** `TopBar + 콘텐츠 영역 + BottomTabBar`
- **TopBar (56px):**
  - 좌측: 뒤로가기 버튼 (하위 화면에서만) 또는 로고
  - 중앙: 화면 제목 (Pretendard Bold 18px)
  - 우측: 알림 벨 아이콘 (→ `/notifications`)
- **콘텐츠 영역:** `flex-1 overflow-y-auto`, 배경 `bg-[#FAFAFA]`
- **Safe Area:** `env(safe-area-inset-*)` 전체 대응 (iPhone 노치·홈 인디케이터)

### 3.3 HO — 오늘 (Home)

**목적:** 내담자가 앱을 열었을 때 가장 먼저 보는 화면. 오늘 할 일과 최근 활동을 한눈에.

**구성 (위→아래):**
1. **인사말 + 날짜** — "안녕하세요, {이름}님" + 요일·날짜 (Pretendard Bold 22px + text-ink-secondary 13px)
2. **다음 세션 카드** — 가장 가까운 예정/진행중 세션 1개
   - 카드: `rounded-[20px] border border-[#EFEFEF] bg-white p-5`
   - 세션 유형 뱃지 (임상·최면·명상)
   - 제목 + 일시 + 상담사명
   - 상태 뱃지 (예정/진행중)
   - 진행중이면 "입장하기" 버튼 (→ 세션 라이브)
3. **최근 리포트** — 최근 리포트 최대 2개 (카드 리스트)
   - 리포트 카드: 날짜·세션명·요약 첫 줄
   - 탭 → `/reports/:id`
4. **빈 상태:** "아직 예정된 세션이 없어요" + "상담사에게 세션 신청하기" 버튼

**데이터:**
- `GET /api/v1/sessions?role=client&status=scheduled,in_progress&limit=1` (다음 세션)
- `GET /api/v1/reports?role=client&limit=2` (최근 리포트)
- `GET /api/v1/chat/unread-count` (안 읽은 메시지)

### 3.4 CH — 채팅 (Chat)

**목적:** 상담사와의 1:1 소통. 내담자가 능동적으로 메시지를 보내고 받을 수 있게.

#### 3.4.1 CH-01 — 채팅방 목록

- **구성:** 상담사별 채팅방 리스트
- **각 행:** 상담사 프로필(이니셜 아바타)·이름·마지막 메시지 미리보기·시간·안 읽은 뱃지
- **정렬:** 최근 메시지 순
- **빈 상태:** "아직 연결된 상담사가 없어요"

#### 3.4.2 CH-02 — 채팅방

- **상단:** 상담사명 + 프로필 (탭 → 상담사 정보)
- **메시지 영역:**
  - 말풍선: 내담자(우측·brand-primary 배경·흰색 글씨), 상담사(좌측·흰색 배경·ink-primary 글씨)
  - 시스템 메시지: 중앙 정렬·작은 글씨·회색 ("2026년 5월 23일", "세션이 예약되었습니다")
  - 타임스탬프: 말풍선 하단 작게
- **입력창:** 하단 고정. 텍스트 입력 + 전송 버튼. `env(safe-area-inset-bottom)` + iOS 키보드 대응

**데이터:**
- 기존 채팅 API 재사용 (`GET /api/v1/chat/rooms`, `GET /api/v1/chat/rooms/:id/messages`, `POST .../messages`)
- WebSocket: `Socket.IO` (기존 `chat_namespace.py` 그대로 사용)

**주의사항:**
- 현재 채팅 API는 Counselor 권한을 가정할 수 있음 → Client role로 접근 가능하도록 백엔드 권한 검사 확인 필요
- 내담자는 내담자 자신과 연결된 상담사와의 채팅방만 볼 수 있어야 함

### 3.5 CA — 세션 (Sessions / Calendar)

**목적:** 내 세션 일정 확인 및 신청.

#### 3.5.1 CA-01 — 내 세션 목록

- **기본 뷰:** 월간 캘린더 + 하단 당일 세션 리스트
- **월간 캘린더:**
  - 상단: 월 이동 화살표
  - 요일 헤더 (일~토)
  - 날짜 셀: 세션 있는 날은 점(dot) 표시
- **세션 리스트 (당일):**
  - 선택된 날짜의 세션 카드 목록
  - 각 카드: 유형 뱃지·제목·시간·상담사명·상태
  - 탭 → 세션 상세
- **과거 세션:** "종료된 세션" 토글 또는 스크롤 과거

#### 3.5.2 CA-02 — 세션 상세

- 세션 정보: 유형·제목·일시·소요시간·상담사
- 상태에 따른 액션:
  - 예정: 일정 캘린더에 추가 안내
  - 진행중: "세션 입장하기" 버튼
  - 완료: "리포트 보기" 버튼
- 참여 안내 (오프라인·온라인 장소 정보)

#### 3.5.3 CA-03 — 세션 신청

- "세션 신청하기" 버튼 → 상담사에게 요청 메시지 자동 생성
- 실제 구현: **채팅방에 시스템 메시지로 "세션 신청" 전송**
  - 상담사가 채팅에서 확인 → 세션 생성 → 내담자 일정에 자동 반영
  - (MVP 1.5 범위: 시스템 메시지 기반. 추후 정식 예약 플로우는 MVP2)

**데이터:**
- `GET /api/v1/sessions?role=client` (내 세션 목록)
- `GET /api/v1/sessions/:id` (세션 상세)
- `POST /api/v1/chat/rooms/:id/messages` (세션 신청 시스템 메시지 — type=system, subtype=session_request)

### 3.6 PR — 프로필 (Profile)

**목적:** 내 정보·상담사 정보·리포트·설정 통합.

**구성 (스크롤):**
1. **내 프로필 카드**
   - 아바타(이니셜)·이름·이메일
   - 내 상담사 정보 (이름·소속·자격 등급 뱃지)
2. **리포트 섹션**
   - "내 리포트" → 목록으로 (`/reports?role=client`)
   - 최근 리포트 2개 미리보기
3. **설정**
   - 알림 설정: 이메일 ON/OFF 토글
   - 공지사항 (MVP3)
   - 로그아웃

**데이터:**
- `GET /api/v1/users/me` (내 정보 + 연결된 상담사)
- `GET /api/v1/reports?role=client` (내 리포트)
- `GET /api/v1/notifications/preferences` + `PUT` (알림 설정)

---

## 4. 기술 설계

### 4.1 아키텍처 — 단일 SPA + Role Router

```
frontend/src/
├── App.tsx                     # RoleRouter — Client vs Counselor 분기
├── components/
│   └── layout/
│       ├── AppShell.tsx        # 상담사용 (기존)
│       └── ClientShell.tsx     # 내담자용 (신규) — TopBar + BottomTabBar + content
├── pages/
│   ├── client/                 # 내담자 전용 페이지 (신규)
│   │   ├── ClientHomePage.tsx
│   │   ├── ClientChatListPage.tsx
│   │   ├── ClientChatRoomPage.tsx
│   │   ├── ClientSessionListPage.tsx
│   │   ├── ClientSessionDetailPage.tsx
│   │   └── ClientProfilePage.tsx
│   └── ...                     # 기존 상담사 페이지 (변경 없음)
└── components/
    └── client/                 # 내담자 전용 컴포넌트 (신규)
        ├── BottomTabBar.tsx
        ├── ClientTopBar.tsx
        ├── SessionCard.tsx      # 내담자용 세션 카드
        └── ReportCard.tsx       # 리포트 미리보기 카드
```

### 4.2 라우팅

```typescript
// App.tsx — RoleRouter
function App() {
  const role = useAuthStore(s => s.user?.role);

  if (role === 'client') {
    return <ClientRoutes />;  // 내담자 앱
  }
  return <CounselorRoutes />;  // 기존 상담사 앱 (현행 유지)
}
```

**내담자 라우트:**
| 경로 | 화면 | 탭 |
|------|------|----|
| `/app` | 오늘 (Home) | 오늘 |
| `/app/chat` | 채팅방 목록 | 채팅 |
| `/app/chat/:roomId` | 채팅방 | — |
| `/app/sessions` | 내 세션 목록 | 세션 |
| `/app/sessions/:id` | 세션 상세 | — |
| `/app/profile` | 프로필 | 프로필 |
| `/app/reports/:id` | 리포트 상세 | — |
| `/app/notifications` | 알림 센터 | — |

> 상담사 앱 라우트(`/dashboard`, `/sessions`, `/chat` 등)는 그대로 유지. Client role은 `/app/*`만 접근 가능.

### 4.3 상태 관리

- **내담자 상태:** `clientStore.ts` (Zustand) — 현재 탭, 안 읽은 메시지 수
- **기존 스토어 재사용:** `authStore`, `chatStore`, `sessionStore` (읽기 전용으로)
- **API:** 기존 `lib/api/` 모듈 재사용 (필요 시 client role 필터 파라미터 추가)

### 4.4 반응형

- **모바일 (≤430px):** 기본 타겟. `ClientShell` 전체 화면
- **태블릿·데스크톱 (>430px):** `max-w-[430px] mx-auto` + 좌우 배경은 `bg-[#FAFAFA]`로居中. **iOS 시뮬레이터 느낌** (→§4.3B)

### 4.5 성능

- 초기 로드: Code splitting — `React.lazy()`로 내담자/상담사 라우트 분리 → 역할별 번들 다운로드 최소화
- 이미지: WebP + Lazy loading
- 채팅: 무한 스크롤 (위로 올리면 과거 메시지)

---

## 5. CS — Client Shell 디자인 (= UI 디자인 패턴)

> **"좋은 내담자 앱 셸"의 조건과 디자인 원칙에 관한 설계 지식.**
> 내담자 앱 셸은 단순한 '레이아웃 래퍼'가 아니다 — 모바일 네이티브 느낌을 주면서도 웹 기술로 동작해야 하는 하이브리드 UI의 정수.

### 5.1 BT·CL 단일 섹션

| 설계 항목 | 세부 결정 |
|----------|----------|
| **하단 탭바 높이** | 아이콘 24px + 라벨 11px + 패딩 → 64px 고정. safe-area-inset-bottom 별도 대응 |
| **TopBar 높이** | 56px. statusBar(44px)와 별도 — iOS 노치 영역은 safe-area-inset-top으로 |
| **콘텐츠 스크롤** | `overflow-y: auto` + `-webkit-overflow-scrolling: touch`. TopBar/BottomTabBar 외 영역만 스크롤 |
| **Safe Area** | `env(safe-area-inset-*)` 4방향 CSS 변수. `<meta name="viewport" content="viewport-fit=cover">` |
| **탭 전환** | 클라이언트 사이드 라우팅(React Router). 뒤로가기 스택 유지 (탭 간 히스토리 독립) |
| **키보드 대응** | iOS: `visualViewport` API로 키보드 높이 감지 → 입력창 위치 조정 (`useKeyboardHeight` 훅 재사용) |
| **탭 뱃지** | 읽지 않은 메시지: 빨간 점 + 숫자(최대 99+). 세션: 당일 세션 수 (숫자만, 점 없음) |
| **빈 상태** | 각 탭별 별도 일러스트 + CTA 버튼. 일반적 "데이터 없음" 아이콘 지양 |
| **로딩** | 상단 skeleton UI. 전체 화면 스피너 지양 |
| **새로고침** | pull-to-refresh 제스처 (가능하면). 실패 시 하단 토스트 |

### 5.2 CH-B — Client Chat Design (채팅방 디자인 패턴)

| 설계 항목 | 세부 결정 |
|----------|----------|
| **말풍선 최대 너비** | 화면의 75%. 75% 초과 시 줄바꿈 |
| **내담자 말풍선** | 우측 정렬, `bg-brand-primary` 배경, 흰색 글씨, 우하단 둥글기 작게 |
| **상담사 말풍선** | 좌측 정렬, `bg-white` 배경, `text-ink-primary`, 좌하단 둥글기 작게 |
| **말풍선 둥글기** | `rounded-2xl` (16px) — 좌우 비대칭은 우하단·좌하단만 `rounded-br-md` `rounded-bl-md` |
| **시스템 메시지** | 중앙 정렬, `text-xs text-ink-secondary`, 배경 없음, 상하 마진 12px |
| **시간 표시** | 말풍선 아래 `text-[10px] text-ink-secondary`. 같은 발신자 연속 시 첫 메시지에만 |
| **입력창** | `min-h-[44px]` + `max-h-[120px]`. 멀티라인 자동 확장. 전송 버튼 `w-9 h-9` |
| **날짜 구분선** | "2026년 5월 23일 (토)" — 중앙, `text-xs text-ink-secondary`, 상하 마진 16px |

### 5.3 CA — Client Schedule Design (내담자 세션 목록 디자인 패턴)

| 설계 항목 | 세부 결정 |
|----------|----------|
| **캘린더 셀 크기** | (화면폭 - 32px) / 7. 최대 48px×48px |
| **세션 점(dot)** | 지름 5px, `bg-brand-primary`, 날짜 숫자 아래 2px |
| **오늘 강조** | `bg-brand-primary` 원형(지름 32px) + 흰색 숫자 |
| **세션 카드** | `rounded-[20px] border-[#EFEFEF] p-4`. 왼쪽 컬러 바 (3px, 유형별 색상) |
| **유형별 색상 바** | 임상: `#5F0080`, 최면: `#1F8A5B`, 명상: `#E6A817` |
| **카드 액션 영역** | 우측 정렬, 상태 뱃지 + 셰브론 |
| **과거 세션** | 반투명(opacity-60), "종료" 뱃지 |

### 5.4 CS-B — Client Shell 마크업 패턴 (구조적 안티패턴)

| 패턴 | 설명 |
|------|------|
| **❌ body overflow:hidden** | iOS에서 뷰포트 스크롤 차단. 대신 내부 컨테이너 `overflow-y: auto` |
| **❌ fixed TopBar+TabBar+절대위치 content** | iOS `position:fixed` + 키보드 = 레이아웃 붕괴. 대신 flexbox + `min-h-0` + `overflow-y: auto` |
| **❌ 100vh** | iOS Safari에서 주소창 포함 높이. `dvh`(dynamic viewport height) 또는 `100%` 사용 |
| **❌ input font-size < 16px** | iOS에서 자동 확대(zoom) 발생 → `text-base`(16px) 필수 |
| **✅ flex-col + flex-1 + min-h-0 + overflow-y-auto** | iOS에서 안정적인 내부 스크롤 공식 (→ `ios-scroll-layout-pattern` 스킬) |
| **✅ `viewport-fit=cover` + `safe-area-inset-*`** | iPhone 노치·홈 인디케이터 영역까지 콘텐츠 확장 |

---

## 6. 백엔드 변경사항

### 6.1 신규 API

| 메서드 | 경로 | 설명 | 우선순위 |
|--------|------|------|:---:|
| `GET` | `/api/v1/client/home` | 오늘 화면 집계 (다음 세션·최근 리포트·안 읽은 메시지) | **P0** |
| `GET` | `/api/v1/chat/unread-count` | 클라이언트별 안 읽은 메시지 총계 | **P0** |
| `POST` | `/api/v1/sessions/request` | 세션 신청 (시스템 메시지 자동 생성) | **P1** |

### 6.2 기존 API 권한 확장

| API | 현재 | 변경 |
|-----|------|------|
| `GET /api/v1/sessions` | Counselor: 본인 세션 | Client role → 본인이 참여자인 세션만 반환 |
| `GET /api/v1/chat/rooms` | Counselor: 본인 채팅방 | Client → 본인이 participant인 채팅방 |
| `GET /api/v1/reports` | Counselor: 본인 발행 리포트 | Client → 본인 대상 리포트 |
| `GET /api/v1/users/me` | 공통 | 응답에 `counselor` 필드 추가 (연결된 상담사 정보) |

### 6.3 권한 검사

- `RoleGuard` 컴포넌트: `client` role은 `/app/*`만 접근 가능
- `counselor` role은 `/app/*` 접근 불가 (리디렉트 `/dashboard`)
- API 레벨: 기존 `get_current_user` 의존성에 role 기반 필터 자동 적용

---

## 7. 데이터 모델 변경

### 7.1 신규 모델 없음

MVP 1.5는 기존 데이터 모델 위에서 동작. 단, 아래 필드 활용 방식 변경:

| 모델 | 필드 | 용도 |
|------|------|------|
| `User` | `role='client'` | Role Router 분기 |
| `User` | `counselor_id` (신규 또는 `client_of`) | 내담자↔상담사 연결 |
| `Session` | `participants[]` | 내담자의 세션 목록 조회 |
| `ChatRoom` | `participants[]` | 내담자의 채팅방 목록 |
| `Report` | `recipient_id` | 내담자 대상 리포트 필터링 |
| `Message` | `type='system'`, `subtype='session_request'` | 세션 신청 메시지 |

### 7.2 User 모델 확장 (필요 시)

```python
# backend/app/models/user.py
class User(Base):
    # ... existing fields ...
    counselor_id = Column(UUID, ForeignKey("users.id"), nullable=True)  # 내담자의 상담사
```

이미 `counselor_code`로 매칭된 상담사가 있다면, `counselor_id`를 저장하여 빠른 참조.

---

## 8. 구현 로드맵

### Phase 1 — 기초 (2~3일)

| 작업 | 내용 |
|------|------|
| **ClientShell** | TopBar + BottomTabBar + 콘텐츠 영역 레이아웃 |
| **RoleRouter** | App.tsx에 client/counselor 분기 |
| **BottomTabBar** | 4탭 + 라우팅 + 활성 상태 |
| **ClientHomePage** | 오늘 화면 (세션 카드 + 리포트 미리보기) |
| **백엔드** | `/client/home` API, 기존 API Client 권한 확장 |

### Phase 2 — 채팅 (2일)

| 작업 | 내용 |
|------|------|
| **ClientChatListPage** | 채팅방 목록 |
| **ClientChatRoomPage** | 채팅방 + 메시지·입력창 |
| **WebSocket** | Client role으로 Socket.IO 접속 |
| **안 읽은 메시지** | 뱃지 + `/chat/unread-count` API |

### Phase 3 — 세션·리포트 (2일)

| 작업 | 내용 |
|------|------|
| **ClientSessionListPage** | 월간 캘린더 + 세션 리스트 |
| **ClientSessionDetailPage** | 세션 상세 |
| **세션 신청** | 시스템 메시지 기반 신청 플로우 |
| **리포트 연동** | 기존 ReportListPage/ReportDetailPage client role 연동 |

### Phase 4 — 프로필·마무리 (1~2일)

| 작업 | 내용 |
|------|------|
| **ClientProfilePage** | 프로필 + 상담사 정보 + 리포트 링크 |
| **알림 설정** | 이메일 ON/OFF 토글 |
| **빈 상태** | 각 탭별 empty state UI |
| **QA·버그 픽스** | iOS Safari 실기기 테스트 |

---

## 9. 기능명세서 연동

MVP 1.5는 `docs/MIND_BREEZE_2.0_기능명세서.md`의 기존 F-ID를 확장하지 않고, 새로운 영역 **FC (Client Features)** 를 추가한다:

| FC-ID | 명칭 | MVP | 설명 |
|:---:|------|:---:|------|
| FC.1 | 내담자 앱 셸 + 탭 내비게이션 | 1.5 | ClientShell·BottomTabBar·RoleRouter |
| FC.2 | 내담자 오늘 화면 | 1.5 | 다음 세션·최근 리포트·메시지 배지 |
| FC.3 | 내담자-상담사 채팅 | 1.5 | 채팅방 목록·메시지·WebSocket |
| FC.4 | 내담자 세션 캘린더 | 1.5 | 월간 뷰·세션 상세·신청 |
| FC.5 | 내담자 리포트 조회 | 1.5 | 리포트 목록·상세·공유 |
| FC.6 | 내담자 프로필·설정 | 1.5 | 프로필·상담사 정보·알림 설정 |
| FC.7 | 내담자 세션 신청 | 1.5 | 시스템 메시지 기반 신청 |
| FC.8 | 내담자 앱 푸시 알림 | MVP2 | FCM/APNs (→MVP2로 이관) |

---

## 10. 리스크·주의사항

| # | 리스크 | 대응 |
|---|--------|------|
| 1 | iOS Safari에서 `position:fixed` + 키보드 레이아웃 붕괴 | `ios-scroll-layout-pattern` 스킬 참고. flexbox 기반으로만 구현 |
| 2 | 채팅 API 권한 문제 (Counselor 전용 가정) | 백엔드 `get_current_user`에 Client role 대응 추가 (Phase 1 선행) |
| 3 | 내담자↔상담사 연결 관계 누락 | `User.counselor_id` 필드 추가 또는 `onboarding_code` 기반 조회 |
| 4 | MVP1 상담사 UI와의 코드 충돌 | 내담자 페이지는 `pages/client/`에 격리. 공통 컴포넌트만 `components/` 공유 |
| 5 | 모바일 성능 (애니메이션·이미지) | `will-change` 최소화, 이미지 지연 로딩, Virtualize long lists |

---

## 문서 식별

**문서 식별:** `mindbreeze-2.0-mvp1.5-client-app` · 현재 `v1.1.0`

**상태:** Draft → 검토 요청 (Brian)
