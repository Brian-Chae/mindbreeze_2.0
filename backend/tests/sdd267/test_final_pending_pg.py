"""SDD-267 V-P27 — PostgreSQL 실DB: 독립 SQL 대조 (PG_SMOKE=1, 로컬 DB 한정)."""

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.skipif(os.environ.get("PG_SMOKE") != "1", reason="PG_SMOKE=1 일 때만 실행")


def test_V_P27_독립_SQL_대조():
    from app.models.class_program import Class, ClassInstructor
    from app.models.eeg_feature import EEGFeatureWindow
    from app.models.organization import Organization
    from app.models.session import Session, SessionParticipant
    from app.models.session_ingest_expected import SessionIngestExpected
    from app.models.user import User
    from app.models.user_org_membership import UserOrgMembership
    from app.services import upload_status_service as svc

    url = os.environ["DATABASE_URL"]
    assert make_url(url).host in {"127.0.0.1", "localhost"}
    eng = sa.create_engine(url)
    db = sessionmaker(bind=eng)()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    org = Organization(id=uuid.uuid4(), name="합성", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org); db.flush()
    host = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="코치", role="counselor",
                status="active", password_hash="x")
    db.add(host); db.flush()
    db.add(UserOrgMembership(id=uuid.uuid4(), user_id=host.id, org_id=org.id, role="counselor", status="active"))
    cls = Class(id=uuid.uuid4(), organization_id=org.id, created_by=host.id, title="합성", status="active",
                default_duration_min=60, organization_attribution_known=True)
    db.add(cls); db.flush()
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=cls.id, user_id=host.id, role="lead"))
    sess = Session(id=uuid.uuid4(), type="meditation", status="completed", host_id=host.id, class_id=cls.id, seq=1,
                   host_state="assigned", organization_id=org.id, organization_attribution_known=True, duration_min=60,
                   started_at=now - timedelta(minutes=70), ended_at=now - timedelta(minutes=5))
    db.add(sess); db.flush()
    users, ids = [], []
    # (수신, 기대, final, 마지막 수신 경과초) — 기대 20
    cases = [(20, 20, False, 600), (20, 20, False, 60), (19, 20, False, 600), (20, 20, True, 600)]
    for got, want, final, ago in cases:
        u = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="회원", role="client",
                 status="active", password_hash="x")
        db.add(u); db.flush()
        p = SessionParticipant(id=uuid.uuid4(), session_id=sess.id, user_id=u.id, report_included=True,
                               eeg_collection_consented=True)
        db.add(p); db.flush()
        users.append(u); ids.append(p.id)
        for k in range(got):
            db.add(EEGFeatureWindow(id=uuid.uuid4(), session_id=sess.id, participant_id=p.id, user_id=u.id,
                                    play_group_id="pg", window_index=k, quality="valid",
                                    created_at=now - timedelta(seconds=ago)))
        db.add(SessionIngestExpected(participant_id=p.id, session_id=sess.id, feature=want, raw_eeg=0, raw_ppg=0,
                                     raw_acc=0, final=final, first_reported_at=now - timedelta(seconds=900),
                                     reported_at=now - timedelta(seconds=ago), updated_at=now - timedelta(seconds=ago)))
    db.commit()
    try:
        svc.clear_cache()
        body = svc.get_upload_status(db, {"id": str(host.id), "role": "counselor"}, cls.id, sess.id)
        got = {p.participant_id: p.progress.final_pending for p in body.participants}
        # 독립 SQL: 수신 합 ≥ 기대, final=false, 마지막 수신 120초 이상 전, 종료 3분 이상 경과
        rows = db.execute(sa.text("""
            select e.participant_id::text from session_ingest_expected e
            where e.session_id = :s and e.final = false
              and (select count(*) from eeg_feature_windows f where f.participant_id = e.participant_id) >= e.feature
              and (select max(created_at) from eeg_feature_windows f where f.participant_id = e.participant_id)
                  <= now() - interval '120 seconds'
              and (select ended_at from sessions where id = :s) <= now() - interval '180 seconds'
        """), {"s": sess.id}).scalars().all()
        assert {k for k, v in got.items() if v} == set(rows) and len(rows) == 1
        assert body.progress.participants.final_pending == 1
    finally:
        db.rollback()
        db.execute(sa.text("delete from sessions where id = :s"), {"s": sess.id})
        db.execute(sa.text("delete from class_instructors where class_id = :c"), {"c": cls.id})
        db.execute(sa.text("delete from classes where id = :c"), {"c": cls.id})
        db.execute(sa.text("delete from user_org_memberships where org_id = :o"), {"o": org.id})
        db.execute(sa.text("delete from users where id = any(:ids)"), {"ids": [u.id for u in users] + [host.id]})
        db.execute(sa.text("delete from organizations where id = :o"), {"o": org.id})
        db.commit()
        db.close()
        eng.dispose()
