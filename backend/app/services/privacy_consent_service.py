"""SDD-220 — 계정 단위 선택 동의(뇌파 수집·연구 활용) 조회·변경·철회.

필수 동의(tos/privacy/sensitive)는 가입 때 받고 여기서 끄지 않는다(탈퇴로만 해제).
선택 동의는 서로, 그리고 회차 녹음·녹화 필수 동의·리포트 반영 선택과 독립이다.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session as DBSession

from app.models.class_program import ClassMember
from app.models.consent import Consent
from app.models.research import ResearchConsent, ResearchWithdrawalRequest
from app.models.session import SessionParticipant
from app.services import recording_consent_service, research_consent_service
from app.services.signup_policy_service import CONSENT_VERSIONS, OPTIONAL_CONSENT_TYPES, REQUIRED_CONSENT_TYPES

WITHDRAW_REASON = "계정 설정에서 연구 활용 동의 철회"


def _latest(db: DBSession, user_id: uuid.UUID, ctype: str) -> Consent | None:
    return (
        db.query(Consent)
        .filter(Consent.user_id == user_id, Consent.type == ctype)
        .order_by(Consent.agreed_at.desc())
        .first()
    )


def get_state(db: DBSession, user_id: uuid.UUID) -> dict:
    out: dict = {}
    for ctype in (*REQUIRED_CONSENT_TYPES, *OPTIONAL_CONSENT_TYPES):
        row = _latest(db, user_id, ctype)
        out[ctype] = {
            "agreed": bool(row and row.agreed and row.withdrawn_at is None),
            "version": row.version if row else None,
            "agreed_at": row.agreed_at if row else None,
            "withdrawn_at": row.withdrawn_at if row else None,
        }
    return out


def _upsert_optional(db: DBSession, user_id: uuid.UUID, ctype: str, agreed: bool, now: datetime) -> None:
    version = CONSENT_VERSIONS[ctype]
    row = db.query(Consent).filter_by(user_id=user_id, type=ctype, version=version).first()
    if row is None:
        row = Consent(user_id=user_id, type=ctype, version=version, agreed=agreed, agreed_at=now)
        db.add(row)
    else:
        row.agreed = agreed
        row.agreed_at = now
    row.withdrawn_at = None if agreed else now


def _withdraw_research(db: DBSession, user_id: uuid.UUID, now: datetime) -> int:
    """연구 활용 철회 — 본인 참여자의 current 동의를 철회하고, 기존 export 는 철회 요청(주체 단위 1건)에 연결한다."""
    rows = (
        db.query(ResearchConsent)
        .join(SessionParticipant, SessionParticipant.id == ResearchConsent.participant_id)
        .filter(SessionParticipant.user_id == user_id, ResearchConsent.consented.is_(True))
        .all()
    )
    subjects = {(r.research_subject_id, r.key_version, r.session_id) for r in rows if r.research_subject_id and r.key_version}
    research_consent_service.withdraw_rows(
        db, rows, now=now, actor_kind="self", actor_user_id=user_id, reason=WITHDRAW_REASON
    )
    seen: set[tuple[str, int]] = set()
    for subject, key_version, _session in sorted(subjects, key=lambda t: (t[0] or "", t[1] or 0)):
        key = (subject, key_version)
        if key in seen:
            continue
        seen.add(key)
        exists = (
            db.query(ResearchWithdrawalRequest.id)
            .filter_by(research_subject_id=subject, key_version=key_version)
            .first()
        )
        if exists is None:  # 같은 주체의 철회 요청은 중복 생성하지 않는다
            db.add(
                ResearchWithdrawalRequest(
                    research_subject_id=subject,
                    key_version=key_version,
                    requested_by=user_id,
                    reason=WITHDRAW_REASON,
                    affected_count=sum(1 for r in rows if r.research_subject_id == subject and r.key_version == key_version),
                )
            )
    # 앞으로 만들어지는 회차 사본이 연구 동의를 물려받지 않도록 클래스 기본값도 끈다.
    db.query(ClassMember).filter(ClassMember.user_id == user_id, ClassMember.research_consented.is_(True)).update(
        {"research_consented": False}, synchronize_session=False
    )
    return len(rows)


def set_optional(db: DBSession, user_id: uuid.UUID, *, eeg: bool | None = None, research: bool | None = None) -> dict:
    """선택 동의 변경. 한 트랜잭션으로 커밋하고, 실패하면 예외를 그대로 올려 성공으로 표시되지 않게 한다."""
    now = datetime.now(timezone.utc)
    if eeg is not None:
        _upsert_optional(db, user_id, "eeg", eeg, now)
        recording_consent_service.sync_account_eeg_choice(db, user_id, eeg, now=now)
    if research is not None:
        _upsert_optional(db, user_id, "research", research, now)
        if not research:
            _withdraw_research(db, user_id, now)
    db.commit()
    return get_state(db, user_id)
