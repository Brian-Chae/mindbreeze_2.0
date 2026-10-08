# [SDD-189] — Implementation Plan

**Goal:** 상담사:AI 채널(아침/저녁 브리핑·relay event 열람·설정).
**Architecture:** cron(1분) → `sweep_agent_briefings` → `agent_briefing.build_*`(DB 사실 + LLM 보조 + guard) → `agent_service.post_agent_message(channel=counselor)` → Outbox(ws/push). 상담사 대화/설정/relay 열람은 `/api/v1/agent/counselor/*`.
**Tech Stack:** FastAPI, SQLAlchemy, Alembic, OS cron, React.

## Contract (BE ↔ FE 단일 소스)
경로 prefix `/api/v1/agent/counselor`, role=counselor 전용. 메시지 타입은 SDD-188 `AgentMessage`를 확장: `kind`에 `briefing_morning | briefing_evening | free` 추가, CTA `action`에 `open_schedule | open_client | open_record | open_report | open_change_requests` 추가, `payload`에 `client_id?: string; record_id?: string; report_id?: string`.
```ts
interface BriefingSettings {
  morning_enabled: boolean; morning_time: string;   // "HH:MM" (KST)
  evening_enabled: boolean; evening_time: string;
  skip_no_session_days: boolean;
}
interface RelayEvent {
  id: string;
  kind: 'feedback' | 'schedule_change_request' | 'ack';
  client_id: string; client_name: string;
  session_id: string | null; session_title: string | null; scheduled_at: string | null;
  payload: { choice?: 'helpful'|'neutral'|'disappointed'; texts?: string[]; reason?: string };
  handled_at: string | null; created_at: string;
}
```
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/settings` | — | `BriefingSettings` (없으면 기본 08:00/21:00, 둘 다 켜짐, skip true) |
| PUT | `/settings` | `BriefingSettings` (HH:MM 검증) | `BriefingSettings` |
| GET | `/messages?before=&limit=30` | — | `{items: AgentMessage[], has_more}` 최신순 |
| POST | `/messages` | `{content}` | `{user_message, agent_message}` |
| POST | `/messages/read` | `{up_to?}` | `{unread}` |
| GET | `/unread-count` | — | `{unread}` |
| GET | `/relay-events?status=open\|all&limit=50` | — | `{items: RelayEvent[]}` 본인(target_user)만 |
| POST | `/relay-events/{id}/handled` | — | `RelayEvent` |
| POST | `/messages/{message_id}/cta/{cta_id}` | `{}` | `{cta}` (기록용) |

푸시 Outbox payload: `{"title":"AI 비서","body":"AI 비서가 브리핑을 보냈어요","deeplink":"/agent","message_id":"<uuid>"}`

## Files to Change
| Action | File | Description |
|---|---|---|
| Create | `backend/alembic/versions/e036a0000037_sdd_189_counselor_briefing.py` | down=e036a0000036 |
| Modify | `backend/app/models/agent.py` | CounselorSettings, BriefingLog, relay `handled_at` |
| Modify | `backend/app/services/agent_policy.py` | `counselor_context` |
| Create | `backend/app/services/agent_briefing.py` | 아침/저녁 빌더 |
| Modify | `backend/app/services/agent_service.py` | counselor 대화·relay 조회·settings |
| Modify | `backend/app/schemas/agent.py` | Contract 확장 |
| Create | `backend/app/api/v1/agent_counselor.py` + 라우터 등록 | API |
| Modify | `backend/app/tasks/agent_task.py`, Create `backend/sweep_agent_briefings_cron.py` | 스케줄러 |
| Modify | `.github/workflows/deploy-dev.yml` | cron |
| Create | `backend/tests/test_agent_counselor_*.py` | 테스트 |
| Create | `frontend/src/lib/api/agent-counselor.ts` | 타입·클라이언트 |
| Create | `frontend/src/pages/agent/counselor-agent-page.tsx` 등(인접 관례 따름) | 대화·설정·relay 목록 |
| Modify | 상담사 라우팅/네비(SidebarNav, App.tsx) | 진입점·배지 |
| Create | `frontend/tests/agent-counselor-*.test.ts(x)` | vitest |

## Tasks
1. 마이그레이션·모델 (10m) 2. counselor_context + 정책 테스트 (10m) 3. 브리핑 빌더 (15m) 4. 스케줄러·cron (10m) 5. API·서비스 (15m) 6. 백엔드 테스트 (15m) 7. FE 클라이언트·대화·설정·relay 목록 (25m) 8. FE vitest·통합 검증 (10m)
BE와 FE는 Contract 공유로 디렉토리 분리 병렬.

## Testing Strategy
pytest 전체, `alembic heads`, `npm run build`, `tsc`, `vitest run`, Contract 교차 대조.
