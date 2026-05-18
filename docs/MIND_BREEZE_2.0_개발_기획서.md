# MIND BREEZE 2.0 — 개발 기획서

> **버전:** v1.0 | **작성일:** 2026-05-18
> **참조:** `docs/MIND_BREEZE_2.0_종합_기획.md` v1.3.0 · `docs/MIND_BREEZE_2.0_기능명세서.md` v1.1.0 · `docs/AI_STACK_DECISION.md` v1.0.0

---

## 1. 시스템 아키텍처

### 1.1 전체 구성도

```
                          ┌─────────────────────────────────────────┐
                          │              AWS (Seoul Region)          │
                          │                                          │
  상담사 ─── Chrome/Edge ─▶│  ┌──────────────────────────────────┐  │
  (PC BLE)                 │  │        ECS Fargate (Web)          │  │
                           │  │  ┌────────────┐ ┌─────────────┐  │  │
  내담자 ─── 모바일웹 ────▶│  │  │  React SPA │ │  FastAPI     │  │  │
  (MVP1)                   │  │  │  (Vite)    │ │  (REST+WS)  │  │  │
                           │  │  └─────┬──────┘ └──────┬──────┘  │  │
                           │  │        │                │         │  │
  내담자 ─── RN 앱 ───────▶│  │  REST API ◀──────────▶ WS        │  │
  (MVP2)                   │  └────────┼────────────────┼─────────┘  │
                           │           │                │            │
                           │  ┌────────┼────────────────┼─────────┐  │
                           │  │   ECS Fargate (Worker)            │  │
                           │  │  ┌──────────┐ ┌────────────────┐  │  │
                           │  │  │  Celery   │ │  Celery Beat   │  │  │
                           │  │  │  Worker   │ │  (스케줄러)    │  │  │
                           │  │  │           │ │                │  │  │
                           │  │  │ • STT     │ │ • 자격 만료    │  │  │
                           │  │  │ • AI 요약 │ │ • 알림 발송    │  │  │
                           │  │  │ • EEG분석 │ │ • 정기 정산    │  │  │
                           │  │  │ • OCR검증 │ │                │  │  │
                           │  │  └──────────┘ └────────────────┘  │  │
                           │  └────────────────────────────────────┘  │
                           │                                          │
                           │  ┌──────────┐ ┌──────────┐ ┌─────────┐  │
                           │  │   RDS    │ │ Elasti-  │ │   S3    │  │
                           │  │PostgreSQL│ │ Cache    │ │ (음성,  │  │
                           │  │          │ │ Redis    │ │  PDF,   │  │
                           │  │          │ │          │ │  Parquet│  │
                           │  └──────────┘ └──────────┘ └─────────┘  │
                           └─────────────────────────────────────────┘
```

### 1.2 데이터 흐름 — 세션 라이프사이클

```
[세션 예약]
   │
   ├── 1. 상담사가 세션 생성 → 내담자 초대 (이메일/인앱 알림)
   ├── 2. 내담자 예약 확인 → 세션 상태 '예정'
   └── 3. 세션 전 리마인더 (Celery Beat)

[세션 진행]
   │
   ├── 1. 상담사 '세션 시작' → 상태 '진행중'
   ├── 2. (동의 시) 음성 녹음 시작 → Web Audio API → S3 청크 업로드
   ├── 3. (동의 시) LINK BAND BLE 연결 → EEG 스트림 → WebSocket → 서버
   └── 4. 마커 태그 + 메모 (타임스탬프 동기)

[세션 종료 → AI 파이프라인]
   │
   ├── 1. 상담사 '세션 종료' → 상태 '완료'
   ├── 2. Celery 태스크: S3 청크 병합 → Gemini Audio STT+화자분리
   ├── 3. Celery 태스크: Claude 요약 → 기록지 초안 생성
   ├── 4. (착용 시) Celery 태스크: S3 Raw 로드 → Looxid SDK 분석
   └── 5. 상담사 편집·승인 → 리포트 PDF 생성 → 발송 (이메일+인앱)

[자격 검증 — 비동기]
   │
   ├── 1. 상담사 증빙 업로드 → S3 SSE-KMS
   ├── 2. Celery 태스크: Gemini Vision OCR → 문서 분류
   ├── 3. (센터) 국세청 사업자 상태 API 조회
   ├── 4. 규칙 엔진: 교차 일관성 → auto_approve/needs_review/reject
   └── 5. needs_review → 어드민 검토 큐(F11)
```

