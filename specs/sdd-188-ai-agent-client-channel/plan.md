# [SDD-188] — Implementation Plan

> **For Hermes:** 7-Stage SDD. verify.md 작성 완료 후 구현. 백엔드/프론트는 아래 **API 계약(§Contract)** 을 단일 소스로 병렬 구현한다.

**Goal:** 내담자:AI 채널(예약 노티 + CTA + 리포트 대화 + 사후 피드백)과 상담사 대상 중계 이벤트 적재.

**Architecture:**
```text
cron(1분) ─▶ sweep_agent_reminders ─▶ agent_service.post_agent_message ─┐
approve_report ─▶ agent_report_chat.on_report_approved ────────────────┤
사용자 메시지/CTA ─▶ /api/v1/agent/* ─▶ agent_service ─▶ agent_policy(컨텍스트) ─▶ agent_llm(폴백 템플릿)
                                                                       │
agent_messages ◀──────────────────────────────────────────────────────┘
   └▶ notification_outbox(ws, push) , agent_relay_events(→ SDD-189)
```

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, OS cron(`*_cron.py`), Gemini 2.5-flash(폴백 템플릿), React + TanStack Query, Tailwind.

## 설계 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 스케줄 | 매 1분 OS cron `sweep_agent_reminders_cron.py` → `app/tasks/agent_task.py::sweep_agent_reminders` | Celery beat 제거됨(INFRA-08), 기존 `sweep_session_reminders_cron.py` 패턴 |
| 윈도우 | 각 offset(180, 60)에 대해 `scheduled_at - now ∈ (offset-2분, offset+0분]` 이면 발송, 로그 UNIQUE로 멱등. 서버 중단 복구를 위해 `offset` 이후 `scheduled_at` 전까지는 **한 번만 보정 발송**(단, 1시간 전 알림은 세션 시작 10분 전까지만) | 누락 보정 |
| 변경/취소 | 발송 직전 세션 상태·`scheduled_at` 재조회. 이미 발송한 뒤 `scheduled_at` 이 바뀌면 `kind=schedule_changed` 정정 메시지 1회 | 틀린 시각 안내 방지 |
| 동의 | `Consent(type="ai_agent", version="1.0")` 1회. 미동의 시 `/agent/*` 쓰기 API 403, 에이전트가 먼저 거는 메시지는 **동의 전에도 생성**하되 내용은 예약 안내(사실)로 한정 → 동의 화면은 대화창 첫 진입 때 | D1: 가입 후 첫 대화 시 한 번 |
| 리포트 훅 | `report_service.approve_report` 및 자동 승인 경로(`report_service.py:327`, `:363` 부근) 양쪽에서 `agent_report_chat.on_report_approved(report, db)` 호출. `report.user_id` 없는 게스트·그룹 세션·`type!=client` 리포트는 스킵. 실패는 승인 트랜잭션을 깨지 않도록 try/except + 로그 | 승인 흐름 보호 |
| LLM | `agent_llm.generate(prompt, fallback)` — `report_comment_service._call_gemini` 재사용(키 없으면 fallback). 출력 필터(`agent_guard.sanitize`): 진단·처방 표현, 숫자 점수 표현 제거/대체 | 점수 금지·진단 금지 |
| 푸시 | `notification_outbox.channel` 에 `"push"` 값 추가(컬럼 String(10) 내). consumer 없음 → `pending` 유지(SDD-190에서 처리). 기존 outbox cron들이 `push`를 건드리지 않는지 확인(T7) | |
| 장소 | `sessions.location_address`. 스키마 `SessionCreate/Update/Response`에 추가. 오프라인 + 미지정 → 서버가 기관 주소→상담사 주소 순으로 기본값 채움 | D8 |
| 전화 CTA | `users.phone`(상담사) 존재 시에만 CTA 포함 | D11 |

## Contract (백엔드 ↔ 프론트 단일 소스)

모든 응답은 기존 API 응답 관례를 따른다. 경로 prefix `/api/v1/agent`, 인증 필요, role=client 전용 (다른 role은 403).

**공통 타입**
```ts
type AgentCtaAction =
  | 'ack' | 'open_map' | 'join_session' | 'request_change' | 'open_chat'
  | 'call_counselor' | 'open_report' | 'feedback_choice';

interface AgentCta {
  id: string;                 // 메시지 내 고유 id
  action: AgentCtaAction;
  label: string;              // 한국어 버튼 문구
  payload?: {
    url?: string;             // open_map: 지도 검색 URL, open_report: 리포트 뷰 경로
    session_id?: string;      // join_session / request_change
    room_id?: string;         // open_chat
    tel?: string;             // call_counselor
    choice?: 'helpful' | 'neutral' | 'disappointed'; // feedback_choice
  };
  done?: boolean;             // 이미 수행됨(ack, 피드백 선택 등) → 비활성
}

interface AgentMessage {
  id: string;
  sender: 'agent' | 'user' | 'system';
  kind: 'reminder_3h' | 'reminder_1h' | 'schedule_changed'
      | 'report_ready' | 'report_chat' | 'feedback_thanks' | 'free';
  content: string;
  cta: AgentCta[];
  ref_type: 'session' | 'report' | null;
  ref_id: string | null;
  read_at: string | null;
  created_at: string;         // ISO8601
}
```

