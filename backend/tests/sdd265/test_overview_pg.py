"""SDD-265 T9 — PostgreSQL 실DB 검증 (PG_SMOKE=1, 로컬 DB 한정).

(V-R17) 도착 바이트 == 독립 SUM, (V-R03) cursor 순회 == 한 번에 전체, (V-R11) needs_attention_only,
(V-R42) 쿼리 수 상수, (V-R43) 동시 20요청, (V-R47) 50회차 p95, (V-R38/39) 회원 목록.
실행: PG_SMOKE=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55265/mb265 pytest tests/sdd265/test_overview_pg.py
"""

from __future__ import annotations

import os
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

NOW = datetime(2026, 11, 4, 5, 10, 0, tzinfo=timezone.utc)
N_SESS, N_PART, N_RAW, N_FEAT = 60, 40, 12, 90


@pytest.fixture(scope="module")
def engine():
    url = os.environ.get("DATABASE_URL", "")
    assert make_url(url).host in {"127.0.0.1", "localhost"}, "로컬 DB 에만 연결한다"
    eng = sa.create_engine(url, pool_size=30, max_overflow=10)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def world(engine):
    from app.models.biosignal import BiosignalArtifact
    from app.models.class_program import Class, ClassInstructor
    from app.models.eeg_feature import EEGFeatureWindow
    from app.models.organization import Organization
    from app.models.record import EEGRawChunk
    from app.models.session import Session, SessionParticipant
    from app.models.user import User
    from app.models.user_org_membership import UserOrgMembership

    db = sessionmaker(bind=engine)()
    org = Organization(id=uuid.uuid4(), name="합성기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org)
    db.flush()

    def mk(name, role):
        return User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name=name, role=role,
                    status="active", password_hash="x")

    host, me = mk("합성 코치", "counselor"), mk("합성 회원", "client")
    db.add_all([host, me])
    db.flush()
    db.add(UserOrgMembership(id=uuid.uuid4(), user_id=host.id, org_id=org.id, role="counselor", status="active"))
    cls = Class(id=uuid.uuid4(), organization_id=org.id, created_by=host.id, title="합성 클래스", status="active",
                default_duration_min=60, organization_attribution_known=True)
    db.add(cls)
    db.flush()
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=cls.id, user_id=host.id, role="lead"))

    sessions = []
    for si in range(N_SESS):
        status = "in_progress" if si == 0 else "completed"
        started = NOW - timedelta(hours=1) if si == 0 else NOW - timedelta(days=si % 25, hours=2 + si % 5, minutes=si)
        s = Session(id=uuid.uuid4(), type="meditation", status=status, host_id=host.id, class_id=cls.id, seq=si + 1,
                    host_state="assigned", organization_id=org.id, organization_attribution_known=True,
                    duration_min=60, started_at=started,
                    ended_at=None if si == 0 else started + timedelta(minutes=50 + si % 7))
        db.add(s)
        sessions.append(s)
    db.flush()

    parts_by, feats, raws, arts = {}, [], [], []
    for si, s in enumerate(sessions):
        plist = []
        for i in range(N_PART):
            p = SessionParticipant(id=uuid.uuid4(), session_id=s.id, user_id=me.id if i == 0 else None,
                                   guest_name=None if i == 0 else f"게스트{i:02d}", report_included=True,
                                   eeg_collection_consented=False if i % 9 == 8 else True)
            db.add(p)
            plist.append(p)
        parts_by[s.id] = plist
    db.flush()
    for si, s in enumerate(sessions):
        for i, p in enumerate(parts_by[s.id]):
            if i % 8 == 7:
                continue    # 미도착
            for k in range(N_FEAT):
                feats.append(dict(id=uuid.uuid4(), session_id=s.id, participant_id=p.id, user_id=p.user_id,
                                  play_group_id="pg-a", window_index=k, quality="valid", late=False,
                                  ingest_path="rest", created_at=s.started_at + timedelta(seconds=k)))
            for sig in ("eeg", "ppg", "acc"):
                for k in range(N_RAW):
                    # 일부 참여자·회차에 실패 → 확인 필요
                    st = "failed" if (si % 5 == 2 and i == 3 and sig == "eeg" and k == 4) else (
                        "pending" if (i % 11 == 5 and k >= N_RAW - 2) else "uploaded")
                    raws.append(dict(id=uuid.uuid4(), session_id=s.id, participant_id=p.id, user_id=p.user_id,
                                     stream_id="s1", segment_id="seg1", signal_type=sig, chunk_index=k,
                                     sample_rate=250, object_key=f"synth/{uuid.uuid4().hex}", upload_status=st,
                                     size_bytes=None if (k == 0 and i % 6 == 0) else 1000 + 10 * k + (i % 5),
                                     created_at=s.started_at + timedelta(seconds=10 * k),
                                     uploaded_at=s.started_at + timedelta(seconds=10 * k + 2) if st == "uploaded" else None))
            arts.append(dict(id=uuid.uuid4(), session_id=s.id, participant_id=p.id, artifact_alias=f"a-{uuid.uuid4().hex[:10]}",
                             artifact_kind="feature", sequence=0, row_count=N_FEAT, schema_version="v1",
                             checksum="0" * 64, size_bytes=5000 + i, retention_class="feature",
                             object_key=f"o/{uuid.uuid4().hex}", upload_status="uploaded", content_encoding="identity"))
    db.commit()
    for lo in range(0, len(feats), 5000):
        db.execute(sa.insert(EEGFeatureWindow), feats[lo:lo + 5000])
    for lo in range(0, len(raws), 5000):
        db.execute(sa.insert(EEGRawChunk), raws[lo:lo + 5000])
    db.execute(sa.insert(BiosignalArtifact), arts)
    db.commit()
    db.execute(sa.text("ANALYZE"))
    db.commit()
    w = dict(org=org, cls=cls, sessions=sessions, host=host, me=me, db=db, parts_by=parts_by)
    yield w
    if os.environ.get("PG_KEEP") == "1":
        db.close()
        return
    db.rollback()
    ids = [s.id for s in sessions]
    for model in (BiosignalArtifact, EEGRawChunk, EEGFeatureWindow, SessionParticipant):
        db.execute(sa.delete(model).where(model.session_id.in_(ids)))
    db.execute(sa.delete(Session).where(Session.id.in_(ids)))
    db.execute(sa.delete(ClassInstructor).where(ClassInstructor.class_id == cls.id))
    db.execute(sa.delete(Class).where(Class.id == cls.id))
    db.commit()
    db.close()


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    from app.services import upload_status_overview_service as svc

    svc.clear_cache()
    monkeypatch.setattr(svc, "_utcnow", lambda: NOW)
    yield
    svc.clear_cache()


