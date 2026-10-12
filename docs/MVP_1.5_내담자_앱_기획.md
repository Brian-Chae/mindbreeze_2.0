# MIND BREEZE 2.0 — MVP 1.5 내담자 앱 기획

| 항목 | 값 |
|------|-----|
| **현재 버전** | `v1.6.0` |
| **문서 상태** | `Draft` |
| **최초 작성** | 2026-05-23 |
| **최종 수정** | 2026-05-23 |
| **문서 소유** | Product / Brian |
| **상위 문서** | `docs/MIND_BREEZE_2.0_종합_기획.md` v1.3.0, `docs/MIND_BREEZE_2.0_기능명세서.md` v1.1.0 |

### 0.1 변경 이력

| 버전 | 일자 | 변경 요약 | 작성 |
|------|------|----------|------|
| `v1.6.0` | 2026-05-23 | §9 SDD 리스트 — C01~C06 6개 SDD (인증·페이지·셸·채팅·세션·프로필). QA List 포함. 의존성 그래프. 총 12~15일 | — |
| `v1.5.0` | 2026-05-23 | §2D 초대 기반 모델 + N:M 상담사 관계 — ClientCounselor 조인 테이블, 상담사 코드 입력, 상담사 無 상태, 복수 상담사 UX. §2B.2c·§2C·§7 데이터 모델 전면 개정 | — |
| `v1.4.0` | 2026-05-23 | §2B.2~2C 필수 정보 수집 적용 — Google OAuth 후 필수 정보 1페이지(이름·성별·생년월일·휴대전화번호). `onboarding_completed=false` → `essentials`. ClientEssentialsPage 신설, Phase 0 업데이트 | — |
| `v1.3.0` | 2026-05-23 | §2B 간편 인증 — Google OAuth(신규)·이메일(기존)·Kakao(예정). 초대 링크+Google 1클릭 가입. §2C 통합 인증 라우팅 | — |
| `v1.2.0` | 2026-05-23 | §2A 인증 플로우 추가 — 초대 랜딩·회원가입·로그인·인증 상태 라우팅. 3개 기존 페이지 리팩토링 계획. Phase 0 신설 | — |
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

## 2D. 초대 기반 모델 + N:M 상담사 관계

> **핵심 전제:** MIND BREEZE는 내담자가 상담사를 **탐색·선택하지 않는다.** 모든 관계는 상담사의 **초대(invite)** 또는 **상담사 코드 입력**으로만 성립한다. 상담사가 배정되지 않은 내담자는 어떤 기능도 사용할 수 없다.

### 2D.1 서비스 모델

| 속성 | 설명 |
|------|------|
| 상담사 탐색 | ❌ 없음. 상담사 검색·목록·추천 기능 없음 |
| 관계 성립 | ✅ 초대 링크 (counselor code 자동 포함) 또는 상담사 코드 수동 입력 |
| 관계 유형 | **N:M** — 내담자는 여러 상담사와, 상담사는 여러 내담자와 관계 |
| 동시 진행 | 내담자는 여러 상담사와 동시에 각각 다른 세션·채팅 진행 가능 |
| 상담사 코드 | 상담사 가입 완료 시 자동 발급되는 6자리 고유 코드 (예: `A3F92K`) |

### 2D.2 N:M 데이터 모델

```python
# 기존: User.counselor_id (단일 FK) → 폐기
# 신규: ClientCounselor 조인 테이블

class ClientCounselor(Base):
    __tablename__ = "client_counselors"
    
    id = Column(UUID, primary_key=True, default=uuid4)
    client_id = Column(UUID, ForeignKey("users.id"), nullable=False, index=True)
    counselor_id = Column(UUID, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(20), default="active")  # "active" | "inactive"
    invited_by = Column(String(20))                 # "counselor" | "client"
    created_at = Column(DateTime, default=utcnow)
    
    client = relationship("User", foreign_keys=[client_id])
    counselor = relationship("User", foreign_keys=[counselor_id])
    
    __table_args__ = (
        UniqueConstraint("client_id", "counselor_id", name="uq_client_counselor"),
    )
```

**User 모델 변경:**
```python
class User(Base):
    # ... 기존 필드 ...
    
    # 제거: counselor_id (더 이상 단일 FK 아님)
    
    # 신규: 다대다 관계
    counselors = relationship(
        "User",
        secondary="client_counselors",
        primaryjoin="User.id == ClientCounselor.client_id",
        secondaryjoin="User.id == ClientCounselor.counselor_id",
        viewonly=True,
    )
    clients = relationship(
        "User",
        secondary="client_counselors",
        primaryjoin="User.id == ClientCounselor.counselor_id",
        secondaryjoin="User.id == ClientCounselor.client_id",
        viewonly=True,
    )
```

### 2D.3 상담사 코드 기반 관계 성립

**두 가지 경로:**

| 경로 | 트리거 | 흐름 |
|------|--------|------|
| **초대** | 상담사가 내담자 초대 전송 | 초대 이메일 → 링크 클릭 → 코드 자동 포함 → 가입 시 자동 매칭 |
| **코드 입력** | 내담자가 직접 코드 입력 | 프로필 → "상담사 코드 입력" → 6자리 코드 → 매칭 |

**코드 매칭 로직:**
```python
# POST /api/v1/client/counselors
async def add_counselor(client_user, code: str):
    # 1. 코드로 상담사 찾기
    counselor = await find_user_by_counselor_code(code)
    if not counselor or counselor.role != "counselor":
        raise HTTPException(404, "유효하지 않은 상담사 코드입니다")
    
    # 2. 이미 연결된 관계인지 확인
    existing = await find_client_counselor(client_user.id, counselor.id)
    if existing:
        if existing.status == "active":
            raise HTTPException(409, "이미 연결된 상담사입니다")
        else:
            # 비활성 관계 재활성화
            existing.status = "active"
            await save(existing)
            return existing
    
    # 3. 새 관계 생성
    relation = ClientCounselor(
        client_id=client_user.id,
        counselor_id=counselor.id,
        status="active",
        invited_by="client",  # 내담자가 직접 입력
    )
    await save(relation)
    
    # 4. 상담사에게 알림 (선택)
    await notify_counselor_new_client(counselor.id, client_user.id)
    
    return relation
```

