"""SDD-261 BE-1 — PostgreSQL 실DB 검증(PG_SMOKE=1, 로컬 DB 한정).

40명×1시간 합성 데이터로 (1) PG 집계 == 독립 파이썬 계산, (2) SQL 횟수, (3) 응답 시간, (4) REPEATABLE READ 읽기 전용 경로,
(5) sample-response.json 생성(UPLOAD_STATUS_SAMPLE_OUT 지정 시)을 확인한다.
실행: PG_SMOKE=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55261/mb261 pytest tests/test_upload_status_pg.py
"""

from __future__ import annotations

import json
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.skipif(os.environ.get("PG_SMOKE") != "1", reason="PG_SMOKE=1 일 때만 실행")

NOW = datetime(2026, 11, 4, 5, 10, 0, tzinfo=timezone.utc)
N_PART = 40
N_FEATURE = 3600


@pytest.fixture(scope="module")
def engine():
    url = os.environ.get("DATABASE_URL", "")
    assert make_url(url).host in {"127.0.0.1", "localhost"}, "로컬 DB 에만 연결한다"
    eng = sa.create_engine(url)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def world(engine):
    """합성 데이터를 한 번 만들고 모듈 끝에 지운다. 기대값(독립 계산)도 함께 만든다."""
    from app.models.class_program import Class, ClassInstructor
    from app.models.eeg_feature import EEGFeatureWindow
    from app.models.organization import Organization
    from app.models.record import EEGRawChunk
    from app.models.session import Session, SessionParticipant
    from app.models.user import User
    from app.models.user_org_membership import UserOrgMembership

    rnd = random.Random(261)
    Maker = sessionmaker(bind=engine)
    db = Maker()
    org = Organization(id=uuid.uuid4(), name="합성기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org)
    db.flush()
    host = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="합성 코치", role="counselor",
                status="active", password_hash="x")
    other = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="다른 코치", role="counselor",
                 status="active", password_hash="x")
    admin = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="기관관리자", role="org_admin",
                 status="active", password_hash="x")
    pa = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="플랫폼관리자", role="platform_admin",
              status="active", password_hash="x")
    db.add_all([host, other, admin, pa])
    db.flush()
    for u, role in ((host, "counselor"), (other, "counselor"), (admin, "org_admin")):
        db.add(UserOrgMembership(id=uuid.uuid4(), user_id=u.id, org_id=org.id, role=role, status="active"))
    cls = Class(id=uuid.uuid4(), organization_id=org.id, created_by=host.id, title="합성 클래스", status="active",
                default_duration_min=60, organization_attribution_known=True)
    db.add(cls)
    db.flush()
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=cls.id, user_id=host.id, role="lead"))
    sess = Session(id=uuid.uuid4(), type="meditation", status="in_progress", host_id=host.id, class_id=cls.id, seq=1, host_state="assigned", organization_id=org.id, organization_attribution_known=True,
                   duration_min=60, started_at=NOW - timedelta(hours=1))
    db.add(sess)
    db.flush()

    parts, expected = [], {}
    for i in range(N_PART):
        guest = i % 10 == 9
        u = None
        if not guest:
            u = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name=f"참여자{i + 1:02d}",
                     role="client", status="active", password_hash="x")
            db.add(u)
            db.flush()
        p = SessionParticipant(id=uuid.uuid4(), session_id=sess.id, user_id=u.id if u else None,
                               guest_name=None if u else f"게스트{i + 1:02d}", report_included=i % 2 == 0,
                               eeg_collection_consented=[True, None, False][i % 3] if i % 7 else True,
                               band_connected=i % 4 != 0)
        db.add(p)
        parts.append(p)
    db.flush()

    base = NOW - timedelta(hours=1)
    feats, raws = [], []
    for i, p in enumerate(parts):
        exp = {"received": 0, "legacy": 0, "missing": 0, "raw": {s: dict(reg=0, up=0, pend=0, fail=0, miss=0) for s in ("eeg", "ppg", "acc")}}
        if i % 8 == 7:      # 수신 0건 참여자
            expected[p.id] = exp
            continue
        streams: list = [("pg-a", range(1, N_FEATURE + 1))]
        if i % 5 == 0:      # 중간 공백 + 두 번째 stream
            idx = [k for k in range(1, N_FEATURE + 1) if not (100 <= k <= 109)]
            streams = [("pg-a", idx), ("pg-b", range(1, 301))]
        if i % 6 == 0:      # legacy NULL
            streams.append((None, range(1, 51)))
        for pg, rng in streams:
            seq = list(rng)
            for k in seq:
                feats.append(dict(id=uuid.uuid4(), session_id=sess.id, participant_id=p.id, user_id=p.user_id,
                                  play_group_id=pg, window_index=k, quality="valid", late=False, ingest_path="rest",
                                  created_at=base + timedelta(seconds=k)))
            exp["received"] += len(seq)
            if pg is None:
                exp["legacy"] += len(seq)
            else:
                exp["missing"] += sum(max(b - a - 1, 0) for a, b in zip(seq, seq[1:]))
        for sig in ("eeg", "ppg", "acc"):
            n = 360 if sig == "eeg" else 240
            idxs = list(range(0, n))
            if i % 9 == 3:
                idxs = [k for k in idxs if k not in (50, 51, 80)]
            e = exp["raw"][sig]
            for pos, k in enumerate(idxs):
                st = "uploaded"
                if i % 11 == 5 and pos >= len(idxs) - 4:
                    st = "pending"
                elif i % 13 == 6 and pos == 10:
                    st = "failed"
                created = base + timedelta(seconds=10 * k)
                raws.append(dict(id=uuid.uuid4(), session_id=sess.id, participant_id=p.id, user_id=p.user_id,
                                 stream_id="s1", segment_id="seg1", signal_type=sig, chunk_index=k, sample_rate=250,
                                 object_key=f"synthetic/{uuid.uuid4().hex}", upload_status=st, created_at=created,
                                 uploaded_at=created + timedelta(seconds=2) if st == "uploaded" else None))
                e["reg"] += 1
                e[{"uploaded": "up", "pending": "pend", "failed": "fail"}[st]] += 1
            e["miss"] += sum(max(b - a - 1, 0) for a, b in zip(idxs, idxs[1:]))
        expected[p.id] = exp
    db.commit()
    for lo in range(0, len(feats), 5000):
        db.execute(sa.insert(EEGFeatureWindow), feats[lo:lo + 5000])
    for lo in range(0, len(raws), 5000):
        db.execute(sa.insert(EEGRawChunk), raws[lo:lo + 5000])
    db.commit()
    w = dict(org=org, cls=cls, sess=sess, host=host, other=other, admin=admin, pa=pa, parts=parts, expected=expected,
             db=db)
    yield w
    db.rollback()
    for model in (EEGRawChunk, EEGFeatureWindow):
        db.execute(sa.delete(model).where(model.session_id == sess.id))
    db.execute(sa.delete(SessionParticipant).where(SessionParticipant.session_id == sess.id))
    db.execute(sa.delete(Session).where(Session.id == sess.id))
    db.execute(sa.delete(ClassInstructor).where(ClassInstructor.class_id == cls.id))
    db.execute(sa.delete(Class).where(Class.id == cls.id))
    db.commit()
    db.close()