---

## 2. 프로젝트 구조

```text
mindbreeze_2.0/
├── frontend/                       # React SPA (관리자 + 내담자)
│   ├── public/
│   ├── src/
│   │   ├── components/             # 공통 UI 컴포넌트
│   │   │   ├── ui/                 # shadcn/ui 기반 원자 컴포넌트
│   │   │   ├── layout/             # DashboardShell, AppHeader, Sidebar
│   │   │   └── domain/             # SessionCard, ClientProfile, ChatBubble
│   │   ├── pages/                  # 라우트 페이지
│   │   │   ├── auth/               # LoginPage, RegisterPage, OnboardingSteps
│   │   │   ├── dashboard/          # HomeDashboard, Schedule, Chat
│   │   │   ├── clients/            # ClientList, ClientDetail, Journal
│   │   │   ├── sessions/           # SessionCreate, SessionLive, SessionRecord
│   │   │   ├── reports/            # ReportList, ReportDetail
│   │   │   ├── eeg/                # EEGDashboard (실시간 모니터링)
│   │   │   ├── admin/              # VerificationQueue, PlatformSettings
│   │   │   └── settings/           # ProfileSettings, NotificationSettings
│   │   ├── hooks/                  # 커스텀 훅
│   │   │   ├── useAuth.ts          # 인증 상태
│   │   │   ├── useBLE.ts           # Web Bluetooth API 래퍼
│   │   │   ├── useEEGStream.ts     # EEG WebSocket 구독
│   │   │   ├── useAudioRecorder.ts # Web Audio API 녹음
│   │   │   └── useWebSocket.ts     # Socket.IO 클라이언트
│   │   ├── stores/                 # Zustand 스토어
│   │   │   ├── authStore.ts        # 사용자·토큰
│   │   │   ├── sessionStore.ts     # 현재 세션 상태
│   │   │   ├── eegStore.ts         # 실시간 EEG 데이터
│   │   │   └── notificationStore.ts
│   │   ├── lib/                    # 유틸리티·API 클라이언트
│   │   │   ├── api.ts              # Axios 인스턴스 + 인터셉터
│   │   │   ├── socket.ts           # Socket.IO 클라이언트 싱글톤
│   │   │   └── validators.ts       # 폼 검증 (Zod)
│   │   ├── router.tsx              # React Router 설정
│   │   └── main.tsx                # 진입점
│   ├── tailwind.config.cjs
│   └── vite.config.ts
│
├── backend/                        # FastAPI 서버
│   ├── app/
│   │   ├── main.py                 # FastAPI 앱 생성·라우터 등록
│   │   ├── config.py               # 환경변수·설정 (Pydantic Settings)
│   │   ├── api/                    # REST 엔드포인트
│   │   │   ├── v1/
│   │   │   │   ├── auth.py         # 로그인·회원가입·토큰 갱신
│   │   │   │   ├── users.py        # 사용자 프로필·설정
│   │   │   │   ├── sessions.py     # 세션 CRUD·상태 전이
│   │   │   │   ├── clients.py      # 내담자 관리
│   │   │   │   ├── chat.py         # 채팅 메시지
│   │   │   │   ├── records.py      # 세션 기록·AI 요약
│   │   │   │   ├── reports.py      # 리포트 조회·발송
│   │   │   │   ├── eeg.py          # EEG 데이터·분석 결과
│   │   │   │   ├── credentials.py  # 자격 증빙·검증
│   │   │   │   ├── notifications.py# 알림·발송 이력
│   │   │   │   └── admin.py        # 어드민 검토 큐
│   │   │   └── deps.py             # 의존성 주입 (DB 세션, 현재 사용자)
│   │   ├── models/                 # SQLAlchemy ORM 모델
│   │   │   ├── user.py
│   │   │   ├── session.py
│   │   │   ├── record.py
│   │   │   ├── report.py
│   │   │   ├── eeg.py
│   │   │   ├── credential.py
│   │   │   └── notification.py
│   │   ├── schemas/                # Pydantic 요청/응답 스키마
│   │   ├── services/               # 비즈니스 로직
│   │   │   ├── auth_service.py
│   │   │   ├── session_service.py
│   │   │   ├── ai_service.py       # AI 파이프라인 조율
│   │   │   ├── eeg_service.py      # EEG 버퍼링·분석
│   │   │   └── verification_service.py
│   │   ├── tasks/                  # Celery 태스크
│   │   │   ├── stt_task.py         # Gemini Audio STT
│   │   │   ├── summary_task.py     # Claude 요약
│   │   │   ├── eeg_analysis_task.py# Looxid SDK 분석
│   │   │   ├── ocr_task.py         # Gemini Vision OCR
│   │   │   ├── report_task.py      # 리포트 PDF 생성
│   │   │   └── notification_task.py# 이메일·푸시 발송
│   │   ├── ws/                     # WebSocket
│   │   │   ├── eeg_namespace.py    # 실시간 EEG 스트림
│   │   │   ├── chat_namespace.py   # 실시간 채팅
│   │   │   └── session_namespace.py# 세션 상태 브로드캐스트
│   │   └── core/                   # 공통
│   │       ├── security.py         # JWT·비밀번호 해싱·RBAC
│   │       ├── s3.py               # S3 클라이언트·프리사인드 URL
│   │       └── celery_app.py       # Celery 앱 설정
│   ├── alembic/                    # DB 마이그레이션
│   ├── tests/
│   └── requirements.txt
│
├── design-system/                  # W3C 디자인 토큰
├── design/                         # Pencil 프로토타입
├── docs/                           # 기획 문서
├── specs/                          # SDD 스펙
├── .claude/                        # Claude 하네스
└── .specify/                       # Spec-kit
```

