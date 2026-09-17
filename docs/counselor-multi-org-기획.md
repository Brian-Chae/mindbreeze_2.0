# 상담사 다중 기관 소속(Multi-Org Membership) 기획안

> 작성일: 2026-09-17 · 상태: 초안(리뷰 대기)
> 범위: **기획안** — 데이터 모델·초대 흐름·권한·마이그레이션 설계. 구현 아님.

---

## 1. 배경 · 문제 정의

- **증상**: 기관 관리자가 상담사를 초대할 때, 해당 이메일이 이미 가입돼 있으면
  `409 "이미 등록된 이메일입니다. 다른 이메일을 사용해주세요."` 로 초대가 막힘.
- **근본 원인**: 초대 = "신규 계정 생성"과 동일시. `User.org_id` 가 **단일 FK** 라서
  한 상담사는 구조적으로 **하나의 기관에만** 소속될 수 있음.
- **실제 니즈**:
  - 프리랜서/겸직 상담사는 여러 상담센터에 동시에 소속되어 활동함.
  - 기존 상담사(계정 보유자)를 다른 기관이 초대하면 **계정 생성 없이 소속만 추가**되어야 함.
- **목표**:
  1. 상담사 1명이 **N개 기관에 소속** 가능 (계정은 1개, `counselor_code` 1개 유지)
  2. 초대 시 기존/신규 이메일을 **자동 분기** — 신규는 계정+소속 생성, 기존은 소속 추가
  3. 소속 추가/해제 후에도 권한·세션·리포트·대시보드가 기관별로 **일관 격리** 동작

---

## 2. 현재 구조 분석

### 2.1 데이터 모델

| 항목 | 현재 상태 | 파일 |
|---|---|---|
| `User.org_id` | 단일 nullable FK → `organizations.id`. 상담사·기관관리자 공용 | `backend/app/models/user.py:44` |
| `User.email` | **unique** — 계정 식별자(아이디). 전체 User 대상 중복 불가 | `user.py:34` |
| `User.role` | 계정 전역 단일 역할 (`counselor` / `client` / `org_admin` / `platform_admin`) | `user.py:37` |
| `User.status` / `invited_at` / `invite_expires_at` | 초대(pending) 상태·만료가 **계정에** 붙어 있음 (SDD-017) | `user.py` |
| `CounselorProfile` | `user_id` **unique** FK + `counselor_code` unique — 계정당 프로필/코드 1개 | `counselor_profile.py` |
| `Session` | `host_id`(상담사) + `organization_id`(**세션 시점 기관 스냅샷**, SDD-075) | `session.py` |
| `ClientCounselorLink` | 내담자–상담사 연결 (기관 무관) | `client_counselor_link.py` |
| `OrganizationJoinRequest` | 상담사 → 기관 가입 신청 (user_id, org_id, status) — 이미 존재 | `org_join_request.py` |

### 2.2 `User.org_id` 의존 지점 (약 46곳 — 이번 기획의 핵심 난점)

| 영역 | 의존 내용 |
|---|---|
| `org_service.invite_counselor` (line 473~) | 전체 User 대상 email 중복 검사(409) → `User(role=counselor, org_id=...)` + `CounselorProfile` 생성 |
| `org_management_service` | 구성원 목록 = `User.org_id == org.id` 조회, 역할 변경, 소속 해제 = `User.org_id = None` |
| `session_service` / `dashboard_service` / `report_service` | `User.org_id` 기준 소속 확인·리포트/대시보드 집계 |
| `org_service` (join/leave) | 가입 승인 시 `User.org_id` 설정, 탈퇴 시 해제 |
| `admin.py` / `org.py` / `org_public_service` | 기관 필터에 `User.org_id` 사용 |
| `deps.py:41` | **JWT 토큰에 org_id 1개** 를 담아 요청 컨텍스트로 사용 |

### 2.3 구조적 한계 정리

- 소속 = 계정 속성이므로: ① 다중 소속 불가 ② 초대 상태(pending)가 계정 상태와 뒤엉킴
  ③ 소속 해제 시 `org_id=None` 으로 **이력이 소실**됨 (언제 어느 기관에 있었는지 추적 불가).