### 2D.4 상담사 無 상태 (No Counselor)

**내담자가 상담사가 한 명도 없을 때:**

```
┌─────────────────────────────────┐
│                                 │
│         🌿                       │
│                                 │
│  아직 연결된 상담사가 없어요      │
│                                 │
│  상담사에게 받은 6자리 코드를     │
│  입력하면 상담을 시작할 수 있어요  │
│                                 │
│  ┌─────────────────────────┐    │
│  │  _  _  _  _  _  _       │    │
│  └─────────────────────────┘    │
│  [      상담사 연결하기     ]    │
│                                 │
│  상담사가 아직 코드를 안 줬다면   │
│  상담사에게 요청해보세요         │
│                                 │
└─────────────────────────────────┘
```

- **모든 탭 비활성:** 채팅·세션·리포트 탭 접근 불가 (리디렉트 또는 "상담사 연결 필요" 안내)
- **프로필만 활성:** 상담사 코드 입력 가능
- **첫 상담사 연결 시:** 바로 `/app` 오늘 화면으로 전환

### 2D.5 복수 상담사 UX

**오늘 화면 (Home):**
- 상담사별 다음 세션 카드 (여러 상담사가 있으면 복수 카드)
- "전체" 탭과 상담사별 필터 탭

```
오늘
─────────────────────────────────
[전체] [김상담] [이명상]          ← 상담사 필터 (좌우 스크롤)

┌─────────────────────────────┐
│ 김상담 ・ 명상 지도사         │
│ 다음 명상 수업                │
│ 5월 25일 (월) 오후 3시        │
│               [예정] →       │
└─────────────────────────────┘

┌─────────────────────────────┐
│ 이명상 ・ 임상 심리상담사      │
│ 다음 상담                     │
│ 5월 26일 (화) 오전 10시       │
│               [예정] →       │
└─────────────────────────────┘
```

**채팅 (Chat):**
- 상담사별 채팅방 목록 (이름 + 최근 메시지)
- 상담사가 여러 명이면 여러 채팅방

**세션 (Sessions):**
- 전체 상담사 세션 통합 캘린더
- 상담사별 색상 구분 (dot/바)
- 상담사 필터

**프로필 (Profile):**
- "내 상담사" 섹션 — 연결된 모든 상담사 목록
- 각 상담사: 이름·소속·자격 뱃지·연결 상태
- "+ 상담사 코드 입력" 버튼 (항상 표시)

### 2D.6 백엔드 변경

**신규 API:**

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/v1/client/counselors` | 내 상담사 목록 |
| `POST` | `/api/v1/client/counselors` | 상담사 코드로 추가 (Body: `{code}`) |
| `DELETE` | `/api/v1/client/counselors/:id` | 상담사 연결 해제 (비활성화) |

**기존 API 변경:**

| API | 변경 |
|-----|------|
| `GET /api/v1/sessions?role=client` | 모든 연결된 상담사의 세션 중 내가 참여자인 것 |
| `GET /api/v1/chat/rooms` | 모든 연결된 상담사와의 채팅방 |
| `GET /api/v1/reports?role=client` | 모든 연결된 상담사가 발행한 내 리포트 |
| `GET /api/v1/users/me` | `counselors[]` 필드 추가 (연결된 상담사 목록) |

### 2D.7 라우트 업데이트

| 경로 | 화면 | 상태 |
|------|------|------|
| `/onboarding/client/essentials` | 필수 정보 입력 | onboarding_completed=false |
| `/app` | **상담사 없음 화면** (코드 입력) | 상담사 0명 |
| `/app` | 오늘 화면 | 상담사 1명 이상 |
| `/app/profile` | 프로필 (상담사 목록 + 코드 입력) | 항상 접근 가능 |

**라우팅 로직:**
```typescript
if (user.role === 'client' && user.onboarding_completed) {
  if (user.counselors.length === 0) {
    → /app (상담사 無 상태 — 코드 입력 화면)
  } else {
    → /app (정상 오늘 화면)
  }
}
```

---

## 2A. 인증 플로우 — 로그인·회원가입·초대

> **기존 페이지 상태:** `ClientLoginPage`, `ClientOnboardingPage`, `InviteLandingPage`가 이미 존재하나, ① 구 디자인(에메랄드 그라데이션·회색 텍스트) ② 상담사 AppShell 기반 레이아웃 ③ 로그인 후 잘못된 리디렉션(`/clients`) 문제가 있다. MVP 1.5에서 Clinical Garden 디자인과 모바일 셸에 맞게 **전면 재작성**한다.

### 2A.1 전체 인증 흐름

```
[초대 이메일 수신]
       ↓
[InviteLandingPage]  ← 초대 링크 클릭 (/invite/:token)
       │               상담사명·센터 표시 + "가입하기" / "로그인" 버튼
       ↓
[ClientOnboardingPage]  ← 신규 가입 (/onboarding/client)
       │                  4단계: 기본정보 → 상세정보 → 프로필 → 상담사 코드
       ↓
[ClientLoginPage]  ← 기존 회원 로그인 (/login/client)
       │             이메일·비밀번호
       ↓
