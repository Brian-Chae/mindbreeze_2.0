"""연구 목적 데이터 활용 동의 (SDD-209 B11 / BE-R1).

- 기본은 **미동의**(기록 없음). 동의 여부는 입장·업로드·리포트 생성의 게이트가 아니다 — 이 모듈은 그런 경로에서 호출되지 않는다.
- 가명 ID: ``HMAC-SHA256(키, NFC(trim(이름)) + "|" + 생년월일)`` 16진 64자.
  키는 서버 ``.env``(``RESEARCH_ID_KEY_V{n}``) 전용이며 **값을 어디에도 출력·로깅하지 않는다**(로그에는 참여자 id 만).
  이름 원문과 입력된 전체 생년월일은 계산 직후 폐기하고 저장하지 않는다. 생년월일은 연·월(``YYYY-MM``)만 보관한다(N-4).
- 상담사는 익명 집계(인원 수)만 본다. 철회는 플랫폼 관리자 경로만(사유 필수·이력/요청 기록).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import unicodedata
import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.client_profile import ClientProfile
from app.models.research import ResearchConsent, ResearchConsentEvent, ResearchWithdrawalRequest
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.services import session_service
from app.services.session_authz import SessionAction, get_session_authorized

logger = logging.getLogger(__name__)

# 서버가 기본으로 기록하는 고지 문구 버전(클라이언트가 보내지 않을 때)
DEFAULT_NOTICE_VERSION = "r5-1"

STATE_NOT_APPLICABLE = "not_applicable"
STATE_PENDING = "pending"
STATE_BLOCKED_KEY = "blocked_key_missing"
STATE_BLOCKED_IDENTITY = "blocked_identity_missing"
STATE_BLOCKED_WITHDRAWN = "blocked_withdrawn"
STATE_WITHDRAWN = "withdrawn"

_BLOCK_REASONS = {
    STATE_BLOCKED_KEY: "research_key_not_configured",
    STATE_BLOCKED_IDENTITY: "identity_incomplete",
    STATE_BLOCKED_WITHDRAWN: "subject_withdrawn",
}


# ── 가명 ID ────────────────────────────────────────────────────────────


def normalize_name(name: str) -> str:
    """NFC 정규화 + 앞뒤 공백 제거 + 내부 공백 연속을 하나로."""
    return " ".join(unicodedata.normalize("NFC", name or "").split())


def key_for_version(version: int) -> str | None:
    """해당 버전의 키(값은 호출자도 출력하지 않는다). 미설정이면 None."""
    value = getattr(settings, f"research_id_key_v{version}", "") or ""
    return value or None


def current_key_version() -> int:
    return int(getattr(settings, "research_id_key_version", 1) or 1)


def compute_subject_id(name: str, birth_date: date, version: int) -> str | None:
    """가명 ID — 키가 없으면 None. 이름·생년월일 원문은 반환·저장하지 않는다."""
    key = key_for_version(version)
    if not key:
        return None
    message = f"{normalize_name(name)}|{birth_date.isoformat()}".encode("utf-8")
    return hmac.new(key.encode("utf-8"), message, hashlib.sha256).hexdigest()


def birth_year_month(birth_date: date) -> str:
    """N-4: 일(日)은 버리고 YYYY-MM 만 남긴다."""
    return f"{birth_date.year:04d}-{birth_date.month:02d}"


# ── 내부 유틸 ──────────────────────────────────────────────────────────


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_consent(participant_id: uuid.UUID, db: DBSession) -> ResearchConsent | None:
    return db.query(ResearchConsent).filter(ResearchConsent.participant_id == participant_id).first()


def _identity(p: SessionParticipant, db: DBSession) -> tuple[str | None, date | None, str | None]:
    """동의 시점의 (이름, 생년월일, 성별) — 비회원은 입력값, 회원은 계정/프로필 값. 호출자는 로그에 싣지 않는다."""
    name = p.guest_name
    birth = p.birth_date
    gender = p.gender
    if p.user_id:
        user = db.query(User).filter(User.id == p.user_id).first()
        name = user.name if user else name
        if birth is None or gender is None:
            profile = db.query(ClientProfile).filter(ClientProfile.user_id == p.user_id).first()
            if profile:
                birth = birth or profile.birth_date
                gender = gender or profile.gender
    return name, birth, gender


def _withdrawn_subject(subject_id: str, version: int, db: DBSession) -> bool:
    return (
        db.query(ResearchWithdrawalRequest.id)
        .filter(
            ResearchWithdrawalRequest.research_subject_id == subject_id,
            ResearchWithdrawalRequest.key_version == version,
        )
        .first()
        is not None
    )


def _view(participant_id: uuid.UUID, row: ResearchConsent | None, *, changed: bool = False) -> dict:
    state = row.export_state if row else STATE_NOT_APPLICABLE
    return {
        "participant_id": str(participant_id),
        "consented": bool(row and row.consented),
        "changed": changed,
        "notice_version": row.notice_version if row else None,
        "consented_at": row.consented_at if row else None,
        "export_state": state,
        "export_block_reason": _BLOCK_REASONS.get(state),
    }


# ── 참여자 본인 ────────────────────────────────────────────────────────


def get_own_consent(
    session_id: str,
    db: DBSession,
    *,
    entry_credential: str | None,
    current_user_id: str | None,
) -> dict:
    sid = session_service._to_uuid(session_id)
    if not db.query(Session.id).filter(Session.id == sid).first():
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    p = session_service.resolve_participant_actor(
        sid, db, entry_credential=entry_credential, current_user_id=current_user_id
    )
    return _view(p.id, _get_consent(p.id, db))


def set_own_consent(
    session_id: str,
    consented: bool,
    db: DBSession,
    *,
    notice_version: str | None = None,
    participant_id: str | None = None,
    entry_credential: str | None = None,
    current_user_id: str | None = None,
) -> dict:
    """연구 동의 저장/변경 — 본인만, 종료·취소 409, 멱등. 성공 여부가 입장·업로드를 막지 않는다."""
    sid = session_service._to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.status in ("completed", "cancelled"):
        raise HTTPException(
            status_code=409, detail="종료된 클래스에서는 연구 동의를 바꿀 수 없어요. 철회는 운영팀에 요청해 주세요"
        )
    p = session_service.resolve_participant_actor(
        sid, db, entry_credential=entry_credential, current_user_id=current_user_id,
        participant_id=participant_id,
    )

    row = _get_consent(p.id, db)
    previous = bool(row and row.consented)
    if consented == previous:
        return _view(p.id, row, changed=False)

    version = notice_version or DEFAULT_NOTICE_VERSION
    now = _now()
    if row is None:
        row = ResearchConsent(session_id=sid, participant_id=p.id)
        db.add(row)

    if consented:
        name, birth, gender = _identity(p, db)
        kv = current_key_version()
        subject_id: str | None = None
        state = STATE_PENDING
        if not key_for_version(kv):
            state = STATE_BLOCKED_KEY
            logger.warning("[research] 가명 ID 키 미설정 — 동의 저장, 내보내기 보류 participant=%s", p.id)
        elif not (name and normalize_name(name)) or birth is None:
            state = STATE_BLOCKED_IDENTITY
        else:
            subject_id = compute_subject_id(name, birth, kv)
            if subject_id and _withdrawn_subject(subject_id, kv, db):
                state = STATE_BLOCKED_WITHDRAWN
        row.consented = True
        row.notice_version = version
        row.consented_at = now
        row.withdrawn_at = None
        row.research_subject_id = subject_id
        row.key_version = kv if subject_id else None
        row.birth_year_month = birth_year_month(birth) if birth else None
        row.gender = gender
        row.export_state = state
        event_type = "consented"
    else:
        # 종료 전 본인 변경: 보관 최소화를 위해 식별 파생값을 비운다(이력은 남는다).
        row.consented = False
        row.notice_version = version
        row.research_subject_id = None
        row.key_version = None
        row.birth_year_month = None
        row.gender = None
        row.export_state = STATE_NOT_APPLICABLE
        event_type = "declined"

    db.add(
        ResearchConsentEvent(
            session_id=sid,
            participant_id=p.id,
            event_type=event_type,
            previous_consented=previous,
            new_consented=consented,
            notice_version=version,
            actor_kind="self",
            actor_user_id=p.user_id,
        )
    )
    db.commit()
    db.refresh(row)
    return _view(p.id, row, changed=True)


# ── 상담사: 익명 집계 ─────────────────────────────────────────────────


def anonymous_summary(session_id: str, host_id: str, db: DBSession) -> dict:
    """상담사에게는 인원 수만 — 개별 동의 상태·가명 ID 는 노출하지 않는다."""
    s = get_session_authorized(db, session_id, host_id, SessionAction.RESEARCH_CONSENT_SUMMARY_READ)
    active_ids = [p.id for p in (s.participants or []) if not p.is_waitlisted]
    consented = 0
    if active_ids:
        consented = (
            db.query(ResearchConsent.id)
            .filter(ResearchConsent.participant_id.in_(active_ids), ResearchConsent.consented.is_(True))
            .count()
        )
    return {"consented": consented, "total": len(active_ids)}


# ── 플랫폼 관리자 ─────────────────────────────────────────────────────


def admin_list_consents(session_id: str, db: DBSession) -> dict:
    sid = session_service._to_uuid(session_id)
    rows = (
        db.query(ResearchConsent)
        .filter(ResearchConsent.session_id == sid)
        .order_by(ResearchConsent.created_at, ResearchConsent.id)
        .all()
    )
    return {
        "session_id": str(sid),
        "items": [
            {
                "participant_id": str(r.participant_id),
                "consented": r.consented,
                "notice_version": r.notice_version,
                "consented_at": r.consented_at,
                "withdrawn_at": r.withdrawn_at,
                "research_subject_id": r.research_subject_id,
                "key_version": r.key_version,
                "birth_year_month": r.birth_year_month,
                "export_state": r.export_state,
            }
            for r in rows
        ],
    }


def admin_withdraw(name: str, birth_date: date, reason: str, admin_id: uuid.UUID, db: DBSession) -> dict:
    """요청자가 제시한 이름+생년월일로 가명 ID 를 재계산해 동의 건을 철회한다.

    기본 DB 개인정보(이름·생년월일)가 이미 스크럽됐어도 ``research_consents`` 의 가명 해시로 대조한다.
    제시된 이름·생년월일은 계산 후 폐기한다(저장·로깅 없음). 키 버전은 설정된 모든 버전을 대조한다.
    """
    clean_reason = (reason or "").strip()
    if not clean_reason:
        raise HTTPException(status_code=422, detail="철회 사유를 입력해 주세요")
    current = current_key_version()
    candidates: list[tuple[int, str]] = []
    for v in range(1, current + 1):
        sid_hash = compute_subject_id(name, birth_date, v)
        if sid_hash:
            candidates.append((v, sid_hash))
    if not candidates:
        raise HTTPException(
            status_code=409, detail="연구 ID 키가 설정되지 않아 철회 대조를 할 수 없어요. 서버 설정을 확인해 주세요"
        )

    now = _now()
    withdrawn = 0
    for version, subject_id in candidates:
        rows = (
            db.query(ResearchConsent)
            .filter(
                ResearchConsent.research_subject_id == subject_id,
                ResearchConsent.key_version == version,
                ResearchConsent.consented.is_(True),
            )
            .all()
        )
        for r in rows:
            db.add(
                ResearchConsentEvent(
                    session_id=r.session_id,
                    participant_id=r.participant_id,
                    event_type="withdrawn",
                    previous_consented=True,
                    new_consented=False,
                    notice_version=r.notice_version,
                    actor_kind="platform_admin",
                    actor_user_id=admin_id,
                    reason=clean_reason,
                )
            )
            r.consented = False
            r.withdrawn_at = now
            r.export_state = STATE_WITHDRAWN
            withdrawn += 1
        # 이후 새 동의도 적재 대상이 아니도록 요청 레코드를 남긴다(키 버전별 1건).
        db.add(
            ResearchWithdrawalRequest(
                research_subject_id=subject_id,
                key_version=version,
                requested_by=admin_id,
                reason=clean_reason,
                affected_count=len(rows),
            )
        )
    db.commit()
    return {"withdrawn_count": withdrawn, "requests_recorded": len(candidates)}
