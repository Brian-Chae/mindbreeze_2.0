"""SDD-264 B7 — PostgreSQL 실DB 검증 (PG_SMOKE=1, 로컬 DB 한정).

(V-X19) 동일 보고 동시 20회 → 행 1개·5xx 0건, (V-X20) 서로 다른 값 동시 보고 → 필드별 최댓값,
(V-X1) 합성 40명 데이터 PG 집계 == 독립 파이썬 계산, (V-X50) 상세·목록 쿼리 수.
실행: PG_SMOKE=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55264/mb264 pytest tests/sdd264/test_expected_pg.py
"""

from __future__ import annotations

import os
import random
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.skipif(os.environ.get("PG_SMOKE") != "1", reason="PG_SMOKE=1 일 때만 실행")

N_PART = 40
FEATURES = 300      # 참여자당 feature 행(합성)
RAW_EEG = 60


@pytest.fixture(scope="module")
def engine():
    url = os.environ.get("DATABASE_URL", "")
    assert make_url(url).host in {"127.0.0.1", "localhost"}, "로컬 DB 에만 연결한다"
    eng = sa.create_engine(url, pool_size=30, max_overflow=10)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def world(engine):
    from app.models.class_program import Class, ClassInstructor
    from app.models.eeg_feature import EEGFeatureWindow
    from app.models.organization import Organization
    from app.models.record import EEGRawChunk
    from app.models.session import Session, SessionParticipant
    from app.models.session_ingest_expected import SessionIngestExpected
    from app.models.user import User
    from app.models.user_org_membership import UserOrgMembership

    rnd = random.Random(264)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    db = sessionmaker(bind=engine)()
    org = Organization(id=uuid.uuid4(), name="합성기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org)
    db.flush()
    host = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="합성 코치", role="counselor",
                status="active", password_hash="x")
    db.add(host)
    db.flush()
    db.add(UserOrgMembership(id=uuid.uuid4(), user_id=host.id, org_id=org.id, role="counselor", status="active"))
    cls = Class(id=uuid.uuid4(), organization_id=org.id, created_by=host.id, title="합성 클래스", status="active",
                default_duration_min=60, organization_attribution_known=True)
    db.add(cls)
    db.flush()
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=cls.id, user_id=host.id, role="lead"))
    sess = Session(id=uuid.uuid4(), type="meditation", status="in_progress", host_id=host.id, class_id=cls.id, seq=1,
                   host_state="assigned", organization_id=org.id, organization_attribution_known=True,
                   duration_min=60, started_at=now - timedelta(minutes=30))
    db.add(sess)
    db.flush()

    users, parts, expect = [], [], {}
    for i in range(N_PART):
        u = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name=f"회원{i}", role="client",
                 status="active", password_hash="x")
        db.add(u)
        db.flush()
        p = SessionParticipant(id=uuid.uuid4(), session_id=sess.id, user_id=u.id, report_included=True,
                               eeg_collection_consented=True)
        db.add(p)
        db.flush()
        users.append(u)
        parts.append(p)
        got_f, got_r = rnd.randint(FEATURES - 40, FEATURES), rnd.randint(RAW_EEG - 10, RAW_EEG)
        for k in range(got_f):
            db.add(EEGFeatureWindow(id=uuid.uuid4(), session_id=sess.id, participant_id=p.id, user_id=u.id,
                                    play_group_id="pg", window_index=k, quality="valid",
                                    created_at=now - timedelta(seconds=5)))
        for k in range(got_r):
            db.add(EEGRawChunk(id=uuid.uuid4(), session_id=sess.id, participant_id=p.id, user_id=u.id, stream_id="s",
                               segment_id="g", signal_type="eeg", chunk_index=k, object_key=f"k/{uuid.uuid4().hex}",
                               upload_status="uploaded", created_at=now - timedelta(seconds=30),
                               uploaded_at=now - timedelta(seconds=10)))
        if i % 10 != 9:      # 4명은 미보고
            db.add(SessionIngestExpected(participant_id=p.id, session_id=sess.id, feature=FEATURES,
                                         raw_eeg=RAW_EEG, raw_ppg=0, raw_acc=0, final=True,
                                         first_reported_at=now - timedelta(seconds=60),
                                         reported_at=now - timedelta(seconds=8), updated_at=now - timedelta(seconds=8)))
            expect[str(p.id)] = (got_f, got_r)
    db.commit()
    w = {"org": org, "host": host, "cls": cls, "session": sess, "users": users, "parts": parts, "expect": expect}
    yield w
    db.rollback()
    db.execute(sa.text("delete from sessions where id = :s"), {"s": sess.id})
    db.execute(sa.text("delete from class_instructors where class_id = :c"), {"c": cls.id})
    db.execute(sa.text("delete from classes where id = :c"), {"c": cls.id})
    db.execute(sa.text("delete from user_org_memberships where org_id = :o"), {"o": org.id})
    db.execute(sa.text("delete from users where id = any(:ids)"), {"ids": [u.id for u in users] + [host.id]})
    db.execute(sa.text("delete from organizations where id = :o"), {"o": org.id})
    db.commit()
    db.close()