[ClientHomePage]  ← /app (오늘 화면)
```

### 2A.2 AU-01 — 초대 랜딩 (InviteLandingPage)

**리팩토링 대상:** 기존 `pages/clients/InviteLandingPage.tsx`

| 항목 | 기존 | 변경 |
|------|------|------|
| 디자인 | `bg-gradient-to-br from-emerald-50 to-blue-50`, `text-gray-500` | Clinical Garden — `bg-surface-canvas`, `text-ink-primary`, `rounded-[20px]` |
| 상담사 정보 | 텍스트만 | 상담사 프로필 카드 (아바타·이름·소속·자격 뱃지) |
| 액션 | 단일 버튼 | "가입하기" (→ `/onboarding/client`) + "로그인" (→ `/login/client`) 분리 |

**레이아웃:** 모바일 430px居中. 상단: MIND BREEZE 로고 + "초대합니다" 타이틀. 중앙: 상담사 프로필 카드. 하단: CTA 버튼 2개.

### 2A.3 AU-02 — 내담자 회원가입 (ClientOnboardingPage)

**리팩토링 대상:** 기존 `pages/onboarding/ClientOnboardingPage.tsx`

- 4단계 구조는 유지하되, Clinical Garden 디자인 시스템 적용
- Step Indicator: `text-brand-primary` 활성 단계, `rounded-full` 번호
- 입력 필드: `rounded-[20px] border-[#EFEFEF]`, `text-base`(16px, iOS 확대 방지)
- 상담사 코드 입력: OTP 스타일 6칸 (각 칸 `w-12 h-14 rounded-xl border-2 text-2xl text-center`)
- 완료 후: `/login/client`로 리디렉트 + "이제 로그인해주세요" 메시지

**기존 기능 유지:** `saveClientStep1` ~ `matchClientWithCounselor` API 그대로 사용.

### 2A.4 AU-03 — 내담자 로그인 (ClientLoginPage)

**리팩토링 대상:** 기존 `pages/ClientLoginPage.tsx`

| 항목 | 기존 | 변경 |
|------|------|------|
| 리디렉션 | `navigate('/clients')` | `navigate('/app')` — 내담자 홈으로 |
| 디자인 | `bg-gradient-to-br from-purple-50 to-indigo-50` | Clinical Garden 전체 적용 |
| 회원가입 링크 | 없음 | "처음이신가요? 가입하기" → `/onboarding/client` |
| 초대 코드 | 없음 | "초대 코드가 있으신가요?" → `/invite/:token` (토큰 없으면 입력창) |

**레이아웃 (좌우 분할, 모바일은 상하):**
- 좌측 (PC): 브랜드 패널 — MIND BREEZE 로고 + "당신의 마음쉼" 태그라인 + 배경 이미지
- 우측 (PC) / 하단 (모바일): 로그인 폼 — 이메일·비밀번호·로그인 버튼·비밀번호 찾기·가입하기

### 2A.5 인증 상태 라우팅

```typescript
// RoleRouter 로직
if (!user) → 로그인/가입 페이지만 접근 가능 (PublicRoute)
if (user.role === 'client' && !user.onboarding_completed) → /onboarding/client
if (user.role === 'client' && user.onboarding_completed) → /app (ClientShell)
if (user.role === 'counselor' && !user.onboarding_completed) → /onboarding/counselor
if (user.role === 'counselor' && user.onboarding_completed) → /dashboard (AppShell)
```

---

## 2B. 간편 인증 (Google OAuth + 이메일)

> **목표:** 내담자의 회원가입·로그인 진입 장벽을 낮춘다. 초대 링크 → Google 클릭 한 번 → 앱 진입. 4단계 온보딩을 최대한 생략하거나 후순위로 미룬다.

### 2B.1 인증 수단

| 수단 | MVP 1.5 | MVP2 | 비고 |
|------|:---:|:---:|------|
| **Google OAuth** | ✅ 신규 | — | 1순위 간편가입 |
| **이메일 + 비밀번호** | ✅ 기존 | — | 폴백·기존 회원 |
| **Kakao OAuth** | — | ✅ | 국내 사용자 타겟 |

### 2B.2 Google OAuth 플로우 (필수 정보 수집 적용)

```
[초대 링크] → InviteLandingPage
                 │
                 ├─ "Google로 시작하기" → Google OAuth 팝업
                 │       ↓
                 │   Google 계정 선택 → 동의
                 │       ↓
                 │   Backend: token 검증 → email 기준 User find-or-create
                 │       ↓
                 │   초대 토큰으로 상담사 자동 매칭
                 │       ↓
                 │   → /onboarding/client/essentials (필수 정보 1페이지)
                 │       ↓
                 │   이름(Google 자동입력) + 성별 + 생년월일 + 휴대전화번호
                 │       ↓
                 │   → /app (진입)
                 │
                 └─ "이메일로 가입하기" → ClientOnboardingPage (기존 4단계,
                    Step 1~2에서 필수 정보 수집)
```

**핵심 변경:**
- ~~온보딩 4단계 전면 생략~~ → **필수 정보 1페이지로 압축**
- Google에서 이름·이메일은 자동 확보 → 성별·생년월일·휴대전화번호만 추가 입력
- `onboarding_completed = false` 유지 → 필수 정보 입력 완료 후 `true`로 전환
- 기존 이메일 가입도 Step 1~2에 이 필드들이 필수로 포함됨

### 2B.2a 필수 수집 정보

| 필드 | Google OAuth | 이메일 가입 | 사유 |
|------|:---:|:---:|------|
| **이름** | ✅ 자동 (Google) | 필수 입력 | 내담자 식별·호칭 |
| **이메일** | ✅ 자동 (Google) | 필수 입력 | 계정·연락 |
| **성별** | ⬜ 필수 입력 | 필수 입력 | 상담 시 기본 정보, 리포트 개인화 |
| **생년월일** | ⬜ 필수 입력 | 필수 입력 | 연령대 분석, 상담 접근법 |
| **휴대전화번호** | ⬜ 필수 입력 | 필수 입력 | 긴급 연락, 세션 리마인더 |
| 관심 분야 | — | Step 2 (선택) | 상담사 매칭 보조 |
| 프로필 사진 | — | Step 3 (선택) | 나중에 설정 가능 |

### 2B.2b Google OAuth 이후 — 필수 정보 페이지 (`/onboarding/client/essentials`)

```
┌─────────────────────────────────┐
│  ←  거의 다 됐어요!              │
│                                 │
│  상담사가 당신을 더 잘 이해할 수  │
│  있도록 아래 정보를 입력해주세요   │
│                                 │
│  이름                           │
│  [홍길동           ]  ✓ Google  │  ← 비활성 (Google에서 가져옴)
│                                 │
│  이메일                          │
│  [hong@example.com ]  ✓ Google  │  ← 비활성
│                                 │
│  성별                           │
│  [남성] [여성] [기타]            │  ← 필수 선택
│                                 │
│  생년월일                        │
│  [YYYY]년 [MM]월 [DD]일          │  ← 필수, 3개 select 또는 date picker
│                                 │
│  휴대전화번호                    │
│  [010-____-____]                │  ← 필수, 하이픈 자동
│                                 │
│  [      완료      ]              │
│                                 │
│  입력한 정보는 상담 목적 외에      │
│  사용되지 않습니다 🔒             │
└─────────────────────────────────┘
```

**백엔드:** `PATCH /api/v1/users/me` 호출 → `onboarding_completed = true` → `/app` 진입

**Design:** Clinical Garden — `bg-surface-canvas`, `rounded-[20px]` 입력 필드, `text-base`(16px), 성별은 `mb-btn` 스타일 토글 버튼

### 2B.2c Google OAuth 백엔드 로직 (업데이트)

```python
async def google_auth(id_token: str, invite_token: str | None):
    # 1. Google ID token 검증
    payload = verify_google_token(id_token)
    email = payload["email"]
    name = payload.get("name", "")
    
    # 2. User find-or-create
    user = await find_user_by_email(email)
    if not user:
        user = await create_user(
            email=email,
            name=name,
            role="client",
            auth_provider="google",
            onboarding_completed=False
        )
    elif user.auth_provider != "google":
        raise HTTPException(409, "이미 이메일로 가입된 계정입니다. 이메일로 로그인해주세요.")
    
    # 3. 초대 토큰 처리 → ClientCounselor 관계 생성
    if invite_token:
        invite = await get_invite_by_token(invite_token)
        if invite:
            await create_client_counselor(
                client_id=user.id,
                counselor_id=invite.counselor_id,
                status="active",
                invited_by="counselor"
            )
            await mark_invite_accepted(invite_token)
    
    # 4. JWT 발급 (FE에서 onboarding_completed 확인 → essentials 또는 /app)
    return create_jwt(user)
```

### 2B.3 로그인 페이지 재설계

**ClientLoginPage** — 두 가지 로그인 경로:

```
┌─────────────────────────────────┐
│      MIND BREEZE                │
│      당신의 마음쉼               │
├─────────────────────────────────┤
│                                 │
│  [G] Google로 로그인             │  ← 1순위 (브랜드 컬러, 상단 배치)
│                                 │
│  ─────── 또는 ───────            │
│                                 │
│  이메일                          │
│  [________________]             │
│  비밀번호                        │
│  [________________]             │
│  [      로그인      ]            │
│                                 │
│  비밀번호 찾기 · 처음이신가요?    │
│  가입하기                       │
│                                 │
└─────────────────────────────────┘
```

**Google 버튼 디자인:**
- Google 브랜드 가이드라인 준수 (흰색 배경 + Google 'G' 로고 + "Google로 로그인")
- 또는 Clinical Garden에 맞게 커스텀 (sage 배경 + 흰색 Google 아이콘)

### 2B.4 초대 랜딩 재설계

**InviteLandingPage** — 초대 링크 진입 시:

```
┌─────────────────────────────────┐
│                                 │
│        🌿 MIND BREEZE           │
│                                 │
│  {상담사명}님의                  │
│  마음쉼에 초대합니다              │
│                                 │
│  ┌─────────────────────────┐    │
│  │ [상담사 프로필]           │    │
│  │  김상담 ・ 명상 지도사     │    │
│  │  마음쉼 상담센터           │    │
│  │  🛡️ Verified+           │    │
│  └─────────────────────────┘    │
│                                 │
│  [G] Google로 시작하기          │  ← 1순위 CTA
│                                 │
│  이메일로 가입하기 →             │  ← 2순위 (작은 텍스트)
│                                 │
│  이미 계정이 있으신가요? 로그인 → │
│                                 │
└─────────────────────────────────┘
```

**Google 시작하기 선택 시:**
1. Google OAuth 팝업 → 계정 선택
2. Backend: `POST /api/v1/auth/google` 호출 (invite_token 포함)
3. Backend 처리:
   - Google ID token 검증
   - 이메일로 User find-or-create (`role='client'`)
   - invite_token으로 상담사 매칭 (`counselor_code` → `counselor_id` 저장)
   - `onboarding_completed = true` (Google OAuth는 온보딩 스킵)
   - 자체 JWT 발급 → 응답
4. Frontend: JWT 저장 → `/app` 리디렉트

### 2B.5 백엔드 변경

**신규 엔드포인트:**

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/v1/auth/google` | Google OAuth 로그인·가입 |
| `GET` | `/api/v1/auth/google/url` | Google OAuth 인증 URL 반환 |

**`POST /api/v1/auth/google` — Request:**
```json
{
  "id_token": "eyJ...",           // Google ID Token (Frontend에서 Google SDK로 획득)
  "invite_token": "abc123"        // optional — 초대 링크 통해 왔을 때만
}
```

**Backend 처리 로직:**
```python
# google_auth_service.py
async def google_auth(id_token: str, invite_token: str | None):
    # 1. Google ID token 검증 (google-auth 라이브러리)
    payload = verify_google_token(id_token)
    email = payload["email"]
    name = payload.get("name", "")
    
    # 2. User find-or-create
    user = await find_user_by_email(email)
    if not user:
        user = await create_user(
            email=email,
            name=name,
            role="client",
            auth_provider="google",
            onboarding_completed=True  # Google OAuth는 온보딩 스킵
        )
    
    # 3. 초대 토큰 처리 (상담사 매칭)
    if invite_token:
        invite = await get_invite_by_token(invite_token)
        if invite:
            user.counselor_id = invite.counselor_id
            await save_user(user)
            await mark_invite_accepted(invite_token)
    
    # 4. JWT 발급
    return create_jwt(user)
```

**필요 패키지:** `google-auth` (PyPI), `google-api-python-client`

**User 모델 확장:**
```python
class User(Base):
    # ... existing ...
    auth_provider = Column(String(20), default="email")  # "email" | "google" | "kakao"
    counselor_id = Column(UUID, ForeignKey("users.id"), nullable=True)
```

### 2B.6 프론트엔드 — Google SDK 연동

**Google Identity Services (GIS) — `@react-oauth/google` 패키지:**

```tsx
// GoogleLoginButton.tsx
import { useGoogleLogin } from '@react-oauth/google';

function GoogleLoginButton({ inviteToken }: { inviteToken?: string }) {
  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      const res = await fetch('/api/v1/auth/google', {
        method: 'POST',
        body: JSON.stringify({
          id_token: tokenResponse.credential,
          invite_token: inviteToken,
        }),
      });
      const { access_token } = await res.json();
      authStore.setToken(access_token);
      navigate('/app');
    },
    onError: () => setError('Google 로그인에 실패했습니다'),
  });

  return (
    <button onClick={() => login()} className="...">
      <GoogleIcon />
      Google로 {inviteToken ? '시작하기' : '로그인'}
    </button>
  );
}
```

**Google OAuth Client ID:** Google Cloud Console에서 등록. 승인된 리디렉션 URI에 프론트엔드 도메인 추가 필수.

**iOS Safari 주의사항:**
- Google OAuth 팝업이 iOS Safari에서 차단될 수 있음 → `useGoogleLogin`의 `ux_mode: 'redirect'` 옵션 사용
- 또는 `flow: 'auth-code'` 방식으로 PKCE 적용

### 2B.7 Kakao 로그인 (MVP2 예정)

**MVP1.5에서는 UI 준비만 (버튼 그레이아웃 + "준비 중" 툴팁):**

```
[G] Google로 로그인
[K] Kakao로 로그인  ← 비활성 (회색, "MVP2 출시 예정")
```

MVP2에서 추가 시:
- Kakao Developers에서 앱 등록 → REST API 키 발급
- `kakao-login` 패키지 또는 REST API 직접 연동
- Backend: `POST /api/v1/auth/kakao` 엔드포인트
- User 모델 `auth_provider = "kakao"`

---

## 2C. 통합 인증 상태 라우팅 (업데이트)

```typescript
// RoleRouter — 최종 버전
if (!user) {
  // 비로그인
  if (path.startsWith('/invite/')) → InviteLandingPage
  else if (path === '/login/client') → ClientLoginPage
  else if (path === '/onboarding/client') → ClientOnboardingPage
  else if (path === '/onboarding/client/essentials') → ClientEssentialsPage  // Google OAuth 후
  else → LandingPage (일반 방문자)
}
if (user.role === 'client') {
  if (!user.onboarding_completed) {
    if (user.auth_provider === 'google') → /onboarding/client/essentials
    else → /onboarding/client
  }
  else if (user.counselors.length === 0) {
    → /app?mode=no_counselor  // 상담사 無 상태 — 코드 입력 화면
  }
  else → /app (ClientShell 정상)
}
if (user.role === 'counselor') {
  if (!user.onboarding_completed) → /onboarding/counselor
  else → /dashboard (AppShell)
}
```

> **Google OAuth 가입자:** `onboarding_completed = false` → `/onboarding/client/essentials`로 이동 → 필수 정보(성별·생년월일·휴대전화번호) 입력 → `onboarding_completed = true` → `/app`
>
> **이메일 가입자:** `onboarding_completed = false` → `/onboarding/client` → 4단계(Step 1~2에서 필수 정보 수집) → `onboarding_completed = true` → `/app`

---

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
│   ├── ClientLoginPage.tsx      # 내담자 로그인 (리팩토링)
│   ├── onboarding/
│   │   ├── ClientOnboardingPage.tsx  # 내담자 가입 4단계 (리팩토링)
│   │   └── ClientEssentialsPage.tsx  # Google OAuth 후 필수 정보 (신규)
│   ├── clients/
│   │   └── InviteLandingPage.tsx     # 초대 랜딩 (리팩토링)
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
| `/invite/:token` | 초대 랜딩 | — (비로그인) |
| `/login/client` | 내담자 로그인 | — (비로그인) |
| `/onboarding/client` | 내담자 회원가입 (4단계) | — (비로그인) |
| `/onboarding/client/essentials` | 필수 정보 입력 (Google OAuth 후) | — (비로그인·로그인) |
| `/app` | 오늘 (Home) | 오늘 |
| `/app/chat` | 채팅방 목록 | 채팅 |
| `/app/chat/:roomId` | 채팅방 | — |
| `/app/sessions` | 내 세션 목록 | 세션 |
| `/app/sessions/:id` | 세션 상세 | — |
| `/app/profile` | 프로필 | 프로필 |
| `/app/reports/:id` | 리포트 상세 | — |
| `/app/notifications` | 알림 센터 | — |

> **비로그인 라우트**는 `ClientShell` 외부에서 렌더링. 로그인/가입 완료 후에만 `ClientShell`(탭바 포함) 진입.
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
| `POST` | `/api/v1/auth/google` | Google OAuth 로그인·가입 (ID token 검증 + User find-or-create) | **P0** |
| `GET` | `/api/v1/auth/google/url` | Google OAuth 인증 URL 반환 (옵션 — 프론트에서 직접 구성 가능) | **P1** |
| `GET` | `/api/v1/client/home` | 오늘 화면 집계 (다음 세션·최근 리포트·안 읽은 메시지) | **P0** |
| `GET` | `/api/v1/chat/unread-count` | 클라이언트별 안 읽은 메시지 총계 | **P0** |
| `POST` | `/api/v1/sessions/request` | 세션 신청 (시스템 메시지 자동 생성) | **P1** |

### 6.2 데이터 모델 변경

```python
# 제거: backend/app/models/user.py — counselor_id 필드
# 신규: backend/app/models/client_counselor.py — ClientCounselor 조인 테이블
#        Alembic: add_client_counselor_table + remove_user_counselor_id
```

상세한 모델 정의는 §7 참조.

### 6.3 신규 API (상담사 관계)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/v1/client/counselors` | 내 상담사 목록 (이름·소속·자격·상태) |
| `POST` | `/api/v1/client/counselors` | 상담사 코드로 추가 (Body: `{code}`) |
| `DELETE` | `/api/v1/client/counselors/:id` | 상담사 연결 해제 (비활성화) |