---

## 3. 다중 소속 데이터 모델 — 대안 비교 · 권고

### 3.1 대안 요약

| 구분 | A. `UserOrgMembership` 테이블 신설 (전면 전환) | B. `User.org_id` 배열/JSON 확장 | C. `User.org_id`(주 소속) 유지 + 소속 테이블 병행 |
|---|---|---|---|
| 구조 | (user_id, org_id, role, status, joined_at) 관계 테이블. `User.org_id` 폐기 | `org_ids: ARRAY/JSONB` | 소속 테이블 신설 + `User.org_id` 는 "주 소속 미러"로 유지 |
| 장점 | 정석. 소속별 상태/역할/이력 관리 가능. 무결성(FK·unique 제약) 확보 | 마이그레이션 코드가 가장 적음 | 46곳 의존 코드를 **점진 전환** 가능. 초기 리스크 최소 |
| 단점 | 46곳 의존 지점 **일괄 수정** 필요 — 빅뱅 리스크 | FK 불가, JOIN 불가, 소속별 상태·가입일·초대상태 표현 불가, 인덱스·격리 검사 취약 | 진실의 원천이 2곳 — 동기화 규칙 없으면 불일치 위험 |
| 46곳 처리 비용 | 높음 (한 번에) | 낮아 보이나 쿼리 전면 재작성 필요 (사실상 높음) | 낮음 → 단계적으로 A 수준까지 이관 |
| 판정 | 최종 목표 | ❌ 탈락 | 이행 경로 |

### 3.2 권고: **C로 시작해 A로 수렴** (신규 테이블 + 주 소속 미러 유지)

- `user_org_memberships` 테이블을 **소속의 유일한 진실 원천(source of truth)** 으로 신설.
- `User.org_id` 는 **"주 소속(primary) 캐시"** 로 당분간 유지 — 값은 항상
  `memberships 중 is_primary=True` 행과 서비스 레이어에서 동기화(쓰기는 membership 서비스 한 곳으로 단일화).
- 기존 46곳 조회 코드는 당장 깨지지 않고, 스프린트 단위로 membership 기반 조회로 교체.
- 전환 완료 후 `User.org_id` 를 deprecated → 제거 (Phase 3).

### 3.3 신규 테이블 설계 (안)

```
user_org_memberships
├── id            UUID PK
├── user_id       UUID FK → users.id        (index)
├── org_id        UUID FK → organizations.id (index)
├── role          String(20)   # 해당 기관에서의 역할. MVP: "counselor" 고정
├── status        String(20)   # invited / active / left  (소속 상태 ≠ 계정 상태)
├── is_primary    Boolean      # 주 소속 여부. user당 active 중 1개만 True (partial unique index)
├── invited_at    DateTime     # 초대 시각 (SDD-017의 invited_at을 소속 단위로 이동)
├── invite_expires_at DateTime # 초대 만료
├── joined_at     DateTime     # 수락/배정 시각
├── left_at       DateTime     # 해제 시각 — 삭제하지 않고 status=left + left_at 기록 (데이터 보존)
├── created_at / updated_at
└── 제약: UNIQUE(user_id, org_id) WHERE status != 'left'   # 동일 기관 중복 소속 방지 (재가입 허용)
        UNIQUE(user_id) WHERE is_primary AND status='active' # 주 소속 1개 보장
```

- **불변 원칙**
  - `email` = 계정 식별자 그대로 unique 유지. 다중 소속이어도 **계정 1개**.
  - `CounselorProfile` / `counselor_code` = 계정당 1개 유지 (프로필·코드는 기관과 무관한 상담사 개인 자산).
  - 소속 해제 = 행 삭제가 아니라 `status='left' + left_at` — 세션/리포트 이력의 기관 귀속 추적 보존.
- **role을 membership에 두는 이유**: 장기적으로 "A기관 상담사 + B기관 관리자" 같은 조합 대비.
  단, **MVP에서는 counselor만 다중 소속 허용**하고 `User.role` 은 그대로 둠 (§9 범위 참조).

---

## 4. "주 소속(Primary Org)" 개념

### 4.1 왜 필요한가