---

## 3. API 명세 (REST)

> Base URL: `/api/v1` · 인증: `Authorization: Bearer <JWT>` · Content-Type: `application/json`

### 3.1 인증 (auth)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `POST` | `/auth/register` | 회원가입 (역할 선택) | Guest |
| `POST` | `/auth/verify-email` | 이메일 OTP 인증 | Guest |
| `POST` | `/auth/login` | 로그인 → JWT+Refresh | Guest |
| `POST` | `/auth/refresh` | Refresh Token → 새 Access | Guest |
| `POST` | `/auth/logout` | 로그아웃 (Refresh 폐기) | All |
| `POST` | `/auth/reset-password` | 비밀번호 재설정 메일 발송 | Guest |
| `PUT`  | `/auth/password` | 새 비밀번호 설정 (토큰 검증) | Guest |

### 3.2 사용자 (users)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `GET` | `/users/me` | 내 프로필 | All |
| `PUT` | `/users/me` | 프로필 수정 | All |
| `POST` | `/users/me/onboarding` | 온보딩 단계 저장 | All |
| `PUT` | `/users/me/notification-settings` | 알림 설정 | All |

### 3.3 세션 (sessions)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `GET` | `/sessions` | 내 세션 목록 (필터: 상태·날짜) | All |
| `POST` | `/sessions` | 세션 생성 | Counselor |
| `GET` | `/sessions/{id}` | 세션 상세 | Participant |
| `PUT` | `/sessions/{id}` | 세션 수정 | Host |
| `DELETE` | `/sessions/{id}` | 세션 삭제 | Host |
| `POST` | `/sessions/{id}/start` | 세션 시작 → '진행중' | Host |
| `POST` | `/sessions/{id}/pause` | 일시정지 | Host |
| `POST` | `/sessions/{id}/resume` | 재개 | Host |
| `POST` | `/sessions/{id}/end` | 세션 종료 → '완료' + AI 트리거 | Host |
| `POST` | `/sessions/{id}/cancel` | 세션 취소 | Host |
| `POST` | `/sessions/{id}/invite` | 내담자 초대 (이메일) | Host |
| `POST` | `/sessions/{id}/markers` | 마커 추가 (타임스탬프+메모) | Host |

### 3.4 내담자 (clients)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `GET` | `/clients` | 내담자 목록 (검색·필터·태그) | Counselor |
| `GET` | `/clients/{id}` | 내담자 프로필·이력 | Counselor |
| `PUT` | `/clients/{id}/tags` | 태그 수정 | Counselor |
| `GET` | `/clients/{id}/journal` | 세션 저널 | Counselor |
| `POST` | `/clients/{id}/journal` | 저널 엔트리 추가 | Counselor |