### 6.4 기존 API 권한 확장
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

### 7.1 신규 모델: ClientCounselor

MVP 1.5의 핵심 구조 변경 — 내담자↔상담사 N:M 관계를 위한 조인 테이블.

```python
# backend/app/models/client_counselor.py
class ClientCounselor(Base):
    __tablename__ = "client_counselors"
    
    id = Column(UUID, primary_key=True, default=uuid4)
    client_id = Column(UUID, ForeignKey("users.id"), nullable=False, index=True)
    counselor_id = Column(UUID, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(20), default="active")  # "active" | "inactive"
    invited_by = Column(String(20))                 # "counselor" | "client"
    created_at = Column(DateTime, default=utcnow)
    
    __table_args__ = (
        UniqueConstraint("client_id", "counselor_id", name="uq_client_counselor"),
    )
```

### 7.2 User 모델 변경

```python
class User(Base):
    # ... existing fields ...
    auth_provider = Column(String(20), default="email")  # "email" | "google" | "kakao"
    
    # 제거: counselor_id (N:M으로 대체)
    
    # 신규: 관계 (읽기 전용)
    counselors = relationship("User", secondary="client_counselors", ...)
    clients = relationship("User", secondary="client_counselors", ...)
```

### 7.3 기존 모델 활용 (변경 없음)

