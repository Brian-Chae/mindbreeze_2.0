"""SDD-188: AI 에이전트 채널 API — 내담자(role=client) 전용.

모든 엔드포인트가 인증을 요구하고 role=client 로 제한된다(상담사 채널은 SDD-189).
대화·메시지는 토큰 주체(current_user)의 대화방만 대상이며, 타인 메시지 id 를 넣으면
404 다(IDOR 방지). 쓰기 경로(메시지 전송·CTA 실행)는 동의(D1)를 추가로 요구한다.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DBSession

from app.api.deps import require_roles
from app.core.database import get_db
from app.schemas.agent import (
    AgentConsentRequest,
    AgentConsentResponse,
    AgentCtaExecuteRequest,
    AgentCtaExecuteResponse,
    AgentMessageListResponse,
    AgentReadRequest,
    AgentSendMessageRequest,
    AgentSendMessageResponse,
    AgentUnreadResponse,
    CheckinPrefs,
    CheckinPrefsUpdateRequest,
)
from app.services import agent_service

router = APIRouter(prefix="/agent", tags=["agent"])

# 내담자 전용 채널 — 상담사·기관관리자·플랫폼관리자 토큰은 403.
_client_only = require_roles("client")


@router.get("/consent", response_model=AgentConsentResponse)
def get_consent(
    current_user: dict = Depends(_client_only),
    db: DBSession = Depends(get_db),
):
    """AI 비서 이용 동의 상태 — 대화창 첫 진입 시 동의 화면 표시 여부를 가른다."""
    return agent_service.consent_status(db, current_user["id"])


@router.post("/consent", response_model=AgentConsentResponse)
def post_consent(
    payload: AgentConsentRequest,
    current_user: dict = Depends(_client_only),
    db: DBSession = Depends(get_db),
):
    """동의 기록 — 사용자당 1회. 이후 재동의를 요구하지 않는다(D1)."""
    if not payload.agreed:
        return agent_service.consent_status(db, current_user["id"])
    return agent_service.grant_consent(db, current_user["id"])


@router.get("/messages", response_model=AgentMessageListResponse)
def list_messages(
    before: datetime | None = Query(None, description="이 시각보다 이전 메시지(과거 더 보기)"),
    limit: int = Query(30, ge=1, le=100),
    current_user: dict = Depends(_client_only),
    db: DBSession = Depends(get_db),
):
    """내 AI 대화 메시지 목록 (최신순). 동의 전에도 조회는 허용한다."""
    return agent_service.list_messages(db, current_user["id"], before=before, limit=limit)


@router.post("/messages", response_model=AgentSendMessageResponse)
def send_message(
    payload: AgentSendMessageRequest,
    current_user: dict = Depends(_client_only),
    db: DBSession = Depends(get_db),
):
    """사용자 메시지 전송 + 에이전트 응답. 미동의 시 403 `agent_consent_required`."""
    return agent_service.send_user_message(db, current_user["id"], payload.content)


@router.post("/messages/stream")
def stream_message(
    payload: AgentSendMessageRequest,
    current_user: dict = Depends(_client_only),
    db: DBSession = Depends(get_db),
):
    """사용자 메시지 전송 + 에이전트 응답 스트리밍(SSE, SDD-201).

    응답 텍스트를 토큰 단위로 `data: {"token": "..."}` 로 흘린 뒤 `[DONE]` 으로 끝낸다.
    완료 시점에 에이전트 메시지가 저장되므로, 클라이언트는 스트리밍 종료 후 목록을
    다시 받아 확정 메시지를 표시한다.
    """
    import json

    def generate():
        for token in agent_service.stream_user_message(db, current_user["id"], payload.content):
            yield f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/messages/read", response_model=AgentUnreadResponse)
def mark_read(
    payload: AgentReadRequest,
    current_user: dict = Depends(_client_only),
    db: DBSession = Depends(get_db),
):
    """읽음 처리 — up_to 미지정이면 전체. 남은 미읽음 수를 반환한다."""
    return {"unread": agent_service.mark_read(db, current_user["id"], payload.up_to)}


@router.get("/unread-count", response_model=AgentUnreadResponse)
def get_unread_count(
    current_user: dict = Depends(_client_only),
    db: DBSession = Depends(get_db),
):
    """하단 네비 AI 탭 미읽음 배지용 카운트."""
    return {"unread": agent_service.unread_count(db, current_user["id"])}


@router.post("/messages/{message_id}/cta/{cta_id}", response_model=AgentCtaExecuteResponse)
def execute_cta(
    message_id: str,
    cta_id: str,
    payload: AgentCtaExecuteRequest | None = None,
    current_user: dict = Depends(_client_only),
    db: DBSession = Depends(get_db),
):
    """CTA 실행 — ack / request_change / feedback_choice 는 서버 상태를 바꾸고,

    이동형(open_map·join_session·open_chat·call_counselor·open_report)은 200 만 돌려준다.
    """
    body = payload or AgentCtaExecuteRequest()
    return agent_service.execute_cta(
        db,
        current_user["id"],
        message_id,
        cta_id,
        reason=body.reason,
        text=body.text,
    )


# ---------------------------------------------------------------------------
# SDD-191: 안부 대화 일시 중지 설정
# ---------------------------------------------------------------------------
#
# 내담자 채널에는 위험 감지·프로파일과 관련된 엔드포인트가 **없다**(D4). 여기서 다루는
# 것은 "상담사가 켠 안부를 잠시 받지 않기" 뿐이다.


@router.get("/checkin-prefs", response_model=CheckinPrefs)
def get_checkin_prefs(
    current_user: dict = Depends(_client_only),
    db: DBSession = Depends(get_db),
):
    """안부 설정 조회 — available 이 false 면 화면에 토글을 노출하지 않는다."""
    from app.services import agent_checkin

    return agent_checkin.prefs_payload(db, agent_service._to_uuid(current_user["id"]))


@router.put("/checkin-prefs", response_model=CheckinPrefs)
def update_checkin_prefs(
    payload: CheckinPrefsUpdateRequest,
    current_user: dict = Depends(_client_only),
    db: DBSession = Depends(get_db),
):
    """안부 일시 중지 설정 — 아웃리치만 멈추고 대화는 계속 가능하다."""
    from app.services import agent_checkin

    uid = agent_service._to_uuid(current_user["id"])
    agent_checkin.set_paused(db, uid, payload.paused)
    return agent_checkin.prefs_payload(db, uid)
