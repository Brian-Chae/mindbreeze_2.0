# [SDD-193] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 승인받고 구현 시작할 것.

**Goal:** 루시의 반응형 감정 대화를 모든 내담자에게 기본 ON 하고 친근한 친구 톤으로 바꾼다.

**Architecture:**
```
내담자 메시지 → _route_reply
  ① agent_risk.handle_client_message (위험 감지 — 유지)
  ② agent_checkin.ensure_checkin_for_conversation
     → active_counselor_ids(담당 상담사) 로 게이트 변경
     → 담당 있으면 checkin 열고 감정 대화(프로파일 축적)
     → 담당 없으면 None → ③ 으로
  ③ _build_reply
     → 리포트/일정 없으면 NO_CONTEXT_REPLY 대신 감정 대화(_companion_reply)
     → 리포트/일정 있으면 기존 리포트 대화 유지
```

**Tech Stack:** FastAPI + SQLAlchemy (백엔드만 변경, 프론트 무변경)

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/services/agent_checkin.py` | `active_counselor_ids` 추가, `ensure_checkin_for_conversation` 게이트 변경, `REPLY_FALLBACKS`·`respond` task 친근한 톤 |
| Modify | `backend/app/services/agent_service.py` | `_build_reply`에 담당 상담사 없는 내담자용 감정 대화 경로(`_companion_reply`) 추가 |
| Modify | `backend/app/services/agent_llm.py` | `SYSTEM_RULES`에 친근한 친구 톤 반영 |

## Tasks

### Task 1: 담당 상담사 조회 헬퍼 추가
**Objective:** `agent_checkin.active_counselor_ids(db, client_id)` — 활성 담당 상담사(안부 스위치 무관) 목록 반환
**Files:** `backend/app/services/agent_checkin.py`
**Estimate:** 5min

### Task 2: 반응형 감정 대화 기본 ON
**Objective:** `ensure_checkin_for_conversation` 의 게이트를 `enabled_counselor_ids` → `active_counselor_ids` 로 변경. 아웃리치(`start_outreach`)는 `enabled_counselor_ids` 유지.
**Files:** `backend/app/services/agent_checkin.py`
**Estimate:** 5min

### Task 3: 담당 상담사 없는 내담자 감정 대화
**Objective:** `_build_reply` 에서 리포트/일정이 없을 때 `NO_CONTEXT_REPLY` 대신 친근한 감정 대화 응답(`_companion_reply`) 반환
**Files:** `backend/app/services/agent_service.py`
**Estimate:** 10min

### Task 4: 친근한 친구 톤
**Objective:** `SYSTEM_RULES`·`REPLY_FALLBACKS`·`respond` task 에 친근한 친구 톤 반영(진단·조언 금지는 유지)
**Files:** `backend/app/services/agent_llm.py`, `backend/app/services/agent_checkin.py`
**Estimate:** 5min

## Testing Strategy
- `./venv/bin/python -m pytest tests/test_agent_checkin_conversation.py tests/test_agent_api.py tests/test_agent_report_chat.py tests/test_agent_policy.py` — 관련 테스트
- 전체 `pytest` 로 회귀 확인