@pytest.fixture(autouse=True)
def _svc(monkeypatch):
    from app.services import upload_status_service as svc

    svc.clear_cache()
    monkeypatch.setattr(svc, "CACHE_TTL_SEC", 0.0)
    monkeypatch.setattr(svc, "_utcnow", lambda: NOW)
    return svc


def _actor(u):
    return {"id": str(u.id), "role": u.role}


def test_PG_집계가_독립_계산과_0오차로_일치(world, _svc):
    res = _svc.load_upload_status(world["db"], _actor(world["host"]), world["cls"].id, world["sess"].id)
    body = res.body
    assert body is not None and len(body.participants) == N_PART
    by_id = {p.participant_id: p for p in body.participants}
    for p in world["parts"]:
        got, exp = by_id[str(p.id)], world["expected"][p.id]
        assert got.feature.received == exp["received"], p.guest_name
        assert got.feature.legacy_count == exp["legacy"]
        assert got.feature.internal_missing == exp["missing"]
        for s in got.raw.signals:
            e = exp["raw"][s.signal_type]
            assert (s.registered, s.uploaded, s.pending, s.failed, s.internal_missing) == (
                e["reg"], e["up"], e["pend"], e["fail"], e["miss"]), (p.guest_name, s.signal_type)
    assert sum(by_id[k].feature.received for k in by_id) == sum(e["received"] for e in world["expected"].values())
    s = body.summary
    assert s.participants == N_PART and s.needs_attention + s.uploading + s.received_unreconciled + s.no_data + s.excluded == N_PART