### 3.5 채팅 (chat)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `GET` | `/chat/rooms` | 내 채팅방 목록 | All |
| `GET` | `/chat/rooms/{id}/messages` | 메시지 내역 (커서 페이징) | Participant |
| `POST` | `/chat/rooms/{id}/messages` | 메시지 전송 | Participant |

### 3.6 세션 기록 (records)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `GET` | `/sessions/{id}/record` | AI 기록지 조회 | Host |
| `PUT` | `/sessions/{id}/record` | 기록지 편집 | Host |
| `GET` | `/sessions/{id}/transcript` | STT 전사문 | Host |

### 3.7 리포트 (reports)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `GET` | `/reports` | 내 리포트 목록 | All |
| `GET` | `/reports/{id}` | 리포트 상세 | Participant |
| `POST` | `/reports/{id}/send` | 내담자에게 발송 | Host |
| `GET` | `/reports/{id}/pdf` | PDF 다운로드 (프리사인드 URL) | Participant |

### 3.8 EEG (eeg)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `POST` | `/sessions/{id}/eeg/connect` | BLE 연결 등록·WebSocket 채널 개설 | Host |
| `GET` | `/sessions/{id}/eeg/analysis` | 분석 결과 조회 | Host |

### 3.9 자격·센터 (credentials)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `POST` | `/credentials/upload` | 증빙 업로드 → 비동기 검증 | Counselor |
| `GET` | `/credentials` | 내 자격 목록·상태 | Counselor |
| `POST` | `/centers` | 신규 센터 등록 (사업자등록증) | Counselor |
| `GET` | `/centers/search` | 기존 센터 검색 (자동완성) | Counselor |
| `POST` | `/centers/{id}/join` | 센터 가입 신청 | Counselor |

### 3.10 어드민 (admin)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `GET` | `/admin/verification-queue` | 검토 큐 목록 | PlatformAdmin |
| `POST` | `/admin/verification-queue/{id}/approve` | 승인 | PlatformAdmin |
| `POST` | `/admin/verification-queue/{id}/reject` | 반려 (+ 사유) | PlatformAdmin |
| `POST` | `/admin/verification-queue/{id}/request-more` | 추가 자료 요청 | PlatformAdmin |

### 3.11 알림 (notifications)

| Method | Path | 설명 | RBAC |
|--------|------|------|:---:|
| `GET` | `/notifications` | 내 알림 목록 | All |
| `PUT` | `/notifications/{id}/read` | 읽음 처리 | All |
| `GET` | `/notifications/settings` | 알림 채널 설정 | All |

---

## 4. WebSocket 프로토콜

### 4.1 네임스페이스

| Namespace | 용도 | 인증 |
|-----------|------|:---:|
| `/eeg` | 실시간 EEG 데이터 + 분석 결과 | JWT (Host 전용) |
| `/chat` | 실시간 채팅 메시지 | JWT |
| `/sessions` | 세션 상태 변경 브로드캐스트 | JWT |

### 4.2 EEG 이벤트

```typescript
// Client → Server
{ event: "eeg:connect", data: { sessionId: string } }
{ event: "eeg:data",    data: { sessionId: string, timestamp: number, channel1: number[], channel2: number[] } }

// Server → Client
{ event: "eeg:analysis", data: { concentration: number, relaxation: number, stress: number, timestamp: number } }
{ event: "eeg:alert",    data: { type: "stress_spike" | "disconnect", message: string } }
```

### 4.3 채팅 이벤트

```typescript
// Client → Server
{ event: "chat:send", data: { roomId: string, text: string, fileUrl?: string } }

// Server → Client
{ event: "chat:message", data: { id: string, roomId: string, senderId: string, text: string, sentAt: string } }
{ event: "chat:system",  data: { roomId: string, type: "session_confirmed" | "report_ready", message: string } }
```

---

## 5. 데이터베이스 스키마

### 5.1 ERD (핵심)

```
User ──1:N── Session (host)
User ──M:N── Session (participant)
Session ──1:1── SessionRecord
Session ──1:N── EEGRecord (선택)
Session ──1:N── Report
User ──1:N── Credential
Credential ──1:N── VerificationAudit
User ──1:N── Notification
```