| 모델 | 필드 | 용도 |
|------|------|------|
| `User` | `role='client'` | Role Router 분기 |
| `User` | `counselor_code` | 상담사 고유 6자리 코드 (가입 시 자동 발급) |
| `ClientCounselor` | `client_id + counselor_id` | 내담자↔상담사 연결 (신규) |
| `Session` | `participants[]` | 내담자의 세션 목록 조회 |
| `ChatRoom` | `participants[]` | 내담자의 채팅방 목록 |
| `Report` | `recipient_id` | 내담자 대상 리포트 필터링 |
| `Message` | `type='system'`, `subtype='session_request'` | 세션 신청 메시지 |

---

## 8. 구현 로드맵

### Phase 0 — 인증 리팩토링 (2~3일)

| 작업 | 내용 |
|------|------|
| **InviteLandingPage** | Clinical Garden 디자인, 상담사 프로필 카드, "Google로 시작하기" CTA |
| **ClientLoginPage** | Clinical Garden 디자인, `/clients` → `/app` 리디렉션 수정, Google 로그인 버튼 |
| **ClientOnboardingPage** | Clinical Garden 디자인, OTP 스타일 코드 입력, Step 1~2에 필수 정보(성별·생년월일·휴대전화번호) 포함 |
| **ClientEssentialsPage** | Google OAuth 후 필수 정보 입력 1페이지 — 이름·이메일(Google 자동입력·비활성) + 성별·생년월일·휴대전화번호 |
| **GoogleLoginButton** | `@react-oauth/google` 연동, ID token → `/api/v1/auth/google` |
| **Google OAuth 백엔드** | `POST /api/v1/auth/google`, ID token 검증, User find-or-create, ClientCounselor 관계 생성 |
| **User 모델 확장** | `auth_provider` 필드, `counselor_id` 제거, `ClientCounselor` 조인 테이블 + Alembic 마이그레이션 |
| **RoleRouter** | App.tsx에 client/counselor 분기 + 인증 상태·제공자별 라우팅 |
| **Kakao 버튼 (UI only)** | 그레이아웃 + "MVP2 출시 예정" 툴팁 |

