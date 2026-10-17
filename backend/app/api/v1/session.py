"""세션 관리 API"""

from typing import Annotated
from uuid import UUID

from fastapi.responses import HTMLResponse
from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_current_user_optional
from app.api.v1.onboarding import _parse_date
from app.core.database import get_db
from app.core.redis import get_redis
from app.schemas.session import (
    ReportEmailRequest,
    ReportEmailResponse,
    EEGFeatureBatchRequest,
    EEGFeatureBatchResponse,
    EnterRequest,
    EnterResponse,
    EnterVerifyRequest,
    EnterVerifyResponse,
    EntryStateResponse,
    InviteParticipantRequest,
    MemberLiveKitTokenResponse,
    ReportChoiceRequest,
    ReportChoiceResponse,
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
    page: int | None = Query(default=None, ge=1),
    # VB-09: limit 상한(le) 미지정 → 초과 limit 대량 반환 차단.
    limit: int | None = Query(default=None, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    sessions, total = session_service.list_sessions(
        current_user["id"], db, page=page, limit=limit
    )
    return SessionListResponse(sessions=sessions, total=total)


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    return session_service.create_session(current_user["id"], payload, db)


# ── SDD-209(B5a): 로그인 없는 4자리 코드 입장 ──
# 주의: "/{session_id}" 라우트보다 먼저 선언해야 "enter"가 세션 ID로 해석되지 않는다.
EntryCredential = Annotated[str | None, Header(alias="X-Entry-Credential")]


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.post("/enter/verify", response_model=EnterVerifyResponse)
async def verify_entry_code(
    payload: EnterVerifyRequest,
    request: Request,
    db: DBSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """코드 확인만 — 시도 제한 대상. 없는/틀린/종료 코드는 같은 404, 제한 시 같은 429."""
    from fastapi import HTTPException

    from app.services import class_code_attempt_service as attempts, class_code_service

    ip = _client_ip(request)
    await attempts.check_allowed(redis, ip)
    normalized = class_code_service.normalize_class_code(payload.code)
    await attempts.note_code_request(redis, normalized)
    try:
        return await run_in_threadpool(session_service.verify_entry_code, payload.code, db)
    except HTTPException as exc:
        if exc.status_code == 404:
            await attempts.record_failure(redis, ip)
        raise


@router.post("/enter", response_model=EnterResponse)
async def enter_session(
    payload: EnterRequest,
    request: Request,
    current_user: dict | None = Depends(get_current_user_optional),
    x_entry_credential: EntryCredential = None,
    db: DBSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """코드 + 개인정보로 입장 — 로그인·초대 불요(이메일 OTP 없음). 성공 시 입장 자격 발급."""
    from fastapi import HTTPException

    from app.services import class_code_attempt_service as attempts, class_code_service

    ip = _client_ip(request)
    await attempts.check_allowed(redis, ip)
    normalized = class_code_service.normalize_class_code(payload.code)
    await attempts.note_code_request(redis, normalized)
    try:
        return await run_in_threadpool(
            lambda: session_service.enter_session(
                payload.code,
                db,
                user_id=current_user["id"] if current_user else None,
                name=payload.name,
                gender=payload.gender,
                birth_date=_parse_date(payload.birth_date) if payload.birth_date else None,
                email=payload.email,
                entry_credential=x_entry_credential or payload.entry_credential,
            )
        )
    except HTTPException as exc:
        if exc.status_code == 404:
            await attempts.record_failure(redis, ip)
        raise


@router.post("/entry/revoke", status_code=status.HTTP_204_NO_CONTENT)
def revoke_entry_credential(
    x_entry_credential: EntryCredential = None,
    db: DBSession = Depends(get_db),
):
    """입장 자격 폐기(로그아웃) — 이 자격으로 발급된 모든 토큰이 무효가 된다."""
    session_service.revoke_entry_credential(x_entry_credential, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── SDD-095: 클래스 템플릿 (설정 저장본) ──
# 주의: "/{session_id}" 라우트보다 먼저 선언해야 "templates"가 세션 ID로 해석되지 않는다.


@router.get("/templates", response_model=SessionListResponse)
def list_session_templates(
    page: int | None = Query(default=None, ge=1),
    # VB-09: limit 상한(le) 미지정 → 초과 limit 대량 반환 차단.
    limit: int | None = Query(default=None, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """내 클래스 템플릿 목록 — 생성 폼의 '내 템플릿에서 시작' 드롭다운용."""
    templates, total = session_service.list_templates(
        current_user["id"], db, page=page, limit=limit
    )
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
for _action in ("open", "start", "end", "cancel"):
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
    x_entry_credential: EntryCredential = None,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """참여자 손들기 — raise_hand=True 로 표시.

    로그인 회원은 본인 참여자만, 비회원은 입장 자격(X-Entry-Credential)이 필요하다.
    """
    return session_service.raise_hand(
        session_id,
        participant_id,
        db,
        entry_credential=x_entry_credential,
        current_user_id=current_user["id"] if current_user else None,
    )


@router.get("/{session_id}/entry-state", response_model=EntryStateResponse)
def get_entry_state(
    session_id: str,
    x_entry_credential: EntryCredential = None,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """참여자 본인 상태 — 입장 자격(X-Entry-Credential) 또는 로그인 회원만. 코드/식별자 단독은 401."""
    return session_service.get_entry_state(
        session_id,
        db,
        entry_credential=x_entry_credential,
        current_user_id=current_user["id"] if current_user else None,
    )


@router.post("/{session_id}/entry/livekit-token", response_model=MemberLiveKitTokenResponse)
def get_participant_livekit_token(
    session_id: str,
    x_entry_credential: EntryCredential = None,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """참여자 구독/송신 LiveKit 토큰 — 입장 자격 또는 로그인 회원만(대기열·타인 403, 자격 없음 401).

    can_publish 는 온라인 + (1:1 또는 그룹≤20 & 발언권)일 때만 True. 호스트 토큰과 분리된 경로다.
    """
    return session_service.participant_livekit_token(
        session_id,
        db,
        entry_credential=x_entry_credential,
        current_user_id=current_user["id"] if current_user else None,
    )


@router.post("/{session_id}/enter", response_model=EnterResponse)
def enter_invited_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """초대받은 로그인 회원의 편의 입장 — 초대 행이 있을 때만(없으면 403 + 코드 입장 안내)."""
    return session_service.enter_session_as_invited(session_id, current_user["id"], db)


@router.put("/{session_id}/report-choice", response_model=ReportChoiceResponse)
def set_report_choice(
    session_id: str,
    payload: ReportChoiceRequest,
    x_entry_credential: EntryCredential = None,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """SDD-209(B2): 리포트 반영 선택 — 본인 참여자만, 종료·취소 409, 멱등."""
    return session_service.set_report_choice(
        session_id,
        payload.participant_id,
        payload.report_included,
        db,
        notice_acknowledged=payload.notice_acknowledged,
        notice_version=payload.notice_version,
        entry_credential=x_entry_credential,
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
    x_entry_credential: EntryCredential = None,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """SDD-023: LINK BAND 5초 배치 EEG feature 업로드.

    비회원은 입장 자격(X-Entry-Credential)으로, 로그인 참가자는 인증 토큰으로 식별한다
    (자격 없음 401 · 비참가자/타인 403).
    """
    return session_service.ingest_features(
        session_id,
        payload,
        db,
        current_user_id=current_user["id"] if current_user else None,
        entry_credential=x_entry_credential,
    )


@router.get("/{session_id}/eeg-rollup", response_model=EEGRollupResponse)
def get_eeg_rollup(
    session_id: str,
    participant_id: str | None = None,
    # VB-14: resolution/버킷 범위를 FastAPI 레벨에서 검증한다(서비스의 부분 가드 의존 제거).
    resolution: int = Query(60, ge=1, le=3600),
    start_bucket: int | None = Query(None, ge=0),
    end_bucket: int | None = Query(None, ge=0),
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
    x_entry_credential: EntryCredential = None,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """SDD-027: raw EEG 청크 presigned PUT URL 발급 + manifest 생성.

    비회원은 입장 자격(X-Entry-Credential)으로, 로그인 참가자는 인증 토큰으로 소유 검증
    (자격 없음 401 · 비참가자/타인 403).
    """
    return eeg_raw_service.presign_upload(
        session_id, payload, db,
        current_user_id=current_user["id"] if current_user else None,
        entry_credential=x_entry_credential,
    )


@router.post("/{session_id}/eeg-raw/ack", response_model=RawAckResponse)
def ack_eeg_raw(
    session_id: str,
    payload: RawAckRequest,
    x_entry_credential: EntryCredential = None,
    current_user: dict | None = Depends(get_current_user_optional),
    db: DBSession = Depends(get_db),
):
    """SDD-027: raw EEG 청크 업로드 완료 확인(ack) — EEGRecord.file_count 갱신."""
    return eeg_raw_service.ack_upload(
        session_id, payload, db,
        current_user_id=current_user["id"] if current_user else None,
        entry_credential=x_entry_credential,
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
    """LiveKit 접근 토큰 발급 — host 전용 (SEC-LIVEKIT-PUBLISH-BYPASS).

    일반 참여자(대기열 포함)에게 can_publish=True 토큰이 발급되면 SDD-094 발언권
    게이트(speaking)를 우회해 발언할 수 있다. 참여자용 구독 토큰은
    entry/livekit-token(_compute_can_publish 적용) 경로로만 발급한다.
    """
    from fastapi import HTTPException
    s = session_service._get_session_as_host(session_id, current_user["id"], db)
    if not s.webrtc_room_id:
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
