"""세션 관리 API"""

from uuid import UUID

from fastapi.responses import HTMLResponse
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_current_user_optional
from app.api.v1.onboarding import _parse_date
from app.core.database import get_db
from app.schemas.session import (
    ReportEmailRequest,
    ReportEmailResponse,
    EEGFeatureBatchRequest,
    EEGFeatureBatchResponse,
    GuestSessionStateResponse,
    InviteParticipantRequest,
    JoinByCodeRequest,
    JoinByCodeResponse,
    MemberLiveKitTokenRequest,
    MemberLiveKitTokenResponse,
    RaiseHandRequest,
    SessionByCodeResponse,
    SessionChatEnabledRequest,
    SessionChatRoomResponse,
    SessionLiveMetricsResponse,
    MarkerRequest,
    SessionCreateRequest,
    SessionDuplicateRequest,
    SessionListResponse,
    SessionResponse,
    SessionTemplateSaveRequest,
    SessionUpdateRequest,
    SpeakingRequest,
    SpeakingStateResponse,
)
from app.schemas.eeg import (
    EEGRollupResponse,
    RawAckRequest,
    RawAckResponse,
    RawPresignRequest,
    RawPresignResponse,
)
from app.services import eeg_raw_service, eeg_rollup_service, session_service, report_email_service

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("", response_model=SessionListResponse)
def list_sessions(
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    sessions, total = session_service.list_sessions(current_user["id"], db)
    return SessionListResponse(sessions=sessions, total=total)


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.create_session(current_user["id"], payload, db)


# 주의: "/{session_id}" 라우트보다 먼저 선언해야 "by-code"가 세션 ID로 해석되지 않는다.
@router.get("/by-code/{code}", response_model=SessionByCodeResponse)
def get_session_by_code(code: str, db: DBSession = Depends(get_db)):
    """클래스 코드로 클래스 정보 조회 — 참여 전 확인용(인증 불필요)."""
    return session_service.get_session_by_code(code, db)


@router.post("/by-code/{code}/join", response_model=JoinByCodeResponse)
def join_session_by_code(
    code: str,
    payload: JoinByCodeRequest | None = None,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """클래스 코드로 참여 — 로그인 사용자는 user_id로, 게스트는 이름으로 등록한다."""
    name = payload.name if payload else None
    return session_service.join_session_by_code(
        code,
        db,
        user_id=current_user["id"] if current_user else None,
        guest_name=name,
        gender=payload.gender if payload and not current_user else None,
        birth_date=_parse_date(payload.birth_date) if payload and not current_user else None,
    )


# 주의: "/{session_id}" 라우트보다 먼저 선언해야 "by-code"가 세션 ID로 해석되지 않는다.
@router.get("/by-code/{code}/state", response_model=GuestSessionStateResponse)
def get_guest_session_state(
    code: str,
    participant_id: str | None = None,
    db: DBSession = Depends(get_db),
):
    """게스트 상태 조회 — 인증 없이 세션/본인 상태를 확인한다(대기→명상 전이 감지)."""
    return session_service.get_guest_session_state(code, db, participant_id=participant_id)


# 회원/게스트 구독 전용 LiveKit 토큰 — 상담사 영상·음성 라이브 수신용.
# 주의: "/{session_id}" 라우트보다 먼저 선언해야 "by-code"가 세션 ID로 해석되지 않는다.
@router.post("/by-code/{code}/livekit-token", response_model=MemberLiveKitTokenResponse)
def get_member_livekit_token(
    code: str,
    payload: MemberLiveKitTokenRequest,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """회원/게스트 LiveKit 토큰을 발급한다.

    can_publish 는 온라인 세션 + (1:1 또는 그룹 20명 이하)일 때만 True.
    """
    return session_service.member_livekit_token(
        code,
        payload.participant_id,
        db,
        participant_token=payload.participant_token,
        current_user_id=current_user["id"] if current_user else None,
    )


# ── SDD-095: 클래스 템플릿 (설정 저장본) ──
# 주의: "/{session_id}" 라우트보다 먼저 선언해야 "templates"가 세션 ID로 해석되지 않는다.


@router.get("/templates", response_model=SessionListResponse)
def list_session_templates(
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """내 클래스 템플릿 목록 — 생성 폼의 '내 템플릿에서 시작' 드롭다운용."""
    templates, total = session_service.list_templates(current_user["id"], db)
    return SessionListResponse(sessions=templates, total=total)


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.get_session(session_id, current_user["id"], db)


@router.put("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    payload: SessionUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.update_session(session_id, current_user["id"], payload, db)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    session_service.delete_session(session_id, current_user["id"], db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 클래스 실시간 채팅 (세션 채팅방 · on/off) ──
# 주의: 아래 상태전이 라우트(POST /{session_id}/{action})보다 먼저 선언해야
# "chat-enabled"가 action 으로 해석되지 않는다.


@router.get("/{session_id}/chat-room", response_model=SessionChatRoomResponse)
def get_session_chat_room(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """세션 채팅방 조회 — host 또는 참여자. 프론트는 room_id 로 /chat WS 에 연결한다."""
    return session_service.get_session_chat_room(session_id, current_user["id"], db)


@router.post("/{session_id}/chat-enabled", response_model=SessionChatRoomResponse)
def set_session_chat_enabled(
    session_id: str,
    payload: SessionChatEnabledRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """클래스 실시간 채팅 켜기/끄기 — host(상담사) 전용. 참여자 호출은 403."""
    return session_service.set_chat_enabled(
        session_id, current_user["id"], payload.enabled, db
    )


def _make_transition_endpoint(action: str):
    def endpoint(
        session_id: str,
        current_user: dict = Depends(get_current_user),
        db: DBSession = Depends(get_db),
    ):
        return session_service.transition_status(session_id, current_user["id"], action, db)
    return endpoint


# SDD-088: "open"(클래스 오픈) 액션 추가 — ready/scheduled → open
for _action in ("open", "start", "pause", "resume", "end", "cancel"):
    router.add_api_route(
        f"/{{session_id}}/{_action}",
        _make_transition_endpoint(_action),
        methods=["POST"],
        response_model=SessionResponse,
        name=f"session_{_action}",
    )


@router.post("/{session_id}/new-run", response_model=SessionResponse)
def start_new_run(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """SDD-028: 같은 수업 정의를 "새 실행(명시적)"으로 열어 새 run_id 를 발급한다.

    completed·cancelled 세션은 즉시 재시작할 수 없다(400). host 상담사 전용.
    """
    return session_service.start_new_run(session_id, current_user["id"], db)


# ── SDD-095: 클래스 복제 · 템플릿 저장 ──


@router.post(
    "/{session_id}/duplicate",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_session(
    session_id: str,
    payload: SessionDuplicateRequest | None = None,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """클래스 복제 — 유형 설정만 복사해 새 클래스(참여코드/룸/회차 신규)를 만든다.

    원본이 템플릿이어도 결과물은 항상 실제 클래스다. host 상담사 전용.
    """
    body = payload or SessionDuplicateRequest()
    return session_service.duplicate_session(
        session_id,
        current_user["id"],
        db,
        scheduled_at=body.scheduled_at,
        title=body.title,
        force=body.force,
    )


@router.post(
    "/{session_id}/save-as-template",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def save_session_as_template(
    session_id: str,
    payload: SessionTemplateSaveRequest | None = None,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """현재 클래스의 유형 설정을 재사용 가능한 템플릿(is_template=True)으로 저장한다."""
    return session_service.save_as_template(
        session_id,
        current_user["id"],
        db,
        title=payload.title if payload else None,
    )


@router.post("/{session_id}/invite", response_model=SessionResponse)
def invite_participant(
    session_id: str,
    payload: InviteParticipantRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.invite_participant(session_id, current_user["id"], payload.user_id, db)


@router.delete("/{session_id}/participants/{user_id}", response_model=SessionResponse)
def remove_participant(
    session_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.remove_participant(session_id, current_user["id"], user_id, db)


# SDD-094: 발언권 관리 — 회원/게스트 손들기
@router.post(
    "/{session_id}/participants/{participant_id}/raise-hand",
    response_model=SpeakingStateResponse,
)
def raise_hand(
    session_id: str,
    participant_id: str,
    payload: RaiseHandRequest | None = None,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """참여자 손들기 — raise_hand=True 로 표시.

    로그인 회원은 본인 참여자만, 게스트는 body.participant_token 소유 증명이 필요하다.
    """
    return session_service.raise_hand(
        session_id,
        participant_id,
        db,
        participant_token=payload.participant_token if payload else None,
        current_user_id=current_user["id"] if current_user else None,
    )


# SDD-094: 발언권 관리 — 상담사 부여/해제
@router.post(
    "/{session_id}/participants/{participant_id}/speaking",
    response_model=SpeakingStateResponse,
)
def set_speaking(
    session_id: str,
    participant_id: str,
    payload: SpeakingRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """상담사 발언권 부여/해제 — speaking=granted. 호스트(상담사) 전용.

    부여 시 손들기(raise_hand)는 자동 해제된다.
    """
    return session_service.set_speaking(
        session_id, current_user["id"], participant_id, payload.granted, db
    )


@router.post("/{session_id}/markers")
def add_marker(
    session_id: str,
    payload: MarkerRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.add_marker(
        session_id, current_user["id"], payload.timestamp_sec, payload.note, db
    )


@router.post("/{session_id}/features", response_model=EEGFeatureBatchResponse)
def ingest_eeg_features(
    session_id: str,
    payload: EEGFeatureBatchRequest,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """SDD-023: LINK BAND 5초 배치 EEG feature 업로드.

    게스트는 participant_id 로, 로그인 참가자는 인증 토큰으로 식별한다(비참가자 403).
    """
    return session_service.ingest_features(
        session_id,
        payload,
        db,
        current_user_id=current_user["id"] if current_user else None,
    )


@router.get("/{session_id}/eeg-rollup", response_model=EEGRollupResponse)
def get_eeg_rollup(
    session_id: str,
    participant_id: str | None = None,
    resolution: int = 60,
    start_bucket: int | None = None,
    end_bucket: int | None = None,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """SDD-027: 60초 롤업 조회 — host 상담사 전용.

    EEGFeatureWindow(1초 원천) 온디맨드 집계(valid_count/coverage/유효샘플 가중평균).
    SDD-028: start_bucket/end_bucket(batch key)로 필요한 버킷 구간만 조회할 수 있다.
    """
    session_service._get_session_as_host(session_id, current_user["id"], db)
    return eeg_rollup_service.compute_rollup(
        session_id,
        db,
        participant_id=participant_id,
        resolution_sec=resolution,
        start_bucket=start_bucket,
        end_bucket=end_bucket,
    )


@router.post("/{session_id}/eeg-raw/presign", response_model=RawPresignResponse)
def presign_eeg_raw(
    session_id: str,
    payload: RawPresignRequest,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """SDD-027: raw EEG 청크 presigned PUT URL 발급 + manifest 생성.

    게스트는 participant_id 로, 로그인 참가자는 인증 토큰으로 소유 검증(비참가자 403).
    """
    return eeg_raw_service.presign_upload(
        session_id, payload, db,
        current_user_id=current_user["id"] if current_user else None,
    )


@router.post("/{session_id}/eeg-raw/ack", response_model=RawAckResponse)
def ack_eeg_raw(
    session_id: str,
    payload: RawAckRequest,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """SDD-027: raw EEG 청크 업로드 완료 확인(ack) — EEGRecord.file_count 갱신."""
    return eeg_raw_service.ack_upload(
        session_id, payload, db,
        current_user_id=current_user["id"] if current_user else None,
    )


@router.get("/{session_id}/live-metrics", response_model=SessionLiveMetricsResponse)
def get_live_metrics(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """호스트 전용 실시간 참가자 모니터링 데이터 (뇌파 값은 Phase 2 placeholder)."""
    return session_service.get_live_metrics(session_id, current_user["id"], db)


# ── LiveKit WebRTC ──────────────────────────────────────────────

@router.post("/{session_id}/livekit-token")
def get_livekit_token(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """현재 사용자에게 LiveKit 접근 토큰을 발급합니다."""
    s = session_service._get_session_for_participant(session_id, current_user["id"], db)
    if not s.webrtc_room_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="WebRTC 룸이 아직 생성되지 않았습니다")
    token = session_service.generate_livekit_token(
        room_name=str(s.webrtc_room_id),
        participant_name=current_user.get("name", "익명"),
        participant_id=current_user["id"],
    )
    return {"livekit_token": token, "webrtc_room_id": str(s.webrtc_room_id)}


@router.post("/{session_id}/join")
def join_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """세션 입장 처리 — 상태 전이 + LiveKit 토큰 발급"""
    return session_service.join_session(
        session_id=session_id,
        user_id=current_user["id"],
        user_name=current_user.get("name", "익명"),
        db=db,
    )


# SDD-029: 게스트 리포트 메일 요청 및 만료 링크 열람


@router.post("/{session_id}/report-email", response_model=ReportEmailResponse, status_code=202)
def request_report_email(
    session_id: UUID, payload: ReportEmailRequest,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    return report_email_service.request_report_email(
        session_id, payload, db, current_user["id"] if current_user else None,
    )


@router.get("/{session_id}/report-email/view", response_class=HTMLResponse)
def view_report_email(session_id: UUID, token: str, db: DBSession = Depends(get_db)):
    return HTMLResponse(report_email_service.view_report_email(session_id, token, db),
                        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                                 "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"})