### Phase 1 — 기초·오늘 화면 (2~3일)

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
| FC.0 | 내담자 인증 (로그인·가입·초대) | 1.5 | Google OAuth·이메일·Kakao(예정), InviteLanding·ClientOnboarding·ClientLogin 리팩토링 |
| FC.0a | N:M 상담사 관계 | 1.5 | ClientCounselor 조인 테이블, 상담사 코드 입력, 상담사 無 상태, 복수 상담사 UX |
| FC.1 | 내담자 앱 셸 + 탭 내비게이션 | 1.5 | ClientShell·BottomTabBar |
| FC.2 | 내담자 오늘 화면 | 1.5 | 다음 세션·최근 리포트·메시지 배지 |
| FC.3 | 내담자-상담사 채팅 | 1.5 | 채팅방 목록·메시지·WebSocket |
| FC.4 | 내담자 세션 캘린더 | 1.5 | 월간 뷰·세션 상세·신청 |
| FC.5 | 내담자 리포트 조회 | 1.5 | 리포트 목록·상세·공유 |
| FC.6 | 내담자 프로필·설정 | 1.5 | 프로필·상담사 정보·알림 설정 |
| FC.7 | 내담자 세션 신청 | 1.5 | 시스템 메시지 기반 신청 |
| FC.8 | 내담자 앱 푸시 알림 | MVP2 | FCM/APNs (→MVP2로 이관) |

---

## 9. SDD 리스트 (Spec-Driven Development)

