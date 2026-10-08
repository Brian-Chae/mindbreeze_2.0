"""SDD-188: AI 에이전트 채널 API — 내담자(role=client) 전용.

모든 엔드포인트가 인증을 요구하고 role=client 로 제한된다(상담사 채널은 SDD-189).
대화·메시지는 토큰 주체(current_user)의 대화방만 대상이며, 타인 메시지 id 를 넣으면
404 다(IDOR 방지). 쓰기 경로(메시지 전송·CTA 실행)는 동의(D1)를 추가로 요구한다.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
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