- **JWT 토큰**: `deps.py` 가 토큰에 org_id 1개를 담음 — 요청의 "현재 기관 컨텍스트"가 필요.
- **기본 화면 컨텍스트**: 상담사 대시보드·세션 생성 시 기본 선택 기관.
- **org_admin 역할**: 기관 관리자 화면은 특정 기관 1개를 전제로 동작.
- **하위 호환**: 기존 46곳 코드가 "소속 기관 1개"를 가정 — 주 소속이 그 답을 대신 제공.

### 4.2 규칙 (안)

- 첫 소속 = 자동으로 주 소속.
- 상담사가 설정 화면에서 주 소속 변경 가능 (active 소속 중 선택).
- 주 소속이 해제되면: 남은 active 소속 중 **가장 오래된(joined_at 최소)** 소속을 자동 승격.
- 주 소속은 "기본값"일 뿐 — 권한 판단은 항상 **소속 목록 전체** 기준 (§6).

### 4.3 기관 컨텍스트 전환 UX (안)

- 헤더에 **기관 전환 드롭다운** (소속 2개 이상일 때만 노출) — Slack 워크스페이스 전환과 동일 패턴.
- 전환 시 대시보드/세션 목록/내담자 목록이 해당 기관 기준으로 필터링.
- 토큰 재발급 없이 처리하려면: 토큰에는 `org_ids`(소속 목록)를 담고, **활성 기관은 요청 헤더
  (`X-Org-Context`) 또는 쿼리 파라미터**로 전달 → 서버는 "요청 org ∈ 토큰 org_ids" 검증. (권고)
  - 대안: 전환 시 토큰 재발급 — 단순하나 UX 끊김. 소속 변경 시 토큰 무효화 필요성은 양쪽 동일.

---

## 5. 초대 흐름 재설계

### 5.1 현재 흐름의 문제

```
관리자 초대 → email 전체 중복 검사 → 있으면 409 종료   ← 여기서 기존 상담사가 막힘
                                  → 없으면 User(pending) + CounselorProfile 생성 + 메일
```

### 5.2 신규 흐름 (안): 이메일 존재 여부로 자동 분기

```
관리자가 이름+이메일 입력
  │
  ├─ [신규 이메일] ─ 기존과 동일: User(pending) + CounselorProfile + membership(invited) + 초대 메일
  │                  수락 시: 계정 활성화 + membership → active
  │
  └─ [기존 이메일]
       ├─ role == counselor?
       │    ├─ 이미 이 기관에 active/invited 소속 → 409 "이미 이 기관에 소속(초대)된 상담사입니다"
       │    └─ 아니면 → membership(invited) 생성 + "소속 초대" 메일 (계정·프로필 생성 없음)
       │         수락 시: membership → active (비밀번호 설정 불필요 — 기존 계정으로 로그인)
       └─ role != counselor (client/org_admin 등) → 409 "상담사 계정이 아닌 이메일입니다" (MVP 범위 밖)
```

- **핵심 원칙**
  - 기존 상담사 소속 추가는 반드시 **본인 수락**을 거침 (관리자 일방 배정 금지) —
    타 기관이 이메일만 알면 소속을 강제로 붙이는 것은 개인정보·동의 원칙 위반.
  - 초대 응답 메시지는 **계정 존재 여부를 관리자에게 과도하게 노출하지 않도록** 문구 통일 검토
    ("초대를 발송했습니다" 단일 응답 + 목록에서 상태 구분). — 이메일 존재 여부 탐지(enumeration) 완화.
  - 초대장 화면 분기: 신규 = 비밀번호 설정 + 프로필 입력 / 기존 = 로그인 후 "OO센터 소속 초대 수락/거절" 1클릭.
- **기존 경로 재사용**: `OrganizationJoinRequest`(상담사→기관 가입 신청)는 방향이 반대인 별도 흐름 —
  승인 시 `User.org_id` 설정 대신 **membership 생성**으로 수렴시켜 두 흐름의 종착점을 통일.
- **초대 관리 화면**: 기존 초대 목록(테이블)에 "유형" 열 추가 — `신규 가입 초대` / `소속 추가 초대`.
  검색·필터(상태/유형) 유지.

### 5.3 초대 상태의 이동

