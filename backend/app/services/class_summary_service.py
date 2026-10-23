"""SDD-237 클래스 회차 요약·리포트 조회 서비스.

조회(GET)는 읽기 전용이다 — 승인·메일·알림·AI·재생성을 호출하지 않는다(verify P9).
쓰기는 진행 기록 안내 상태(claim/dismiss)와 서사 문장 수정(class_report_narrative)뿐이다.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session as DBSession

from app.models.record import SessionRecord
from app.models.session import Session
from app.models.user import User

logger = logging.getLogger(__name__)

NOTE_PROMPT_ROLES = ("counselor", "org_admin")


def _api_error(status: int, code: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code})


def _to_uuid(value) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


# ─────────────────────────── 진행 기록 1회 안내 ───────────────────────────

def load_note_prompt_user(db: DBSession, user_id) -> User:
    """안내 설정·claim 은 상담사/기관관리자 본인 계정만 쓴다."""
    user = db.query(User).filter(User.id == _to_uuid(user_id)).first()
    if user is None or user.status != "active":
        raise _api_error(404, "user_not_found")
    if user.role not in NOTE_PROMPT_ROLES:
        raise _api_error(403, "note_prompt_forbidden")
    return user


def get_show_session_note_prompt(db: DBSession, user_id) -> bool:
    return bool(load_note_prompt_user(db, user_id).show_session_note_prompt)


def set_show_session_note_prompt(db: DBSession, user_id, enabled: bool) -> bool:
    user = load_note_prompt_user(db, user_id)
    user.show_session_note_prompt = bool(enabled)
    db.commit()
    return bool(user.show_session_note_prompt)


def _load_class_session(db: DBSession, session_id) -> Session:
    session = db.query(Session).filter(Session.id == _to_uuid(session_id)).first()
    if session is None:
        raise _api_error(404, "session_not_found")
    if session.class_id is None:
        raise _api_error(400, "not_class_session")
    return session


def has_session_note(db: DBSession, session_id) -> bool:
    """진행 기록(비공개 메모)이 이미 있는지. 빈 공백 메모는 기록으로 보지 않는다."""
    note = (
        db.query(SessionRecord.counselor_notes)
        .filter(SessionRecord.session_id == session_id)
        .scalar()
    )
    return isinstance(note, str) and bool(note.strip())


def claim_note_prompt(db: DBSession, session_id, user_id) -> bool:
    """안내를 보여줄지 원자적으로 결정한다. True 는 이 호출이 '처음이자 유일한' 노출권을 얻었다는 뜻.

    UPDATE ... WHERE seen IS NULL AND host_id=:me 의 rowcount 로 판정하므로 다중 탭·기기·동시 요청에서도
    정확히 한 번만 True 다. 기록이 이미 있거나 사용자가 안내를 껐으면 노출권을 소모하지 않고 False 를 돌려준다.
    """
    user = load_note_prompt_user(db, user_id)
    session = _load_class_session(db, session_id)
    if session.host_id != user.id or not user.show_session_note_prompt:
        return False
    if has_session_note(db, session.id):
        return False
    result = db.execute(
        update(Session)
        .where(
            Session.id == session.id,
            Session.host_id == user.id,
            Session.note_prompt_seen_at.is_(None),
        )
        .values(note_prompt_seen_at=datetime.now(timezone.utc))
        .execution_options(synchronize_session=False)
    )
    db.commit()
    return result.rowcount == 1


def dismiss_note_prompt(db: DBSession, session_id, user_id) -> datetime:
    """[비워두기] — 멱등. 이미 있으면 기존 시각을 그대로 돌려준다."""
    user = load_note_prompt_user(db, user_id)
    session = _load_class_session(db, session_id)
    if session.host_id != user.id:
        raise _api_error(403, "note_prompt_forbidden")
    if session.note_prompt_dismissed_at is None:
        now = datetime.now(timezone.utc)
        db.execute(
            update(Session)
            .where(Session.id == session.id, Session.note_prompt_dismissed_at.is_(None))
            .values(note_prompt_dismissed_at=now)
            .execution_options(synchronize_session=False)
        )
        db.commit()
        db.refresh(session)
    return session.note_prompt_dismissed_at
