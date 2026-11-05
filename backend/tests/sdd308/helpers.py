"""SDD-308 합성 데이터 — 기관·상담사(lead)·반복 클래스·회원 N명(ClassMember+SessionParticipant). 실데이터 없음."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import event


@dataclass
class Scene:
    org_id: uuid.UUID
    host_id: uuid.UUID
    class_id: uuid.UUID
    session_id: uuid.UUID
    members: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)  # (user_id, participant_id)


def build_scene(maker, n: int = 10, *, status: str = "in_progress", enrolled: bool = True, max_participants: int | None = None) -> Scene:
    from app.models.class_program import Class, ClassInstructor, ClassMember
    from app.models.organization import Organization
    from app.models.session import Session, SessionParticipant
    from app.models.user import User
    from app.models.user_org_membership import UserOrgMembership

    with maker() as s:
        org = Organization(name="합성 센터", verified=True)
        s.add(org)
        s.flush()
        host = User(email=f"h-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", name="상담사", role="counselor",
                    status="active", org_id=org.id)
        s.add(host)
        s.flush()
        s.add(UserOrgMembership(user_id=host.id, org_id=org.id, role="counselor", status="active", is_primary=True))
        cls = Class(created_by=host.id, organization_id=org.id, organization_attribution_known=True, title="합성 명상",
                    default_duration_min=30, status="active", recurrence_rule={"start_now": True})
        s.add(cls)
        s.flush()
        s.add(ClassInstructor(class_id=cls.id, user_id=host.id, role="lead"))
        sess = Session(host_id=host.id, class_id=cls.id, organization_id=org.id, seq=1, host_state="assigned",
                       type="meditation", duration_min=30, status=status, participant_mode="group",
                       max_participants=max_participants or max(n + 5, 20), webrtc_room_id=uuid.uuid4())
        s.add(sess)
        s.flush()
        sc = Scene(org.id, host.id, cls.id, sess.id)
        for i in range(n):
            u = User(email=f"m{i}-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", name=f"회원{i}", role="client", status="active")
            s.add(u)
            s.flush()
            cm = ClassMember(class_id=cls.id, user_id=u.id, kind="member", status="active", joined_via="code")
            s.add(cm)
            s.flush()
            p = SessionParticipant(session_id=sess.id, user_id=u.id, member_id=cm.id, consent_eeg=True,
                                   eeg_collection_consented=True, recording_consented=True) if enrolled else None
            if p is not None:
                s.add(p)
                s.flush()
            sc.members.append((u.id, p.id if p is not None else None))
        s.commit()
        return sc


class QueryCounter:
    """엔진의 SQL 실행 횟수(SAVEPOINT 제외)를 센다."""

    def __init__(self, engine):
        self.engine, self.statements = engine, []

    def __enter__(self):
        event.listen(self.engine, "before_cursor_execute", self._cb)
        return self

    def __exit__(self, *exc):
        event.remove(self.engine, "before_cursor_execute", self._cb)

    def _cb(self, conn, cursor, statement, parameters, context, executemany):
        if not statement.lstrip().upper().startswith(("SAVEPOINT", "RELEASE", "ROLLBACK TO")):
            self.statements.append(statement)

    @property
    def n(self) -> int:
        return len(self.statements)