def test_V_X1_PG_집계가_독립_계산과_일치하고_쿼리_수_고정(engine, world):
    from app.services import upload_status_service as svc

    svc.clear_cache()
    db = sessionmaker(bind=engine)()
    actor = {"id": str(world["host"].id), "role": "counselor"}
    cls_id, sess_id = world["cls"].id, world["session"].id     # 만료 객체 refresh 쿼리가 카운트에 끼지 않게 먼저 읽는다
    n = {"q": 0}
    seen: list[str] = []

    def hook(conn, cur, stmt, *a):
        n["q"] += 1
        seen.append(" ".join(stmt.split())[:90])

    event.listen(engine, "before_cursor_execute", hook)
    t0 = time.perf_counter()
    try:
        res = svc.load_upload_status(db, actor, cls_id, sess_id)
    finally:
        event.remove(engine, "before_cursor_execute", hook)
    dt = time.perf_counter() - t0
    body = res.body
    assert body is not None
    exp_f = sum(FEATURES for _ in world["expect"])
    rec_f = sum(min(g, FEATURES) for g, _ in world["expect"].values())
    exp_r = RAW_EEG * len(world["expect"])
    rec_r = sum(min(r, RAW_EEG) for _, r in world["expect"].values())
    assert body.progress.feature.expected == exp_f and body.progress.feature.received == rec_f
    assert body.progress.raw.eeg.expected == exp_r and body.progress.raw.eeg.received == rec_r
    assert body.progress.participants.expected_unknown == 4
    assert body.progress.participants.total == N_PART
    # 독립 SQL COUNT 대조
    with engine.connect() as c:
        sql_f = c.execute(sa.text("select count(*) from eeg_feature_windows where session_id = :s"),
                          {"s": world["session"].id}).scalar()
        sql_r = c.execute(sa.text("select count(*) from eeg_raw_chunks where session_id = :s and "
                                  "upload_status = 'uploaded' and signal_type = 'eeg'"),
                          {"s": world["session"].id}).scalar()
    assert sum(p.feature.received for p in body.participants) == sql_f
    assert sum(next(s.uploaded for s in p.raw.signals if s.signal_type == "eeg") for p in body.participants) == sql_r
    print(f"\n[PG] detail queries={n['q']} elapsed={dt:.3f}s feature={rec_f}/{exp_f} eeg={rec_r}/{exp_r}")
    print("\n".join(" -" + q for q in seen))
    assert n["q"] <= 6          # 권한 1 + revision 1 + 본문 4(참여자·feature·raw·기대량)
    db.close()


def test_V_X50_목록_쿼리_수(engine, world):
    from app.services import upload_status_overview_service as ov

    ov.clear_cache()
    db = sessionmaker(bind=engine)()
    actor = {"id": str(world["host"].id), "role": "counselor"}
    n = {"q": 0}
    hook = lambda *a, **k: n.__setitem__("q", n["q"] + 1)  # noqa: E731
    event.listen(engine, "before_cursor_execute", hook)
    try:
        res = ov.load_overview(db, actor)
    finally:
        event.remove(engine, "before_cursor_execute", hook)
    assert res.body is not None and res.body.items[0].progress.participants.total == N_PART
    print(f"\n[PG] overview queries={n['q']}")
    assert n["q"] <= 5
    db.close()


def _report(engine, session_id, participant_id, body):
    from app.services import ingest_expected_service as ies

    db = sessionmaker(bind=engine)()
    try:
        return ies.report_expected(db, session_id, participant_id, ies.parse_report(body))
    finally:
        db.close()


def test_V_X19_동일_보고_동시_20회는_행_1개(engine, world):
    p = world["parts"][N_PART - 1]          # 미보고 참여자
    body = {"feature": 111, "raw": {"eeg": 22, "ppg": 3, "acc": 4}, "final": False}
    with ThreadPoolExecutor(20) as ex:
        results = list(ex.map(lambda _: _report(engine, world["session"].id, p.id, body), range(20)))
    assert all(r.expected.feature == 111 for r in results)
    assert sum(1 for r in results if r.changed) == 1
    with engine.connect() as c:
        n = c.execute(sa.text("select count(*) from session_ingest_expected where participant_id = :p"),
                      {"p": p.id}).scalar()
    assert n == 1


def test_V_X20_서로_다른_값_동시_보고는_필드별_최댓값(engine, world):
    p = world["parts"][N_PART - 11]         # 미보고 아님(i%10==9 → idx 9,19,29,39) 이 아닌 idx 29 → 미보고
    values = [(10 + i, 100 - i) for i in range(20)]       # feature 증가, eeg 감소
    bodies = [{"feature": f, "raw": {"eeg": e, "ppg": 0, "acc": 0}, "final": False} for f, e in values]
    with ThreadPoolExecutor(20) as ex:
        list(ex.map(lambda b: _report(engine, world["session"].id, p.id, b), bodies))
    with engine.connect() as c:
        row = c.execute(sa.text("select feature, raw_eeg from session_ingest_expected where participant_id = :p"),
                        {"p": p.id}).one()
    assert row.feature == max(f for f, _ in values) and row.raw_eeg == max(e for _, e in values)