### 5.2 DDL (핵심 테이블)

```sql
-- 사용자
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(100) NOT NULL,
    role          VARCHAR(20) NOT NULL CHECK (role IN ('counselor', 'client', 'org_admin', 'platform_admin')),
    phone         VARCHAR(20),
    profile_image VARCHAR(500),
    bio           TEXT,
    org_id        UUID REFERENCES centers(id),
    verified_tier VARCHAR(20) DEFAULT 'unverified'
        CHECK (verified_tier IN ('verified_plus', 'verified', 'self_declared', 'unverified')),
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 세션
CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(20) NOT NULL CHECK (type IN ('clinical', 'hypnosis', 'meditation')),
    status          VARCHAR(20) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'in_progress', 'paused', 'completed', 'cancelled')),
    host_id         UUID NOT NULL REFERENCES users(id),
    scheduled_at    TIMESTAMPTZ NOT NULL,
    duration_min    INTEGER NOT NULL CHECK (duration_min BETWEEN 10 AND 180),
    title           VARCHAR(200),
    notes           TEXT,
    max_participants INTEGER DEFAULT 1,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- 세션 참여자
CREATE TABLE session_participants (
    session_id   UUID REFERENCES sessions(id) ON DELETE CASCADE,
    user_id      UUID REFERENCES users(id),
    band_connected BOOLEAN DEFAULT false,
    consent_audio  BOOLEAN DEFAULT false,
    consent_eeg    BOOLEAN DEFAULT false,
    PRIMARY KEY (session_id, user_id)
);

-- 세션 기록 (AI 요약)
CREATE TABLE session_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID UNIQUE NOT NULL REFERENCES sessions(id),
    transcript      TEXT,                              -- STT 전사문
    ai_summary      JSONB NOT NULL DEFAULT '{}',       -- AI 요약 구조화
    counselor_notes TEXT,
    markers         JSONB DEFAULT '[]',                -- [{timestamp, note, tag}]
    is_edited       BOOLEAN DEFAULT false,
    edit_history    JSONB DEFAULT '[]',
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- EEG 레코드 (LINK BAND 착용 시만)
CREATE TABLE eeg_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES sessions(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    s3_key          VARCHAR(500) NOT NULL,              -- S3 Parquet 경로
    duration_sec    INTEGER,
    sample_rate     INTEGER DEFAULT 250,
    analysis_result JSONB,                              -- {concentration, relaxation, stress, bands}
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- 리포트
CREATE TABLE reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES sessions(id),
    user_id     UUID NOT NULL REFERENCES users(id),
    type        VARCHAR(20) NOT NULL CHECK (type IN ('counselor', 'client')),
    content     JSONB NOT NULL,
    pdf_url     VARCHAR(500),
    sent_at     TIMESTAMPTZ,
    is_read     BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- 자격 증빙
CREATE TABLE credentials (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    type        VARCHAR(20) NOT NULL CHECK (type IN ('id_card', 'license', 'diploma', 'career')),
    s3_key      VARCHAR(500) NOT NULL,
    file_name   VARCHAR(255),
    ai_verdict  JSONB,                                  -- {verdict, risk_score, fields}
    status      VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'auto_approved', 'needs_review', 'approved', 'rejected')),
    expires_at  DATE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- 검증 감사 로그
CREATE TABLE verification_audits (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id UUID REFERENCES credentials(id),
    admin_id      UUID REFERENCES users(id),
    action        VARCHAR(20) NOT NULL,
    reason        TEXT,
    metadata      JSONB,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- 알림
CREATE TABLE notifications (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID NOT NULL REFERENCES users(id),
    type      VARCHAR(30) NOT NULL,
    title     VARCHAR(200) NOT NULL,
    body      TEXT,
    is_read   BOOLEAN DEFAULT false,
    metadata  JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. 프론트엔드 아키텍처

### 6.1 라우트 구조

```
/                           → 리다이렉트 (/login 또는 /dashboard)
/login                      → LoginPage
/register                   → RegisterPage (역할 선택 → 온보딩 Steps)
/onboarding/counselor/:step → 상담사 온보딩 (1-4)
/onboarding/client/:step    → 내담자 온보딩 (1-4)