**엔드포인트**
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/agent/consent` | — | `{ agreed: boolean, version: string }` |
| POST | `/agent/consent` | `{ agreed: true }` | `{ agreed: true, version: string }` |
| GET | `/agent/messages?before=<iso>&limit=30` | — | `{ items: AgentMessage[], has_more: boolean }` (오래된→최신 정렬 아님: **최신순**) |
| POST | `/agent/messages` | `{ content: string }` (1~1000자) | `{ user_message: AgentMessage, agent_message: AgentMessage }` — 동의 없으면 403 `agent_consent_required` |
| POST | `/agent/messages/read` | `{ up_to?: iso }` | `{ unread: number }` |
| GET | `/agent/unread-count` | — | `{ unread: number }` |
| POST | `/agent/messages/{message_id}/cta/{cta_id}` | `{ reason?: string, text?: string }` | `{ cta: AgentCta, agent_message?: AgentMessage }` |

CTA 처리 규칙
- `ack`: `agent_relay_events(kind=ack)` 기록, cta.done=true
- `request_change`: `reason` 필수(1~500자) → relay event `schedule_change_request` + 상담사 알림, 응답 agent_message로 접수 확인
- `feedback_choice`: choice 저장 → 후속 agent_message("조금 더 이야기해 주실래요?" 열린 질문), 이후 사용자 자유 메시지는 relay event `feedback`(원문 그대로)에 누적
- `open_map/join_session/open_chat/call_counselor/open_report`: 클라이언트 이동용 → 서버는 `done` 처리 없이 200 (기록용)

**세션 스키마 변경 (`/api/v1/sessions`)**
- Create/Update 요청: `location_address?: string (<=300)`
- Response: `location_address: string | null`
- 오프라인 + 요청에 없음 → 서버가 기본값 채움 후 반환

**푸시 Outbox payload (본문 비식별)**
```json
{ "title": "AI 비서", "body": "AI 비서가 메시지를 보냈어요", "deeplink": "/app/ai", "message_id": "<uuid>" }
```

## Files to Change

| Action | File | Description |
|---|---|---|
| Create | `backend/app/models/agent.py` | AgentConversation, AgentMessage, AgentRelayEvent, AgentDeliveryLog |
| Modify | `backend/app/models/__init__.py` | 모델 등록 |
| Modify | `backend/app/models/session.py` | `location_address` 컬럼 |
| Create | `backend/alembic/versions/<rev>_188_ai_agent_client_channel.py` | 테이블 4종 + sessions 컬럼 (down_revision = `e036a0000035`, 작성 직전 `alembic heads`로 재확인) |
| Create | `backend/app/schemas/agent.py` | Pydantic 요청/응답 (Contract) |
| Modify | `backend/app/schemas/session.py` | `location_address` 추가 |
| Modify | `backend/app/services/session_service.py` | 생성/수정 시 장소 기본값·저장 |
| Create | `backend/app/services/agent_policy.py` | 내담자 채널 컨텍스트 조회(권한 경계 단일 진입점) |
| Create | `backend/app/services/agent_guard.py` | 출력 필터(진단·점수·금지 표현) |
| Create | `backend/app/services/agent_llm.py` | Gemini 호출 + 템플릿 폴백 |
| Create | `backend/app/services/agent_service.py` | 대화/메시지/동의/CTA/relay 생성, 푸시·인앱 알림 적재 |
| Create | `backend/app/services/agent_reminder.py` | 예약 노티 대상 선정·메시지 구성·정정 |
| Create | `backend/app/services/agent_report_chat.py` | 리포트 승인 → 링크 메시지·피드백 처리 |
| Modify | `backend/app/services/report_service.py` | 승인·자동승인 경로에 훅 |
| Modify | `backend/app/services/notification_service.py` | `EVENT_CATALOG` 에 `schedule_change_request` 추가 |
| Create | `backend/app/tasks/agent_task.py` | `sweep_agent_reminders` |
| Create | `backend/sweep_agent_reminders_cron.py` | cron 진입점 |
| Modify | `backend/app/core/celery_app.py` | (필요 시) include. cron 직접 호출 방식이면 불필요 — 확인 후 결정 |
| Create | `backend/app/api/v1/agent.py` | 라우터 |
| Modify | `backend/app/main.py` (또는 라우터 등록부) | 라우터 등록 |
| Modify | `.github/workflows/deploy-dev.yml` | 1분 cron 등록 + 파일 복사 목록에 추가 |
| Create | `backend/tests/test_agent_*.py` | 정책·스케줄러·훅·API 테스트 |
| Create | `frontend/src/lib/api/agent.ts` | API 클라이언트 + 타입 (Contract) |
| Create | `frontend/src/pages/client/ai-agent-page.tsx` (경로는 기존 client 페이지 구조에 맞춤) | AI 대화 화면 |
| Create | `frontend/src/components/client/agent/*` | MessageBubble, CtaCard, ConsentSheet, ChangeRequestSheet |
| Modify | `frontend/src/pages/ClientAppPage.tsx` 또는 client 라우팅/하단 네비 | AI 탭/진입점 + 미읽음 배지 |
| Modify | `frontend/src/pages/sessions/session-create*.tsx`, 수정 화면 | 장소 입력란 |
| Modify | `frontend/src/lib/api/*` 세션 타입 | `location_address` |
| Create | `frontend/tests/agent-*.test.ts(x)` | CTA 매핑·동의 흐름 등 vitest |

## Tasks

### Task 1: 모델·마이그레이션
**Objective:** 4개 테이블 + `sessions.location_address`. 단일 head.
**Files:** `models/agent.py`, `models/session.py`, `alembic/versions/*`
**Estimate:** 10min
**Check:** `alembic heads` 1개, `upgrade --sql` 렌더 확인, 인덱스: messages(conversation_id, created_at), delivery_logs UNIQUE.

### Task 2: 정책 계층·가드·LLM 래퍼
**Objective:** `agent_policy.client_context(user_id)`가 허용 데이터만 반환. `agent_guard.sanitize`. `agent_llm.generate`.
**Files:** `agent_policy.py`, `agent_guard.py`, `agent_llm.py`
**Estimate:** 10min

### Task 3: 에이전트 서비스 + API
**Objective:** 동의·메시지·읽음·CTA·relay 생성 + 라우터. 푸시/인앱 알림 적재.
**Files:** `agent_service.py`, `schemas/agent.py`, `api/v1/agent.py`, `main.py`, `notification_service.py`
**Estimate:** 15min

### Task 4: 예약 노티 스케줄러
**Objective:** 180/60분 전 메시지 생성, 취소/변경 처리, 로그 멱등, cron 진입점.
**Files:** `agent_reminder.py`, `tasks/agent_task.py`, `sweep_agent_reminders_cron.py`, `deploy-dev.yml`
**Estimate:** 15min

### Task 5: 리포트 대화 훅
**Objective:** 승인·자동승인 시 링크 메시지 생성, 피드백 CTA 처리, 그룹/게스트/상담사용 제외.
**Files:** `agent_report_chat.py`, `report_service.py`
**Estimate:** 10min

### Task 6: 세션 장소(D8)
**Objective:** 스키마·서비스에 `location_address`, 오프라인 기본값 채움.
**Files:** `schemas/session.py`, `session_service.py`
**Estimate:** 8min

### Task 7: 백엔드 테스트 + 중복·Outbox 점검
**Objective:** verify.md 시나리오 pytest 구현. 기존 outbox cron이 `push` 행을 건드리지 않는지, 기존 리마인더와 시각 겹침 시 체감 점검.
**Files:** `tests/test_agent_*.py`
**Estimate:** 15min

### Task 8: 프론트 API 클라이언트 + AI 대화 화면
**Objective:** Contract 기반 타입/클라이언트, 메신저 UI, CTA 카드, 동의 시트, 변경 문의 시트, 미읽음 배지.
**Files:** `lib/api/agent.ts`, `pages/client/ai-agent-page.tsx`, `components/client/agent/*`, 라우팅/네비
**Estimate:** 20min

### Task 9: 프론트 세션 장소 입력 + vitest
**Objective:** 세션 생성/수정 화면 장소 입력(오프라인 기본값 표시·수정), 타입 갱신, vitest.
**Files:** 세션 생성/수정 화면, 타입, `tests/*`
**Estimate:** 10min

### Task 10: 통합 검증
**Objective:** 백엔드 pytest 전체, `alembic heads`, 프론트 `npm run build`/`vitest run`, 계약 교차 대조(백엔드 응답 ↔ 프론트 타입), dev 배포 후 스모크.
**Estimate:** 15min

## 병렬화 규칙
- Task 1~7(백엔드)과 Task 8~9(프론트)는 **Contract를 공유**하므로 디렉토리 분리 병렬 가능. 단 Task 5가 `report_service.py`, Task 6이 `session_service.py`를 건드리므로 **백엔드 안에서는 순차**.
- 완료 후 Supervisor가 pytest/build를 직접 재실행(자식 self-report 불신), Contract 필드명 교차 대조.

## Testing Strategy
- `cd backend && venv/bin/python -m pytest tests -q` 전체 + 신규 `test_agent_*.py`
- `cd backend && venv/bin/python -m alembic heads` 단일 head
- `cd frontend && npm run build && npx vitest run`
- 정책 경계 테스트(상담사 리포트·메모 미포함), 멱등 테스트(같은 offset 2회 실행), 시간 윈도우 테스트(freeze time)
- dev 배포 후: 테스트 계정(client@test.com)으로 대화 화면 진입→동의→예약 노티 시뮬레이션(스윕 수동 실행)→CTA 동작 확인
