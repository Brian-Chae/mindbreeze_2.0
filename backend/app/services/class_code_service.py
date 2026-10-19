"""클래스 입장 코드 — 로그인 없는 공통 4자리 숫자 코드 (SDD-209 B4 / BE-4 · P5).

- 형식: ``[0-9]{4}`` **문자열**(선행 0 보존 — 정수 변환 금지). 10,000 공간.
- 유일성: **활성(입장 가능) 클래스 사이에서만** 중복 없음(DB 부분 유니크 인덱스
  ``uq_sessions_active_access_code``). 종료·취소·숨김 클래스의 값은 보존되지만 재사용될 수 있다.
- 무효화: 종료·취소(·숨김) 클래스는 조회되지 않는다 → 코드는 값만 남고 입장에 쓰이지 않는다.
- 공개 응답 동일화: 없는/틀린/형식 오류/종료/취소/숨김/템플릿 코드는 모두 ``None`` 이다.
  호출측은 반드시 같은 형태의 404 로 응답한다(정보 비노출).
- 코드는 상시 인증 토큰이 아니다 — 입장 시도 제한은 class_code_attempt_service 참고.
"""

from __future__ import annotations

import re
import secrets

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session as DBSession

from app.models.class_program import Class

from app.models.session import Session

CLASS_CODE_LENGTH = 4
CLASS_CODE_SPACE = 10 ** CLASS_CODE_LENGTH
# 입장 불가(종료) 상태 — 이 상태의 코드는 무효다.
CLOSED_STATUSES = ("completed", "cancelled")

_CODE_RE = re.compile(r"[0-9]{4}")  # ASCII 숫자만(유니코드 숫자·공백 거부)


class ClassCodeExhausted(RuntimeError):
    """활성 클래스가 코드 공간(10,000)을 모두 점유해 발급할 수 없다."""


def is_valid_class_code(code: str | None) -> bool:
    return isinstance(code, str) and _CODE_RE.fullmatch(code) is not None


def normalize_class_code(code: str | None) -> str | None:
    """입력 코드를 비교용으로 정리한다. 앞뒤 공백만 제거하고 형식이 틀리면 ``None``.

    선행 0 은 그대로 유지한다(``"0042"`` 는 ``"0042"``). 정수 변환을 하지 않는다.
    """
    if code is None:
        return None
    stripped = code.strip()
    return stripped if is_valid_class_code(stripped) else None


def _active_codes(db: DBSession) -> set[str]:
    rows = (
        db.query(Session.access_code)
        .filter(
            Session.access_code.is_not(None),
            Session.is_template.is_(False),
            Session.status.notin_(CLOSED_STATUSES),
        )
        .all()
    )
    parents = db.query(Class.access_code).filter(Class.access_code.is_not(None),
        Class.status.notin_(("completed", "cancelled", "archived"))).all()
    return {c for (c,) in [*rows, *parents] if is_valid_class_code(c)}


def generate_class_code(db: DBSession) -> str:
    """활성 클래스와 겹치지 않는 4자리 코드를 균등 확률로 발급한다.

    공간 소진 시 ``ClassCodeExhausted``. 동시 발급 경합은 부분 유니크 인덱스가 최종 방어하며,
    호출측(create_session)이 IntegrityError 시 재발급한다.
    """
    # Class와 Session의 두 인덱스 사이 경합도 같은 트랜잭션 잠금으로 직렬화한다.
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(2160042)"))
    used = _active_codes(db)
    if len(used) >= CLASS_CODE_SPACE:
        raise ClassCodeExhausted("사용 가능한 클래스 코드가 없습니다")
    # 점유율이 낮을 때는 무작위 시도가 빠르고, 높을 때는 남은 목록에서 고른다(균등 유지).
    if len(used) < CLASS_CODE_SPACE // 2:
        while True:
            candidate = f"{secrets.randbelow(CLASS_CODE_SPACE):0{CLASS_CODE_LENGTH}d}"
            if candidate not in used:
                return candidate
    free = [f"{n:0{CLASS_CODE_LENGTH}d}" for n in range(CLASS_CODE_SPACE)]
    free = [c for c in free if c not in used]
    return secrets.choice(free)