> 각 SDD는 `specs/<unix-ts>-<sdd-id>/` 디렉토리에 `spec.md` → `plan.md` → `tasks.md` 순으로 작성·구현한다.
> 우선순위: **P0**(차단) > **P1**(필수) > **P2**(가능 시). 의존성: 상위 SDD 완료 후 하위 SDD 진행.

### SDD-C01 — 인증·모델 기초

| 항목 | 값 |
|------|-----|
| **FC-ID** | FC.0 · FC.0a |
| **우선순위** | **P0** — 모든 SDD의 선행 조건 |
| **예상 기간** | 2~3일 |
| **의존성** | 없음 (MVP1 코드베이스) |
| **범위** | Google OAuth 백엔드, ClientCounselor 모델, Alembic 마이그레이션, RoleRouter |

**포함 작업:**
- [ ] `POST /api/v1/auth/google` — Google ID token 검증 + User find-or-create
- [ ] `ClientCounselor` 모델 + Alembic 마이그레이션 (`add_client_counselor`, `remove_user_counselor_id`)
- [ ] `User.auth_provider` 필드 추가 (`"email"` | `"google"`)
- [ ] `GET /api/v1/client/counselors` — 내 상담사 목록
- [ ] `POST /api/v1/client/counselors` — 상담사 코드로 추가
- [ ] Google OAuth 초대 토큰 연동 → `ClientCounselor` 자동 생성
- [ ] `App.tsx` — RoleRouter (client/counselor/비로그인 분기, 상담사 無 상태 분기)
- [ ] pytest: Google OAuth + ClientCounselor CRUD + RoleRouter 단위 테스트

**QA List (핵심):**
- [ ] Google ID token 위조 시 401
- [ ] 동일 이메일 Google↔이메일 중복 가입 시 409
- [ ] 초대 토큰 유효기간 만료 시 적절한 에러
- [ ] `GET /users/me` 응답에 `counselors[]` 포함
- [ ] `counselors.length === 0` → `/app?mode=no_counselor`

---

### SDD-C02 — 인증 페이지 (로그인·가입·초대·필수정보)

| 항목 | 값 |
|------|-----|
| **FC-ID** | FC.0 |
| **우선순위** | **P0** |
| **예상 기간** | 2~3일 |
| **의존성** | SDD-C01 (백엔드·모델 완료 후) |

**포함 작업:**
- [ ] **InviteLandingPage** — Clinical Garden 리팩토링, 상담사 프로필 카드, "Google로 시작하기" CTA
- [ ] **ClientLoginPage** — Clinical Garden, Google 로그인 버튼, `/clients` → `/app` 리디렉션 수정
- [ ] **ClientOnboardingPage** — Clinical Garden, Step1~2 필수 정보(성별·생년월일·휴대전화번호) 포함
- [ ] **ClientEssentialsPage** — Google OAuth 후 필수 정보 1페이지 (이름·이메일 Google 자동입력)
- [ ] **GoogleLoginButton** — `@react-oauth/google` 연동, ID token → 백엔드
- [ ] **Kakao 버튼 (UI only)** — 그레이아웃 + "MVP2 출시 예정" 툴팁
- [ ] `PATCH /api/v1/users/me` — 필수 정보 저장 + `onboarding_completed = true`
- [ ] vitest: 각 페이지 렌더링 + 폼 유효성 검사

**QA List (핵심):**
- [ ] 초대 링크 → Google 클릭 → 필수정보 입력 → `/app` 진입 (E2E)
- [ ] Google 로그인 실패 시 명확한 에러 메시지
- [ ] 이메일 로그인 → 4단계 온보딩 → `/app` 진입
- [ ] 필수 정보 누락 시 "완료" 버튼 비활성
- [ ] iOS Safari에서 input `text-base`(16px), 자동확대 없음
- [ ] Kakao 버튼 클릭 시 "MVP2 출시 예정" 토스트

---

### SDD-C03 — ClientShell + 오늘 화면

| 항목 | 값 |
|------|-----|
| **FC-ID** | FC.1 · FC.2 |
| **우선순위** | **P0** |
| **예상 기간** | 2~3일 |
| **의존성** | SDD-C02 (인증 완료 → 로그인 후 진입 가능) |

**포함 작업:**
- [ ] **ClientShell** — TopBar + BottomTabBar + 콘텐츠 `flex-1 min-h-0 overflow-y-auto`
- [ ] **BottomTabBar** — 4탭 (오늘·채팅·세션·프로필), safe-area-inset-bottom, 활성/비활성 스타일
- [ ] **ClientHomePage** — 오늘 화면 (다음 세션 카드 + 최근 리포트 + 메시지 배지)
- [ ] **상담사 無 화면** — OTP 스타일 코드 입력 6칸 + "상담사 연결하기"
- [ ] **상담사 필터 탭** — 좌우 스크롤, "전체" + 상담사별
- [ ] `GET /api/v1/client/home` — 오늘 화면 집계 API
- [ ] `POST /api/v1/client/counselors` — 상담사 코드 입력 → 실시간 연결
- [ ] iOS Safe Area + 키보드 대응 (`visualViewport`)

**QA List (핵심):**
- [ ] 상담사 0명 → 코드 입력 화면 → 코드 입력 → 바로 오늘 화면 전환
- [ ] 상담사 1명 → 오늘 화면에 해당 상담사 세션만 표시
- [ ] 상담사 3명 → 필터 탭 4개 (전체 + 3명), 탭별 세션 필터링
- [ ] 탭 전환 시 히스토리 독립 (각 탭은 자체 뒤로가기 스택)
- [ ] iPhone 노치·홈 인디케이터 영역 콘텐츠 가려짐 없음
- [ ] 채팅 탭 뱃지: 안 읽은 메시지 수 실시간 갱신

---

### SDD-C04 — 내담자 채팅

| 항목 | 값 |
|------|-----|
| **FC-ID** | FC.3 |
| **우선순위** | **P1** |
| **예상 기간** | 2일 |
| **의존성** | SDD-C03 (ClientShell + 탭 내비게이션) |