def actor(w):
    return {"id": str(w["host"].id), "role": "counselor"}


def load(engine, w, **kw):
    from app.services import upload_status_overview_service as svc

    db = sessionmaker(bind=engine)()
    try:
        return svc.load_overview(db, actor(w), **kw).body
    finally:
        db.close()


def independent(db, session_ids):
    """서비스 코드를 거치지 않는 독립 SQL."""
    rows = db.execute(sa.text("""
        select s.id,
          coalesce((select sum(size_bytes) from eeg_raw_chunks r where r.session_id = s.id and r.upload_status = 'uploaded'), 0)
        + coalesce((select sum(size_bytes) from biosignal_artifacts a where a.session_id = s.id and a.upload_status = 'uploaded'), 0) as bytes,
          (select count(*) from eeg_feature_windows f where f.session_id = s.id) as windows,
          (select count(distinct x.pid) from (
              select participant_id as pid from eeg_feature_windows where session_id = s.id
              union select participant_id from eeg_raw_chunks where session_id = s.id and upload_status = 'uploaded') x
           ) as arrived,
          -- 계약 D8: 수집 제외 = 동의 거부/대기열이면서 서버에 도착한 기록이 하나도 없는 참여자
          (select count(*) from session_participants p
            where p.session_id = s.id and p.removed_at is null and p.waitlist_cancelled_at is null
              and p.superseded_by_participant_id is null
              and (p.eeg_collection_consented is false or p.is_waitlisted)
              and not exists (select 1 from eeg_feature_windows f where f.participant_id = p.id)
              and not exists (select 1 from eeg_raw_chunks r where r.participant_id = p.id)) as excluded
        from sessions s where s.id = any(:ids)"""), {"ids": list(session_ids)}).all()
    return {r.id: r for r in rows}


def test_V_R17_도착_바이트_분_도착_인원이_독립_SQL과_일치(engine, world):
    body = load(engine, world, limit=50)
    assert len(body["items"] if isinstance(body, dict) else body.items) == 50
    ref = independent(world["db"], [s.id for s in world["sessions"]])
    for it in body.items:
        r = ref[uuid.UUID(it.session_id)]
        assert it.bytes_arrived == int(r.bytes), it.session_id
        assert it.participant_minutes_total == int(r.windows) // 60
        assert it.participants_arrived == int(r.arrived)
        assert it.participants_expected == N_PART - int(r.excluded)


