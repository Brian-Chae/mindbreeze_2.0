"""SDD-189: AI 에이전트 상담사 채널 API — 상담사(role=counselor) 전용.

모든 엔드포인트가 인증 + role=counselor 로 제한된다(내담자 토큰은 403). 조회 대상은
토큰 주체의 `channel="counselor"` 대화방과 본인(host/target_user) 데이터뿐이며,
타인 메시지·타 상담사 중계 이벤트 id 를 넣으면 404 다(IDOR 방지).

이 채널은 **조회·열람·설정만** 한다 — 일정 변경·메시지 발송 같은 실행은 없다.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DBSession

from app.api.deps import require_roles
from app.core.database import get_db
from app.schemas.agent import (
    AgentMessageListResponse,
    CheckinClient,
    CheckinClientListResponse,
    CheckinEnableRequest,
    CheckinSummaryListResponse,
    ProfileItem,
    ProfileItemListResponse,
    ProfileItemUpdateRequest,
    RiskSignal,
    RiskSignalListResponse,
    RiskSignalStatusFilter,
    AgentReadRequest,
    AgentSendMessageRequest,
    AgentSendMessageResponse,
    AgentUnreadResponse,
    BriefingSettings,
    CounselorCtaExecuteResponse,
    RelayEventListResponse,
    RelayEventResponse,
    RelayEventStatusFilter,
)
from app.services import agent_counselor_service, agent_service

router = APIRouter(prefix="/agent/counselor", tags=["agent-counselor"])

# 상담사 전용 채널 — 내담자·기관관리자·플랫폼관리자 토큰은 403.
_counselor_only = require_roles("counselor")

CHANNEL = agent_service.CHANNEL_COUNSELOR


@router.get("/settings", response_model=BriefingSettings)
def get_settings(
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """브리핑 설정 조회 — 행이 없으면 기본값(08:00/21:00, 둘 다 켜짐)으로 생성해 돌려준다."""
    settings = agent_counselor_service.get_settings(db, current_user["id"])
    return agent_counselor_service.serialize_settings(settings)


@router.put("/settings", response_model=BriefingSettings)
def update_settings(
    payload: BriefingSettings,
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """브리핑 설정 수정 — 시각은 "HH:MM"(KST). 형식 위반은 422."""
    return agent_counselor_service.update_settings(
        db, current_user["id"], payload.model_dump()
    )


@router.get("/messages", response_model=AgentMessageListResponse)
def list_messages(
    before: datetime | None = Query(None, description="이 시각보다 이전 메시지(과거 더 보기)"),
    limit: int = Query(30, ge=1, le=100),
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """상담사 AI 대화 메시지 목록 (최신순). 내담자 채널 메시지는 섞이지 않는다."""
    return agent_service.list_messages(
        db, current_user["id"], before=before, limit=limit, channel=CHANNEL
    )


@router.post("/messages", response_model=AgentSendMessageResponse)
def send_message(
    payload: AgentSendMessageRequest,
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """상담사 메시지 전송 + 에이전트 응답(조회·안내만. 데이터 변경·발송 없음)."""
    return agent_counselor_service.send_user_message(
        db, current_user["id"], payload.content
    )


@router.post("/messages/read", response_model=AgentUnreadResponse)
def mark_read(
    payload: AgentReadRequest,
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """읽음 처리 — up_to 미지정이면 전체. 남은 미읽음 수를 반환한다."""
    return {
        "unread": agent_service.mark_read(
            db, current_user["id"], payload.up_to, channel=CHANNEL
        )
    }


@router.get("/unread-count", response_model=AgentUnreadResponse)
def get_unread_count(
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """상담사 네비 AI 비서 미읽음 배지용 카운트."""
    return {"unread": agent_service.unread_count(db, current_user["id"], channel=CHANNEL)}


@router.get("/relay-events", response_model=RelayEventListResponse)
def list_relay_events(
    status: RelayEventStatusFilter = Query("open", description="open=미처리만, all=전체"),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """내담자 피드백·일정 변경 문의 목록 — 본인(target_user) 것만."""
    return agent_counselor_service.list_relay_events(
        db, current_user["id"], status=status, limit=limit
    )


@router.post("/relay-events/{event_id}/handled", response_model=RelayEventResponse)
def mark_relay_handled(
    event_id: str,
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """전달 사항 처리 완료 — 타 상담사 이벤트 id 는 404."""
    return agent_counselor_service.mark_relay_handled(db, current_user["id"], event_id)


@router.post(
    "/messages/{message_id}/cta/{cta_id}", response_model=CounselorCtaExecuteResponse
)
def execute_cta(
    message_id: str,
    cta_id: str,
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """CTA 실행 기록 — 상담사 채널 CTA 는 모두 화면 이동이라 서버 상태를 바꾸지 않는다."""
    return agent_counselor_service.execute_cta(
        db, current_user["id"], message_id, cta_id
    )


# ---------------------------------------------------------------------------
# SDD-191: 안부 대화 스위치 · 프로파일 · 체크인 요약 · 위험 신호
# ---------------------------------------------------------------------------
#
# 담당(active 링크) 내담자가 아니면 404 다 — 다른 상담사의 내담자인지조차 알려주지
# 않는다. 프로파일·위험 excerpt 는 소유자 검증을 통과한 상담사에게만 나간다.


@router.get("/checkin/clients", response_model=CheckinClientListResponse)
def list_checkin_clients(
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """안부 대화 대상 목록 — 담당 내담자 전원 + 켜짐 여부 + 미처리 알림 수."""
    return agent_counselor_service.list_checkin_clients(db, current_user["id"])


@router.put("/checkin/clients/{client_id}", response_model=CheckinClient)
def set_checkin_enabled(
    client_id: str,
    payload: CheckinEnableRequest,
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """내담자별 안부 대화 켜기/끄기(D5=②). 담당이 아닌 내담자 id 는 404."""
    return agent_counselor_service.set_checkin_enabled(
        db, current_user["id"], client_id, payload.enabled
    )


@router.get("/clients/{client_id}/profile", response_model=ProfileItemListResponse)
def get_client_profile(
    client_id: str,
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """상담사 전용 프로파일 조회 — 기각(dismissed) 항목은 제외한다."""
    return agent_counselor_service.get_client_profile(db, current_user["id"], client_id)


@router.patch("/profile-items/{item_id}", response_model=ProfileItem)
def update_profile_item(
    item_id: str,
    payload: ProfileItemUpdateRequest,
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """프로파일 항목 확정/기각/문구 수정 — 타 상담사 항목 id 는 404."""
    return agent_counselor_service.update_profile_item(
        db, current_user["id"], item_id, status=payload.status, text=payload.text
    )


@router.get("/clients/{client_id}/checkins", response_model=CheckinSummaryListResponse)
def list_client_checkins(
    client_id: str,
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """체크인 요약 타임라인(최신순) — 대화 원문은 포함하지 않는다(D1)."""
    return agent_counselor_service.list_client_checkins(
        db, current_user["id"], client_id, limit=limit
    )


@router.get("/risk-signals", response_model=RiskSignalListResponse)
def list_risk_signals(
    status: RiskSignalStatusFilter = Query("open", description="open=미처리만, all=전체"),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """확인이 필요한 알림 목록 — 본인 담당 내담자 신호만, 미처리 우선."""
    return agent_counselor_service.list_risk_signals(
        db, current_user["id"], status=status, limit=limit
    )


@router.post("/risk-signals/{signal_id}/handled", response_model=RiskSignal)
def mark_risk_handled(
    signal_id: str,
    current_user: dict = Depends(_counselor_only),
    db: DBSession = Depends(get_db),
):
    """위험 신호 처리 완료 — 타 상담사 신호 id 는 404."""
    return agent_counselor_service.mark_risk_handled(db, current_user["id"], signal_id)
