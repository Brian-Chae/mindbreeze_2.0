"""SDD-237 테스트 공용 헬퍼 — 명상 클래스 회차·참여자·EEG 윈도우를 만든다."""

import uuid
from datetime import datetime, timedelta, timezone

from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.organization import Organization
from app.models.record import Report, SessionRecord
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership

START = datetime(2026, 10, 23, 9, 0, 0, tzinfo=timezone.utc)


def make_user(db, *, role="counselor", name="사용자", org=None, **extra) -> User:
    user = User(
        id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name=name,
        role=role, status="active", password_hash="x", **extra,
    )
    db.add(user)
    db.flush()
    if org is not None:
        db.add(UserOrgMembership(
            id=uuid.uuid4(), user_id=user.id, org_id=org.id,
            role="org_admin" if role == "org_admin" else role, status="active"))
        db.flush()
    return user


def auth_for(user) -> dict:
    from app.core.security import create_access_token

    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


def build_class_world(db, *, members=3, status="completed", duration_min=45, ended=True,
                      host_extra=None) -> dict:
    """기관·클래스·호스트(lead)·완료 회차·회원 참여자·상담사용 리포트 + 회원 리포트를 만든다."""
    org = Organization(id=uuid.uuid4(), name="기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org)
    db.flush()
    host = make_user(db, name="채 상담사", org=org, **(host_extra or {}))
    cls = Class(
        id=uuid.uuid4(), organization_id=org.id, created_by=host.id, title="아침 호흡 명상",
        status="active", default_duration_min=duration_min, recurrence_rule="FREQ=WEEKLY")
    db.add(cls)
    db.flush()
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=cls.id, user_id=host.id, role="lead"))
    session = Session(
        id=uuid.uuid4(), type="meditation", status=status, host_id=host.id, class_id=cls.id,
        seq=3, duration_min=duration_min, started_at=START,
        ended_at=(START + timedelta(minutes=duration_min)) if ended else None)
    db.add(session)
    db.flush()

    parts, client_reports = [], []
    for i in range(members):
        u = make_user(db, role="client", name=f"회원{i + 1}")
        m = ClassMember(id=uuid.uuid4(), class_id=cls.id, user_id=u.id, kind="member",
                        status="active", joined_via="invite")
        db.add(m)
        db.flush()
        p = SessionParticipant(
            id=uuid.uuid4(), session_id=session.id, user_id=u.id, member_id=m.id,
            attendance_status="attended", report_included=True,
            joined_at=START + timedelta(seconds=i))
        db.add(p)
        db.flush()
        r = Report(id=uuid.uuid4(), session_id=session.id, participant_id=p.id, user_id=u.id,
                   type="client", status="pending_review", generation_status="ready",
                   content={"eeg": {"status": "valid"}})
        db.add(r)
        db.flush()
        parts.append(p)
        client_reports.append(r)
    counselor_report = Report(
        id=uuid.uuid4(), session_id=session.id, participant_id=parts[0].id if parts else None,
        user_id=host.id, type="counselor", status="pending_review", generation_status="ready",
        content={})
    db.add(counselor_report)
    db.commit()
    return {"org": org, "host": host, "cls": cls, "session": session, "participants": parts,
            "client_reports": client_reports, "counselor_report": counselor_report,
            "auth": auth_for(host)}


def add_record(db, session, notes: str | None) -> SessionRecord:
    rec = SessionRecord(id=uuid.uuid4(), session_id=session.id, counselor_notes=notes)
    db.add(rec)
    db.commit()
    return rec


def start_ms(session) -> int:
    """SQLite 는 tz 없는 datetime 을 돌려주므로 UTC 로 간주해 epoch(ms) 를 만든다(서비스와 같은 규칙)."""
    started = session.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return int(started.timestamp() * 1000)


def add_windows(db, session, participant, n, *, start_offset=0, quality="valid", seg=None,
                focus=2.0, relax=1.0, emo=0.5, hr=70.0, rr=14.0, sdnn=40.0, ms=None):
    """participant 에게 1초 간격 윈도우 n개를 넣는다. device_timestamp_ms = 수업 시작 + 오프셋."""
    from app.models.eeg_feature import EEGFeatureWindow

    base_ms = start_ms(session)
    for i in range(n):
        idx = start_offset + i
        db.add(EEGFeatureWindow(
            id=uuid.uuid4(), session_id=session.id, participant_id=participant.id,
            user_id=participant.user_id, play_group_id=seg, window_index=idx, quality=quality,
            device_timestamp_ms=(base_ms + idx * 1000) if ms is None else ms + i * 1000,
            focus_index=focus(i) if callable(focus) else focus,
            relaxation_index=relax, emotional_stability=emo,
            heart_rate=hr, respiratory_rate=rr, sdnn=sdnn))
    db.commit()