def exhausted_http_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="지금은 새 클래스 코드를 만들 수 없어요. 잠시 후 다시 시도해 주세요.",
    )


def find_enterable_session(db: DBSession, code: str | None) -> Session | None:
    """입장 가능한 활성 클래스를 코드로 찾는다. 어떤 이유로든 없으면 ``None``(사유 비구분)."""
    normalized = normalize_class_code(code)
    if normalized is None:
        return None
    parent = db.query(Class).filter(Class.access_code==normalized, Class.status=="active").first()
    if parent is not None and parent.recurrence_rule:
        sessions = db.query(Session).filter(Session.class_id==parent.id,
            Session.status.in_(("open","in_progress")), Session.is_template.is_(False)).all()
        return sessions[0] if len(sessions)==1 else None
    return (
        db.query(Session)
        .filter(
            Session.access_code == normalized,
            Session.is_template.is_(False),
            Session.status.notin_(CLOSED_STATUSES),
        )
        .first()
    )


def resolve_class_code(db, code):
    """코드만으로 공개 일정 메타를 해석하며 회원·본문은 반환하지 않는다."""
    normalized=normalize_class_code(code)
    cls=db.query(Class).filter(Class.access_code==normalized,Class.status=="active").first() if normalized else None
    if cls is None:
        raise HTTPException(404, detail="클래스를 찾을 수 없습니다")
    rows=db.query(Session).filter(Session.class_id==cls.id,Session.status.in_(("open","in_progress")),
        Session.is_template.is_(False)).order_by(Session.scheduled_at,Session.seq).all()
    next_row=db.query(Session).filter(Session.class_id==cls.id,Session.status.in_(("ready","scheduled")),
        Session.is_template.is_(False)).order_by(Session.scheduled_at,Session.seq).first()
    def metadata(row):
        return {"session_id":str(row.id),"seq":row.seq,"scheduled_at":row.scheduled_at,"status":row.status}
    return {"class_id":str(cls.id),"revision":cls.revision,"title":cls.title,"sessions":[metadata(r) for r in rows],
            "next_session":metadata(next_row) if next_row else None}


def join_class_code(db, class_id, user_id, code, now=None):
    from datetime import datetime, timezone
    from uuid import UUID
    from app.models.user import User
    from app.models.class_program import ClassMember
    from app.services.class_membership_service import invite_members, rejoin_member, _sessions_locked, _activate_future
    now=now or datetime.now(timezone.utc)
    try:
        actor=db.query(User).filter(User.id==UUID(str(user_id))).with_for_update(key_share=True).first()
        if actor is None or actor.status!="active" or actor.role!="client":
            raise HTTPException(403,detail={"code":"member_only"})
        cls=db.query(Class).filter(Class.id==UUID(str(class_id))).populate_existing().with_for_update().first()
        normalized=normalize_class_code(code)
        if not cls or cls.status!="active" or not normalized or cls.access_code!=normalized:
            raise HTTPException(404,detail="클래스를 찾을 수 없습니다")
        members = db.query(ClassMember).filter(ClassMember.class_id == cls.id).order_by(ClassMember.id).populate_existing().with_for_update().all()
        existing = next((m for m in members if m.user_id == actor.id), None)
        changed = existing is None or existing.status != "active"
        if existing and existing.status == "left":
            member = rejoin_member(db, cls, existing, actor.id, now)
        else:
            if (existing is None or existing.status != "active") and any(m.status == "waitlisted" and m.canonical_member_id is None for m in members):
                raise HTTPException(409, detail={"code": "waitlist_precedes"})
            sessions = _sessions_locked(db, cls) if changed else []
            member=invite_members(db,cls,[actor.id],actor.id,now,via="code")[0]
            if changed:
                _activate_future(db, cls, member, sessions, now)
        if changed:
            cls.revision += 1
        result={"class_id":str(cls.id),"member_id":str(member.id),"status":member.status}
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def display_code(db, session):
    if session.class_id and db is not None:
        parent=db.query(Class).filter(Class.id==session.class_id).first()
        if parent and parent.status=="active":
            return parent.access_code
        return None
    return session.access_code