**포함 작업:**
- [ ] **ClientChatListPage** — 상담사별 채팅방 목록 (아바타·이름·마지막 메시지·안 읽은 뱃지)
- [ ] **ClientChatRoomPage** — 말풍선 (내담자/상담사/시스템), 입력창, 무한 스크롤
- [ ] WebSocket — Client role으로 Socket.IO 접속
- [ ] `GET /api/v1/chat/unread-count` — 안 읽은 메시지 총계
- [ ] 말풍선 디자인: 내담자(`bg-brand-primary`·우측), 상담사(`bg-white`·좌측), 시스템(중앙·회색)
- [ ] iOS 키보드 대응 — `useKeyboardHeight` 훅

**QA List (핵심):**
- [ ] 상담사 A와의 채팅방에서 메시지 송수신 정상
- [ ] 상담사 B와의 채팅방 별도 분리 (메시지 섞이지 않음)
- [ ] 상담사 無 상태 → 채팅 탭 접근 불가 (리디렉트)
- [ ] 새 메시지 수신 → 탭 뱃지 실시간 갱신
- [ ] iOS 키보드 올라올 때 입력창이 키보드 위에 정확히 위치
- [ ] 과거 메시지 무한 스크롤 (위로 스크롤 → 추가 로드)

---

### SDD-C05 — 내담자 세션 캘린더 + 신청

| 항목 | 값 |
|------|-----|
| **FC-ID** | FC.4 · FC.7 |
| **우선순위** | **P1** |
| **예상 기간** | 2일 |
| **의존성** | SDD-C03 (ClientShell) |

**포함 작업:**
- [ ] **ClientSessionListPage** — 월간 캘린더 + 당일 세션 리스트
- [ ] **ClientSessionDetailPage** — 세션 정보 + 상태별 액션 (입장/리포트)
- [ ] **세션 신청** — 채팅 시스템 메시지 기반 (`type=system, subtype=session_request`)
- [ ] 상담사별 세션 색상 구분 (dot·컬러 바)
- [ ] `GET /api/v1/sessions?role=client` — 모든 연결 상담사의 내 세션
- [ ] `POST /api/v1/sessions/request` — 시스템 메시지 생성

**QA List (핵심):**
- [ ] 캘린더에 세션 있는 날 dot 표시, 오늘 강조
- [ ] 상담사별 다른 색상 dot (최대 5색 순환)
- [ ] "세션 신청하기" → 채팅방에 시스템 메시지 "세션 요청" 전송
- [ ] 과거 세션 반투명 + "종료" 뱃지
- [ ] 상담사 無 상태 → 세션 탭 접근 불가

---

### SDD-C06 — 내담자 프로필·리포트·마무리

| 항목 | 값 |
|------|-----|
| **FC-ID** | FC.5 · FC.6 |
| **우선순위** | **P1** |
| **예상 기간** | 2일 |
| **의존성** | SDD-C04·C05 (채팅·세션 완료 후) |

**포함 작업:**
- [ ] **ClientProfilePage** — 내 정보 + 상담사 목록 + 리포트 링크 + 설정
- [ ] **리포트 연동** — 기존 ReportListPage/ReportDetailPage client role 연동
- [ ] **알림 설정** — 이메일 ON/OFF 토글
- [ ] **상담사 코드 입력** — 프로필에서 항상 접근 가능
- [ ] **로그아웃**
- [ ] **빈 상태** — 각 탭별 empty state UI ("아직 OO이 없어요" + CTA)
- [ ] 전체 QA: iOS Safari 실기기 테스트, build 통과 확인

**QA List (핵심):**
- [ ] 프로필에 연결된 모든 상담사 목록 표시 (이름·소속·자격 뱃지)
- [ ] "+ 상담사 코드 입력" → 코드 매칭 즉시 반영
- [ ] 잘못된 코드 입력 시 "유효하지 않은 상담사 코드입니다"
- [ ] 리포트 목록에서 모든 상담사의 내 리포트 통합 조회
- [ ] `npm run build` 통과, `npm test` 통과

---

### SDD 우선순위·의존성 그래프

```
SDD-C01 (인증·모델 기초) ── P0, 2~3d
    │
    └── SDD-C02 (인증 페이지) ── P0, 2~3d
            │
            └── SDD-C03 (셸 + 오늘) ── P0, 2~3d
                    │
                    ├── SDD-C04 (채팅) ── P1, 2d
                    ├── SDD-C05 (세션) ── P1, 2d
                    │
                    └── SDD-C06 (프로필·마무리) ── P1, 2d
```

**총 예상 기간: 12~15일** (순차 진행 기준. C04·C05 병렬 가능 시 10~12일)

---

## 10. 리스크·주의사항

| # | 리스크 | 대응 |
|---|--------|------|
| 1 | iOS Safari에서 `position:fixed` + 키보드 레이아웃 붕괴 | `ios-scroll-layout-pattern` 스킬 참고. flexbox 기반으로만 구현 |
| 2 | 채팅 API 권한 문제 (Counselor 전용 가정) | 백엔드 `get_current_user`에 Client role 대응 추가 (Phase 1 선행) |
| 3 | 내담자↔상담사 N:M 관계 마이그레이션 (기존 `counselor_id` → `ClientCounselor`) | Alembic 마이그레이션에 데이터 변환 스크립트 포함. 기존 데이터 있으면 `counselor_id` → `ClientCounselor` 행 자동 생성 |
| 4 | MVP1 상담사 UI와의 코드 충돌 | 내담자 페이지는 `pages/client/`에 격리. 공통 컴포넌트만 `components/` 공유 |
| 5 | 모바일 성능 (애니메이션·이미지) | `will-change` 최소화, 이미지 지연 로딩, Virtualize long lists |

---

## 문서 식별

**문서 식별:** `mindbreeze-2.0-mvp1.5-client-app` · 현재 `v1.6.0`

**상태:** Draft → 검토 요청 (Brian)