/dashboard                  → HomeDashboard (오늘 예약·알림·통계)
/dashboard/schedule         → SchedulePage (캘린더·세션 CRUD)
/dashboard/clients          → ClientListPage
/dashboard/clients/:id      → ClientDetailPage
/dashboard/chat             → ChatListPage
/dashboard/chat/:roomId     → ChatRoomPage
/dashboard/sessions/:id/live → SessionLivePage (실시간 대시보드)
/dashboard/reports           → ReportListPage
/dashboard/reports/:id       → ReportDetailPage
/dashboard/credentials       → MyCredentialsPage
/dashboard/journal/:clientId → JournalPage

/admin/verification          → VerificationQueuePage (PlatformAdmin)
/admin/settings              → PlatformSettingsPage

/settings                    → ProfileSettingsPage
/settings/notifications      → NotificationSettingsPage
/settings/band               → LinkBandSettingsPage
```

### 6.2 상태 관리

| 스토어 | 상태 | 스코프 |
|--------|------|:---:|
| `authStore` | user, accessToken, refreshToken, isAuthenticated | 전역 |
| `sessionStore` | currentSession, sessions, activeSession | 전역 |
| `eegStore` | isConnected, rawData[], analysisResult, connectionStatus | 세션 |
| `chatStore` | rooms[], activeRoom, messages{}, unreadCount | 전역 |
| `notificationStore` | notifications[], unreadCount | 전역 |

### 6.3 컴포넌트 계층

```
App
├── AuthGuard (role check)
│   ├── CounselorLayout
│   │   ├── AppSidebar
│   │   ├── AppHeader (알림 종·프로필)
│   │   └── <Outlet /> (페이지)
│   ├── ClientLayout
│   └── AdminLayout
└── GuestLayout (로그인·회원가입)
```

---

## 7. BLE 연동 아키텍처

```
[React 컴포넌트]
   │  useBLE() hook
   ▼
[navigator.bluetooth]
   │  requestDevice({filters: [{services: [EEG_SERVICE_UUID]}]})
   ▼
[GATT Server 연결]
   │  getPrimaryService() → getCharacteristic()
   ▼
[Characteristic 구독]
   │  startNotifications() + addEventListener('characteristicvaluechanged')
   ▼
[DataView 파싱] ────▶ [Zustand eegStore] ────▶ [Socket.IO emit]
   │  24bit signed → μV                           │
   ▼                                               ▼
[Recharts 실시간 차트]                    [FastAPI WebSocket 서버]
                                                   │
                                                   ▼
                                          [버퍼링 → S3 Parquet]
```

---

## 8. AI 파이프라인 (Celery 태스크)

```
# Celery 태스크 체인
stt_chain = chain(
    merge_audio_chunks.s(session_id),          # S3 청크 병합
    gemini_audio_stt.s(session_id),            # Gemini Audio STT+화자분리 (1차)
    save_transcript.s(session_id),             # 전사문 저장
    claude_summarize.s(session_id),            # Claude 요약 → 기록지
    save_record.s(session_id),                 # 기록지 저장
)

# 폴백 체인 (Gemini 실패 시)
stt_fallback_chain = chain(
    whisper_stt.s(session_id),                 # Whisper STT
    pyannote_diarize.s(session_id),            # pyannote 화자분리
    merge_segments.s(session_id),              # 세그먼트 병합
    claude_summarize.s(session_id),
    save_record.s(session_id),
)

# EEG 분석 체인
eeg_chain = chain(
    load_eeg_from_s3.s(session_id),            # S3 Parquet 로드
    looxid_sdk_analyze.s(session_id),          # Looxid SDK 분석
    save_eeg_analysis.s(session_id),           # 결과 저장
    generate_eeg_report.s(session_id),         # 리포트 통합
)