def test_V_R03_cursor_순회는_한_번에_전체와_같다(engine, world):
    full = [it.session_id for it in load(engine, world, limit=50).items]
    seen, cursor = [], None
    for _ in range(10):
        body = load(engine, world, limit=10, **({"cursor": cursor} if cursor else {}))
        seen += [it.session_id for it in body.items]
        cursor = body.next_cursor
        if cursor is None:
            break
    assert seen[:50] == full and len(set(seen)) == len(seen) == N_SESS


def test_V_R11_확인할_곳_우선_필터는_독립_계산과_같다(engine, world):
    expected = {str(s.id) for si, s in enumerate(world["sessions"]) if si % 5 == 2}   # 실패 청크를 넣은 회차
    found, cursor = set(), None
    for _ in range(10):
        body = load(engine, world, limit=10, needs_attention_only=True, **({"cursor": cursor} if cursor else {}))
        found |= {it.session_id for it in body.items}
        assert all(it.status == "needs_attention" for it in body.items)
        cursor = body.next_cursor
        if cursor is None:
            break
    assert expected <= found
    # 확인 필요가 아닌 회차에 실패 청크가 없는 것도 독립 확인
    # 확인 필요 = 실패 청크 있음 또는 60초 넘게 대기 중인 청크 있음(내부 결측은 합성 데이터에 없음)
    failed = {str(r[0]) for r in world["db"].execute(sa.text(
        "select distinct session_id from eeg_raw_chunks where session_id = any(:ids) and ("
        " upload_status = 'failed' or (upload_status not in ('uploaded','failed') and created_at <= :cut))"),
        {"ids": [s.id for s in world["sessions"]], "cut": NOW - timedelta(seconds=60)})}
    assert found == failed


def test_V_R42_쿼리_수는_상수(engine, world):
    from app.services import upload_status_overview_service as svc

    def count(limit):
        svc.clear_cache()
        n = {"n": 0}
        hook = lambda *a, **k: n.__setitem__("n", n["n"] + 1)  # noqa: E731
        event.listen(engine, "before_cursor_execute", hook)
        try:
            load(engine, world, limit=limit)
        finally:
            event.remove(engine, "before_cursor_execute", hook)
        return n["n"]

    a, b = count(10), count(50)
    assert a == b <= 6, (a, b)


def test_V_R43_동시_20요청_오류없음_값_일치(engine, world):
    from app.services import upload_status_overview_service as svc

    ref = {it.session_id: it.bytes_arrived for it in load(engine, world, limit=50).items}
    svc.clear_cache()

    def one(_):
        body = load(engine, world, limit=50)
        return {it.session_id: it.bytes_arrived for it in body.items}

    with ThreadPoolExecutor(max_workers=20) as ex:
        outs = list(ex.map(one, range(20)))
    assert all(o == ref for o in outs)


def test_V_R47_50회차_p95(engine, world):
    from app.services import upload_status_overview_service as svc

    times = []
    for _ in range(12):
        svc.clear_cache()
        t = time.perf_counter()
        load(engine, world, limit=50)
        times.append(time.perf_counter() - t)
    times.sort()
    p95 = times[int(len(times) * 0.95) - 1]
    print(f"\n[PG] 50회차×{N_PART}명 목록 p95={p95:.3f}s max={times[-1]:.3f}s")
    assert p95 < 1.5


def test_V_R38_V_R39_회원_목록_본인_바이트와_독립_SQL(engine, world):
    from app.services import upload_member_service as ms

    db = sessionmaker(bind=engine)()
    try:
        body = ms.load_member_sessions(db, {"id": str(world["me"].id), "role": "client"}, limit=10).body
        assert len(body.items) == 10 and body.has_more and body.total_candidates == N_SESS
        me_part = {sid: ps[0].id for sid, ps in world["parts_by"].items()}
        for it in body.items:
            pid = me_part[uuid.UUID(it.session_id)]
            ref = db.execute(sa.text(
                "select coalesce((select sum(size_bytes) from eeg_raw_chunks where participant_id=:p and upload_status='uploaded'),0)"
                " + coalesce((select sum(size_bytes) from biosignal_artifacts where participant_id=:p and upload_status='uploaded'),0)"),
                {"p": pid}).scalar()
            assert it.bytes_arrived == int(ref)
            feat = db.execute(sa.text("select count(*) from eeg_feature_windows where participant_id=:p"), {"p": pid}).scalar()
            assert it.measured_min == int(feat) // 60
    finally:
        db.close()
