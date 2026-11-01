"""SDD-263 BE — PostgreSQL 실DB 검증(PG_SMOKE=1, 로컬 DB 한정).

50회차×40명 합성 데이터로 (1) 목록 요약 == SDD-261 상세 집계(회차마다), (2) SQL 횟수, (3) 응답 시간,
(4) sample-response.json 생성(UPLOAD_OVERVIEW_SAMPLE_OUT 지정 시)을 확인한다.
실행: PG_SMOKE=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55263/mb263 pytest tests/test_upload_status_overview_pg.py
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
N_SESS, N_PART, N_FEATURE, N_RAW = 50, 40, 300, 20


@pytest.fixture(scope="module")
def engine():
    url = os.environ.get("DATABASE_URL", "")
    assert make_url(url).host in {"127.0.0.1", "localhost"}, "로컬 DB 에만 연결한다"
    eng = sa.create_engine(url)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def world(engine):
    from app.models.class_program import Class, ClassInstructor
    from app.models.eeg_feature import EEGFeatureWindow
    from app.models.organization import Organization
    from app.models.record import EEGRawChunk
    from app.models.session import Session, SessionParticipant
    from app.models.user import User
    from app.models.user_org_membership import UserOrgMembership

    rnd = random.Random(263)
    db = sessionmaker(bind=engine)()
    org = Organization(id=uuid.uuid4(), name="합성기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org)
    db.flush()

    def mk(name, role):
        return User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name=name, role=role,
                    status="active", password_hash="x")

    host, other, admin, pa = mk("합성 코치", "counselor"), mk("다른 코치", "counselor"), mk("기관관리자", "org_admin"), \
        mk("플랫폼관리자", "platform_admin")
    db.add_all([host, other, admin, pa])
    db.flush()
    for u, role in ((host, "counselor"), (other, "counselor"), (admin, "org_admin")):
        db.add(UserOrgMembership(id=uuid.uuid4(), user_id=u.id, org_id=org.id, role=role, status="active"))
    cls = Class(id=uuid.uuid4(), organization_id=org.id, created_by=host.id, title="합성 클래스", status="active",
                default_duration_min=60, organization_attribution_known=True)
    db.add(cls)
    db.flush()
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=cls.id, user_id=host.id, role="lead"))

    sessions, parts_by_session, feats, raws = [], {}, [], []
    clients = [mk(f"참여자{i + 1:02d}", "client") for i in range(N_PART)]
    db.add_all(clients)
    db.flush()
    for si in range(N_SESS):
        status = "in_progress" if si == 0 else "completed"
        started = NOW - timedelta(hours=1) if si == 0 else NOW - timedelta(days=si % 25, hours=2 + si % 5)
        sess = Session(id=uuid.uuid4(), type="meditation", status=status, host_id=host.id, class_id=cls.id, seq=si + 1,
                       host_state="assigned", organization_id=org.id, organization_attribution_known=True,
                       duration_min=60, started_at=started,
                       ended_at=None if si == 0 else started + timedelta(hours=1))
        db.add(sess)
        sessions.append(sess)
    db.flush()
    for sess in sessions:
        plist = []
        for i in range(N_PART):
            guest = i % 10 == 9
            p = SessionParticipant(id=uuid.uuid4(), session_id=sess.id, user_id=None if guest else clients[i].id,
                                   guest_name=f"게스트{i + 1:02d}" if guest else None, report_included=i % 2 == 0,
                                   eeg_collection_consented=[True, None, False][i % 3] if i % 7 else True,
                                   band_connected=i % 4 != 0)
            db.add(p)
            plist.append(p)
        parts_by_session[sess.id] = plist
    db.flush()
    for sess in sessions:
        base = sess.started_at
        for i, p in enumerate(parts_by_session[sess.id]):
            if i % 8 == 7:
                continue
            rng = [k for k in range(1, N_FEATURE + 1) if not (i % 5 == 0 and 100 <= k <= 104)]
            for k in rng:
                feats.append(dict(id=uuid.uuid4(), session_id=sess.id, participant_id=p.id, user_id=p.user_id,
                                  play_group_id="pg-a", window_index=k, quality="valid", late=False,
                                  ingest_path="rest", created_at=base + timedelta(seconds=k)))
            for sig in ("eeg", "ppg", "acc"):
                for k in range(N_RAW):
                    st = "uploaded"
                    if i % 11 == 5 and k >= N_RAW - 3:
                        st = "pending"
                    elif i % 13 == 6 and k == 10:
                        st = "failed"
                    created = base + timedelta(seconds=10 * k)
                    raws.append(dict(id=uuid.uuid4(), session_id=sess.id, participant_id=p.id, user_id=p.user_id,
                                     stream_id="s1", segment_id="seg1", signal_type=sig, chunk_index=k,
                                     sample_rate=250, object_key=f"synthetic/{uuid.uuid4().hex}", upload_status=st,
                                     created_at=created,
                                     uploaded_at=created + timedelta(seconds=2) if st == "uploaded" else None))
    db.commit()
    for lo in range(0, len(feats), 5000):
        db.execute(sa.insert(EEGFeatureWindow), feats[lo:lo + 5000])
    for lo in range(0, len(raws), 5000):
        db.execute(sa.insert(EEGRawChunk), raws[lo:lo + 5000])
    db.commit()
    db.execute(sa.text("ANALYZE"))
    db.commit()
    w = dict(org=org, cls=cls, sessions=sessions, host=host, other=other, admin=admin, pa=pa, db=db)
    yield w
    if os.environ.get("PG_KEEP") == "1":
        db.close()
        return
    db.rollback()
    ids = [s.id for s in sessions]
    for model in (EEGRawChunk, EEGFeatureWindow, SessionParticipant):
        db.execute(sa.delete(model).where(model.session_id.in_(ids)))
    db.execute(sa.delete(Session).where(Session.id.in_(ids)))
    db.execute(sa.delete(ClassInstructor).where(ClassInstructor.class_id == cls.id))
    db.execute(sa.delete(Class).where(Class.id == cls.id))
    db.commit()
    db.close()


@pytest.fixture(autouse=True)
def _svc(monkeypatch):
    from app.services import upload_status_overview_service as ov
    from app.services import upload_status_service as detail

    ov.clear_cache()
    detail.clear_cache()
    monkeypatch.setattr(ov, "_utcnow", lambda: NOW)
    monkeypatch.setattr(detail, "_utcnow", lambda: NOW)
    monkeypatch.setattr(detail, "CACHE_TTL_SEC", 0.0)
    for name in ("TTL_LIVE_SEC", "TTL_RECENT_SEC", "TTL_OLD_SEC"):
        monkeypatch.setattr(ov, name, 0.0)
    return ov


def _actor(u):
    return {"id": str(u.id), "role": u.role}


def test_PG_목록_요약이_회차마다_상세_집계와_일치(world, _svc):
    from app.services import upload_status_service as detail

    res = _svc.load_overview(world["db"], _actor(world["host"]), limit=50, since=(NOW - timedelta(days=60)).strftime("%Y-%m-%d"))
    body = res.body
    assert body is not None and len(body.items) == N_SESS and body.items[0].session_status == "in_progress"
    for it in body.items:
        d = detail.load_upload_status(world["db"], _actor(world["host"]), world["cls"].id, uuid.UUID(it.session_id)).body
        assert d is not None
        for key in ("needs_attention", "uploading", "received_unreconciled", "no_data", "excluded"):
            assert getattr(it, key) == getattr(d.summary, key), (it.session_id, key)
        assert it.participants == d.summary.participants == N_PART
        last = max((t for p in d.participants for t in (p.feature.last_received_at, p.raw.last_received_at) if t), default=None)
        assert it.last_received_at == last


def _count_queries(db, fn):
    stmts = []
    eng = db.get_bind()
    hook = lambda conn, cur, st, params, ctx, many: stmts.append(st)  # noqa: E731
    sa.event.listen(eng, "before_cursor_execute", hook)
    try:
        out = fn()
    finally:
        sa.event.remove(eng, "before_cursor_execute", hook)
    return len(stmts), out


def test_PG_SQL_횟수와_응답시간(world, _svc):
    db, actor = world["db"], _actor(world["host"])
    since = (NOW - timedelta(days=60)).strftime("%Y-%m-%d")
    n, _ = _count_queries(db, lambda: _svc.load_overview(db, actor, limit=50, since=since))
    print(f"\n[SQL] 50회차×40명 본문 계산 SQL 횟수 = {n}")
    assert n <= 10
    times = []
    for _ in range(15):
        _svc.clear_cache()
        t = time.perf_counter()
        _svc.load_overview(db, actor, limit=50, since=since)
        times.append(time.perf_counter() - t)
    times.sort()
    p50, p95 = times[len(times) // 2], times[int(len(times) * 0.95) - 1]
    print(f"[PERF] 200 콜드(전 회차 재계산, 합성 {N_SESS}회차×{N_PART}명) p50={p50:.3f}s p95={p95:.3f}s max={times[-1]:.3f}s")
    assert p95 < 3.0  # 콜드는 회귀 가드만. 평소 상태는 아래 steady 측정

    # 평소 상태: 기본 TTL(진행 중 2s / 오래된 300s). 진행 중 1회차만 매 요청 재계산된다.
    for name, val in (("TTL_LIVE_SEC", 2.0), ("TTL_RECENT_SEC", 10.0), ("TTL_OLD_SEC", 300.0)):
        setattr(_svc, name, val)
    _svc.clear_cache()
    _svc.load_overview(db, actor, limit=50, since=since)
    steady = []
    for _ in range(20):
        _svc._cache.pop(world["sessions"][0].id, None)  # 진행 중 회차 TTL 만료를 모사
        t = time.perf_counter()
        _svc.load_overview(db, actor, limit=50, since=since)
        steady.append(time.perf_counter() - t)
    steady.sort()
    print(f"[PERF] 200 평소(진행 중 1회차 재계산) p50={steady[10]:.3f}s p95={steady[18]:.3f}s")
    assert steady[18] < 1.5

    # 캐시 적중 304 경로(회차 집계 생략)
    for name in ("TTL_LIVE_SEC", "TTL_RECENT_SEC", "TTL_OLD_SEC"):
        setattr(_svc, name, 60.0)
    _svc.clear_cache()
    first = _svc.load_overview(db, actor, limit=50, since=since)
    hits = []
    for _ in range(30):
        t = time.perf_counter()
        r = _svc.load_overview(db, actor, limit=50, since=since, if_none_match=first.etag)
        hits.append(time.perf_counter() - t)
        assert r.body is None
    hits.sort()
    print(f"[PERF] 304(캐시 적중) p50={hits[15]:.3f}s p95={hits[28]:.3f}s")
    assert hits[28] < 0.15
    n304, _ = _count_queries(db, lambda: _svc.load_overview(db, actor, limit=50, since=since, if_none_match=first.etag))
    print(f"[SQL] 304 경로 SQL 횟수 = {n304}")


def test_PG_권한_역할(world, _svc):
    db = world["db"]
    since = (NOW - timedelta(days=60)).strftime("%Y-%m-%d")
    for u in (world["host"], world["admin"], world["pa"]):
        assert len(_svc.load_overview(db, _actor(u), limit=50, since=since).body.items) == N_SESS
    assert _svc.load_overview(db, _actor(world["other"]), limit=50, since=since).body.items == []


def test_PG_EXPLAIN_대형_테이블_seq_scan_없음(world):
    db = world["db"]
    ids = ",".join(f"'{s.id}'" for s in world["sessions"][:20])
    for table, col in (("eeg_feature_windows", "session_id"), ("eeg_raw_chunks", "session_id")):
        plan = "\n".join(r[0] for r in db.execute(sa.text(
            f"EXPLAIN SELECT session_id, participant_id, count(*) FROM {table} WHERE {col} IN ({ids}) "
            f"GROUP BY session_id, participant_id")).all())
        print(f"\n[EXPLAIN {table}]\n{plan}")
        assert "Seq Scan on " + table not in plan


def test_PG_sample_response_생성(world, _svc):
    out = os.environ.get("UPLOAD_OVERVIEW_SAMPLE_OUT")
    if not out:
        pytest.skip("UPLOAD_OVERVIEW_SAMPLE_OUT 미지정")
    res = _svc.load_overview(world["db"], _actor(world["host"]), limit=8,
                             since=(NOW - timedelta(days=60)).strftime("%Y-%m-%d"))
    assert res.body is not None
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(res.body.model_dump(), fh, ensure_ascii=False, indent=2)