# 자격 검증 체인
verification_chain = chain(
    gemini_ocr.s(credential_id),               # Gemini Vision OCR
    classify_document.s(credential_id),        # 문서 유형 분류
    check_business_status.s(credential_id),    # 국세청 API (센터만)
    cross_validate.s(credential_id),           # 교차 일관성
    rule_engine_verdict.s(credential_id),      # 판정
)
```

---

## 9. 인증·인가

### 9.1 JWT 토큰

| 토큰 | 유효기간 | 저장 위치 |
|------|:---:|------|
| Access Token | 15분 | 메모리 (Zustand) |
| Refresh Token | 14일 | httpOnly 쿠키 + DB |

### 9.2 RBAC 매트릭스

| 리소스 | Guest | Client | Counselor | OrgAdmin | PlatformAdmin |
|--------|:---:|:---:|:---:|:---:|:---:|
| 세션 생성 | ❌ | ❌ | ✅ | ❌ | ❌ |
| 세션 참여 | ❌ | ✅ | ❌ | ❌ | ❌ |
| 내담자 관리 | ❌ | ❌ | ✅ | ❌ | ❌ |
| EEG 대시보드 | ❌ | ❌ | ✅ | ❌ | ❌ |
| 리포트 열람 | ❌ | ✅ | ✅ | ❌ | ❌ |
| 센터 관리 | ❌ | ❌ | ❌ | ✅ | ❌ |
| 검토 큐 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 사용자 정지 | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 10. 배포 인프라

### 10.1 AWS 리소스

| 리소스 | 사양 | 용도 |
|--------|------|------|
| ECS Fargate (Web) | 1 vCPU / 2 GB × 2 | React SPA + FastAPI |
| ECS Fargate (Worker) | 2 vCPU / 4 GB × 1 | Celery Worker |
| RDS PostgreSQL | db.t4g.medium | OLTP + 세션·사용자 |
| ElastiCache Redis | cache.t4g.micro | Celery 브로커 + 세션 캐시 |
| S3 | Standard | 음성·PDF·Parquet·증빙 |
| CloudFront | — | S3 정적 자산 CDN |
| ALB | — | HTTPS 종단 + 라우팅 |

### 10.2 CI/CD (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
on: push → branches: [main]
jobs:
  test:
    - npm test (frontend)
    - pytest (backend)
  build:
    - npm run build (frontend)
    - docker build (backend)
  deploy:
    - aws ecs update-service (Web + Worker)
```

---

## 11. 보안

| 영역 | 조치 |
|------|------|
| 전송 | TLS 1.3 (ALB 종단) |
| 비밀번호 | Argon2id 해싱 |
| 토큰 | JWT + Refresh Rotation + 탈취 감지 |
| 파일 | S3 SSE-KMS 암호화, 프리사인드 URL (5분) |
| API | Rate Limit (100 req/min/IP), CORS 화이트리스트 |
| 입력 | Pydantic 검증 + SQL 인젝션 방지 (파라미터화) |
| 로그 | 감사 로그 (VerificationAudit), 접근 로그 (미들웨어) |
| EEG | 접근 제어 (본인 세션 + 담당 상담사만), 저장 암호화 |

---

## 12. 테스트 전략

| 계층 | 도구 | 커버리지 목표 |
|------|------|:---:|
| Unit (FE) | vitest + React Testing Library | ≥80% |
| Unit (BE) | pytest | ≥85% |
| Integration | pytest + httpx (FastAPI TestClient) | 핵심 플로우 |
| E2E | Playwright | 로그인·세션·리포트 |
| BLE | Mock Web Bluetooth API | 연결·데이터·재연결 |
| WebSocket | pytest-asyncio + Socket.IO test client | EEG·채팅 |

---

## 13. 개발 환경

```bash
# 사전 요구사항
Node.js ≥18 · Python ≥3.11 · PostgreSQL 16 · Redis 7 · Docker

# 환경변수 (.env)
DATABASE_URL=postgresql://user:pass@localhost:5432/mindbreeze
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=xxx
GEMINI_API_KEY=xxx
ANTHROPIC_API_KEY=xxx
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
S3_BUCKET=mindbreeze-dev

# 실행
cd frontend && npm install && npm run dev        # localhost:5173
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload  # localhost:8000
docker run -d --name redis -p 6379:6379 redis:7-alpine
celery -A app.core.celery_app worker --loglevel=info
```

---

*본 문서는 MIND BREEZE 2.0의 개발 착수에 필요한 모든 기술적 의사결정을 포함합니다. 각 스프린트 시작 전 해당 spec의 plan.md와 정합성을 확인합니다.*
