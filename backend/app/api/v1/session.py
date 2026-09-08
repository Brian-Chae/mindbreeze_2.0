"""세션 관리 API"""

from uuid import UUID

from fastapi.responses import HTMLResponse
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_current_user_optional
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
    SessionByCodeResponse,
    SessionLiveMetricsResponse,
    MarkerRequest,
    SessionCreateRequest,
    SessionListResponse,
    SessionResponse,
    SessionUpdateRequest,
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


def _make_transition_endpoint(action: str):
    def endpoint(
        session_id: str,
        current_user: dict = Depends(get_current_user),
        db: DBSession = Depends(get_db),
    ):
        return session_service.transition_status(session_id, current_user["id"], action, db)
    return endpoint


for _action in ("start", "pause", "resume", "end", "cancel"):
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
                                 "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"})