- 현재: `User.status='pending'` + `invited_at/invite_expires_at` (계정 단위)
- 변경: 소속 초대 상태는 `membership.status='invited'` 로 — **계정 상태와 분리**.
  - 신규 초대: 계정 pending + membership invited (수락 시 둘 다 활성화)
  - 기존 상담사 초대: 계정은 active 그대로, membership만 invited
  - 만료 처리·재발송·취소도 membership 단위로 동작.

---

## 6. 권한 검사 변경 — 단일 org_id → 소속 목록 기반

### 6.1 원칙

- **"user.org_id == X" 검사 전부** → **"X ∈ user의 active 소속 목록"** 검사로 치환.
- 헬퍼 함수로 단일화 (예): `membership_service.is_member(user_id, org_id)`,
  `get_active_org_ids(user_id)`, `require_membership(user, org_id)` — 46곳이 각자 쿼리하지 않게 함.

### 6.2 영역별 변경 (안)

| 영역 | 현재 | 변경 |
|---|---|---|
| 토큰 (`deps.py`) | `org_id` 1개 | `org_id`(주 소속, 호환 유지) + `org_ids`(active 목록). 요청별 활성 기관은 헤더로 |
| 기관 구성원 목록 (`org_management_service`) | `User.org_id == org.id` | `memberships WHERE org_id=X AND status='active'` JOIN users |
| 세션 생성/조회 | 호스트 소속 = `user.org_id` | 세션 생성 시 **활성 기관 컨텍스트**를 `Session.organization_id` 에 스냅샷(SDD-075 그대로) — 조회 권한은 "세션.organization_id ∈ 내 소속" |
| 리포트/대시보드 | `User.org_id` 기준 집계 | **기관 컨텍스트 기준** 집계 — A기관 화면에는 A기관 세션(organization_id=A)만. 상담사 개인 뷰는 전체 합산 탭 별도 |
| org_admin 접근 | `user.org_id == 대상 org` | 동일하되 membership 기준. MVP에선 org_admin 단일 소속 유지라 실질 변화 없음 |

### 6.3 기관 간 격리 (필수 보장)

- A기관 관리자는 상담사의 **B기관 활동(세션·리포트·내담자)을 볼 수 없다** —
  구성원 상세에서도 "우리 기관 귀속 데이터"만 노출.
- `Session.organization_id` 스냅샷이 격리의 기준축 — 소속을 나중에 해제해도 과거 세션의 기관 귀속 불변.
- 내담자(`ClientCounselorLink`)는 상담사 개인에 연결 — 기관 화면에서는 "해당 기관 세션을 가진 내담자"만 표시.
- 감사 로그: 소속 추가/해제/주 소속 변경은 모두 감사 대상 (data-privacy 규칙 준수).

---

## 7. 소속 전환 · 해제 · 마지막 소속

### 7.1 소속 해제 (상담사 자진 탈퇴 or 관리자 해제)

- `membership.status='left' + left_at` 기록 — **행 삭제·데이터 삭제 없음**.
- 과거 세션·리포트·EEG 기록은 `Session.organization_id` 스냅샷으로 계속 해당 기관에 귀속 (조회 가능).
- 해제된 기관의 **신규** 세션 생성·대시보드 접근은 즉시 차단 (토큰의 org_ids 갱신 — refresh 시 반영,
  민감 조작은 서버 측 membership 실시간 검사로 이중 방어).
- 해제 대상이 주 소속이면 §4.2 규칙대로 자동 승격.

### 7.2 마지막 소속 해제 (소속 0개)

- 계정은 유지 (무소속 상담사 허용 — 현재도 `org_id=None` 상담사 존재 가능).
- 동작: 로그인·프로필·과거 리포트 열람 가능 / 신규 세션 생성은 기관 필요 기능이면 제한 or 무소속 세션 정책 따름(현행 유지).
- 화면: "소속된 기관이 없습니다" 안내 + 기관 가입 신청(`OrganizationJoinRequest`) 유도.

### 7.3 재가입

- 같은 기관에 다시 초대/가입 → **새 membership 행** 생성 (left 행은 이력으로 보존).
  UNIQUE(user_id, org_id) 제약은 `WHERE status != 'left'` partial 이므로 허용됨.

