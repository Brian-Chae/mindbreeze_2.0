"""SDD-220 — F1 회차별 녹음·녹화 필수 동의 · 뇌파 수집 선택 동의(서버 게이트).

- F1: 회원·게스트 모두 회차(참여자 행)마다 ``recording_consented=true`` + 고지 버전이 저장된 뒤에만 입장 자격과
  LiveKit 토큰이 나간다. 누락·거부·저장 실패는 403 ``RECORDING_CONSENT_REQUIRED``. 리포트 반영/연구 거부는 입장을 막지 않는다.
- 뇌파 수집: 리포트 제외(consent_eeg/report_included)와 별개. 거부(False)면 EEG 업로드를 403 ``EEG_CONSENT_REQUIRED`` 로 막는다.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.consent import Consent
from app.models.session import Session, SessionParticipant
from app.services.signup_policy_service import api_error

RECORDING_NOTICE_VERSION = "rec-1"
EEG_NOTICE_VERSION = "eeg-1"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def recording_required() -> HTTPException:
    return api_error(403, "RECORDING_CONSENT_REQUIRED", "이 클래스는 녹음·녹화될 수 있어요. 동의하면 입장할 수 있어요")


def eeg_required() -> HTTPException:
    return api_error(403, "EEG_CONSENT_REQUIRED", "뇌파 수집에 동의하지 않아 밴드 데이터를 보낼 수 없어요")


def is_recorded(participant: SessionParticipant | None) -> bool:
    return bool(participant is not None and participant.recording_consented and participant.recording_notice_version)


def require_recording_consent(participant: SessionParticipant) -> None:
    if not is_recorded(participant):
        raise recording_required()


def apply_recording_consent(participant: SessionParticipant, notice_version: str | None, *, now: datetime | None = None) -> None:
    """저장은 호출자 트랜잭션에 참여한다(커밋 실패 시 입장도 실패)."""
    participant.recording_consented = True
    participant.recording_consent_at = now or _now()
    participant.recording_notice_version = (notice_version or RECORDING_NOTICE_VERSION)[:20]


def account_eeg_consent(db: DBSession, user_id: uuid.UUID | str | None) -> bool:
    """계정 단위 뇌파 선택 동의(가입/설정). 철회했거나 기록이 없으면 False — true 로 추정하지 않는다."""
    if user_id is None:
        return False
    uid = uuid.UUID(str(user_id))
    row = (
        db.query(Consent)
        .filter(Consent.user_id == uid, Consent.type == "eeg")
        .order_by(Consent.agreed_at.desc())
        .first()
    )
    return bool(row and row.agreed and row.withdrawn_at is None)


def apply_eeg_choice(participant: SessionParticipant, agreed: bool, notice_version: str | None, *, now: datetime | None = None) -> None:
    participant.eeg_collection_consented = bool(agreed)
    participant.eeg_collection_consent_at = now or _now()
    participant.eeg_notice_version = (notice_version or EEG_NOTICE_VERSION)[:20]


def assert_eeg_upload_allowed(participant: SessionParticipant) -> None:
    """EEG 업로드 권한 — 명시적 거부(False)면 차단. NULL 은 이 기능 이전 행이라 기존 동작을 유지한다."""
    if participant.eeg_collection_consented is False:
        raise eeg_required()


def sync_account_eeg_choice(db: DBSession, user_id: uuid.UUID, agreed: bool, *, now: datetime | None = None) -> int:
    """계정 설정에서 뇌파 동의를 바꾸면 종료 전 회차의 본인 참여자 행에도 같은 값을 맞춘다."""
    stamp = now or _now()
    rows = (
        db.query(SessionParticipant)
        .join(Session, Session.id == SessionParticipant.session_id)
        .filter(SessionParticipant.user_id == user_id, Session.status.notin_(("completed", "cancelled")))
        .all()
    )
    for p in rows:
        apply_eeg_choice(p, agreed, None, now=stamp)
    return len(rows)


# ── 회차 동의 저장·조회 (입장 자격 또는 로그인 회원 본인) ───────────────────────


def _view(participant: SessionParticipant) -> dict:
    return {
        "participant_id": str(participant.id),
        "recording_consented": bool(participant.recording_consented),
        "recording_notice_version": participant.recording_notice_version,
        "recording_consent_at": participant.recording_consent_at,
        "eeg_collection_consented": participant.eeg_collection_consented,
        "eeg_notice_version": participant.eeg_notice_version,
    }


def _own_participant(session_id: str, db: DBSession, *, entry_credential: str | None, current_user_id: str | None) -> SessionParticipant:
    from app.services import session_service

    sid = session_service._to_uuid(session_id)
    if not db.query(Session.id).filter(Session.id == sid).first():
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return session_service.resolve_participant_actor(
        sid, db, entry_credential=entry_credential, current_user_id=current_user_id
    )


def get_entry_consents(session_id: str, db: DBSession, *, entry_credential: str | None, current_user_id: str | None) -> dict:
    return _view(_own_participant(session_id, db, entry_credential=entry_credential, current_user_id=current_user_id))


def set_recording_consent(
    session_id: str, consented: bool, notice_version: str | None, db: DBSession,
    *, entry_credential: str | None, current_user_id: str | None,
) -> dict:
    """회차 녹음·녹화 동의 저장. 저장이 실패하면(예외) 동의가 있는 것으로 보지 않는다."""
    participant = _own_participant(session_id, db, entry_credential=entry_credential, current_user_id=current_user_id)
    if consented:
        apply_recording_consent(participant, notice_version)
    else:
        participant.recording_consented = False
        participant.recording_consent_at = None
        participant.recording_notice_version = None
    db.commit()
    db.refresh(participant)
    return _view(participant)


def set_eeg_collection_consent(
    session_id: str, consented: bool, notice_version: str | None, db: DBSession,
    *, entry_credential: str | None, current_user_id: str | None,
) -> dict:
    participant = _own_participant(session_id, db, entry_credential=entry_credential, current_user_id=current_user_id)
    apply_eeg_choice(participant, consented, notice_version)
    db.commit()
    db.refresh(participant)
    return _view(participant)