def test_PG_권한_역할(world, _svc):
    db, cid, sid = world["db"], world["cls"].id, world["sess"].id
    for u in (world["host"], world["admin"], world["pa"]):
        assert _svc.load_upload_status(db, _actor(u), cid, sid).body is not None
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as e:
        _svc.load_upload_status(db, _actor(world["other"]), cid, sid)
    assert e.value.status_code == 403


def test_PG_SQL_횟수_와_응답시간(world, _svc):
    db, cid, sid = world["db"], world["cls"].id, world["sess"].id
    actor = _actor(world["host"])
    hits: list[str] = []

    def _hit(conn, cursor, statement, *a, **k):
        hits.append(statement)

    eng = db.get_bind()
    sa.event.listen(eng, "before_cursor_execute", _hit)
    try:
        res = _svc.load_upload_status(db, actor, cid, sid)
        n200 = len(hits)
        hits.clear()
        res304 = _svc.load_upload_status(db, actor, cid, sid, res.etag)
        n304 = len(hits)
    finally:
        sa.event.remove(eng, "before_cursor_execute", _hit)
    assert res304.body is None
    assert n200 <= 8 and n304 <= 2, (n200, n304)
    times = []
    for _ in range(30):
        t = time.perf_counter()
        _svc.load_upload_status(db, actor, cid, sid)
        times.append(time.perf_counter() - t)
    times.sort()
    p95 = times[int(0.95 * len(times)) - 1]
    print(f"\n[PG] 40명×{N_FEATURE}행 200경로 p50={times[15] * 1000:.0f}ms p95={p95 * 1000:.0f}ms, SQL 200={n200} 304={n304}")
    assert p95 < 1.0
    times304 = []
    for _ in range(30):
        t = time.perf_counter()
        _svc.load_upload_status(db, actor, cid, sid, res.etag)
        times304.append(time.perf_counter() - t)
    times304.sort()
    print(f"[PG] 304 경로 p95={times304[28] * 1000:.0f}ms")
    assert times304[28] < 0.15


def test_PG_EXPLAIN과_샘플_출력(world, _svc, engine):
    db = world["db"]
    res = _svc.load_upload_status(db, _actor(world["host"]), world["cls"].id, world["sess"].id)
    out = os.environ.get("UPLOAD_STATUS_SAMPLE_OUT")
    if out:
        data = res.body.model_dump()
        # 이름은 합성값이므로 그대로 둔다. 응답 크기·참여자 수 기록
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"_note": "합성 데이터(운영 DB·실개인정보 아님) PostgreSQL 실응답. etag/poll 헤더는 응답 본문 값과 동일.",
                       "headers": {"ETag": res.etag, "X-Poll-Interval": str(res.poll_interval_sec),
                                   "Cache-Control": "no-store, private"},
                       "response": data}, fh, ensure_ascii=False, indent=2)
    sid = str(world["sess"].id)
    with engine.connect() as c:
        plan = "\n".join(r[0] for r in c.execute(sa.text(
            "EXPLAIN SELECT participant_id, count(*) FROM eeg_feature_windows WHERE session_id=:s GROUP BY participant_id"),
            {"s": sid}))
    print("\n[EXPLAIN feature]\n" + plan)