---

## 8. 단계별 이관 (마이그레이션 · 호환성)

### Phase 1 — 기반 구축 + 핵심 문제 해결 (초대 409 해소)

1. `user_org_memberships` 테이블 신설 (Alembic — 수동 리뷰).
2. **백필**: `User.org_id IS NOT NULL` 인 counselor/org_admin 전원 →
   membership(status=active, is_primary=True, joined_at=created_at 근사) 생성.
   pending 초대 계정은 status=invited 로 이관.
3. 쓰기 경로 단일화: 초대/가입승인/해제 로직이 membership을 쓰고 `User.org_id`(주 소속)를 동기 갱신.
4. `invite_counselor` 분기 구현 (§5.2) — **이 시점에 409 문제 해결**.
5. 기관 구성원 목록·초대 목록을 membership 기반으로 전환.

### Phase 2 — 조회 경로 전환 + 다중 소속 UX

6. 토큰에 `org_ids` 추가 + `X-Org-Context` 헤더 검증 도입 (기존 `org_id` 필드는 유지 — 구버전 호환).
7. 세션/리포트/대시보드/admin 조회 46곳을 헬퍼(`require_membership` 등) 기반으로 순차 교체
   — 파일 단위 PR로 쪼개 리뷰 (session → report → dashboard → admin 순).
8. 기관 전환 드롭다운 + 주 소속 설정 화면 + 소속 초대 수락 화면.
9. 격리 회귀 테스트: A기관 관리자 ↛ B기관 데이터 (pytest + Playwright 시나리오).

### Phase 3 — 정리 (구조 수렴)

10. `User.org_id` 읽기 참조 0건 확인 → 컬럼 deprecated 주석 → 제거 마이그레이션.
11. `User.invited_at/invite_expires_at` 등 소속 초대 관련 필드 정리.
12. (선택) membership.role 활성화 — 기관별 역할 분리가 필요해질 때.

### 호환성 원칙

- 각 Phase 는 독립 배포 가능 — Phase 1 만으로도 당면 문제(초대 409) 해결.
- 이관 중 진실의 원천은 항상 membership, `User.org_id` 는 읽기 호환용 미러.
- 롤백: Phase 1~2 는 membership 테이블만 추가하므로 코드 롤백 시 기존 동작 유지 (org_id 미러가 살아있음).

---

## 9. 우선순위 · 범위 결정

| 우선순위 | 항목 | 비고 |
|---|---|---|
| **P0** | Phase 1 (테이블+백필+초대 분기) | 당면 409 문제 해결. 최소 범위 |
| **P1** | Phase 2 (권한 46곳 전환 + 전환 UX + 격리 테스트) | 다중 소속의 실질 완성 |
| **P2** | Phase 3 (org_id 제거, 구조 수렴) | 기술 부채 정리 |
| 범위 외 (MVP) | org_admin 다중 소속 / 기관별 역할 상이(role per org) / 내담자 다중 기관 | membership.role 필드로 문 열어둠 |

### 열린 결정 사항 (Brian 확인 필요)

1. 활성 기관 전달 방식: **헤더(`X-Org-Context`) 방식 권고** vs 전환 시 토큰 재발급 — 권고안 승인 여부
2. 기존 상담사 초대 시 관리자 응답 문구 — 계정 존재 노출 최소화(단일 문구) vs 명시 안내(UX 친절) 중 선택
3. 무소속 상담사의 신규 세션 생성 허용 범위 — 현행 유지로 가정함

---

## 부록 — 참고 코드 위치

- `backend/app/models/user.py:44` — `User.org_id` 단일 FK
- `backend/app/services/org_service.py:473~` — `invite_counselor` (509~513: 전체 email 중복 409)
- `backend/app/api/deps.py:41` — JWT 토큰 org_id
- `backend/app/models/counselor_profile.py` — user_id unique + counselor_code
- `backend/app/models/session.py:33` — `Session.organization_id` 스냅샷 (SDD-075)
- `backend/app/models/org_join_request.py` — 기존 가입 신청 흐름 (승인 종착점을 membership으로 통일)
