"""SDD-265 T6·T7 — 회차 상세 가산 필드(V-R31~33)와 회원 본인 목록(V-R34~39)."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.session import Session, SessionParticipant
from app.models.session_ingest_expected import SessionIngestExpected
from app.services import upload_member_service  # noqa: F401
from app.services import upload_status_overview_service as ov
from app.services import upload_status_service as detail_svc
from tests.sdd237_helpers import auth_for, build_class_world, make_user
from tests.sdd265.test_overview_page import add_artifact, add_sized, get, item_for, make_sessions
from tests.test_upload_status import add_features
from tests.test_upload_status_overview import URL, add_session

NOW = datetime(2026, 11, 4, 5, 10, 0, tzinfo=timezone.utc)
ME = "/api/v1/upload-status/me/sessions"


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    session = next(app.dependency_overrides[get_db]())
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    ov.clear_cache()
    detail_svc.clear_cache()
    monkeypatch.setattr(ov, "_utcnow", lambda: NOW)
    monkeypatch.setattr(detail_svc, "_utcnow", lambda: NOW)
    for name in ("TTL_LIVE_SEC", "TTL_RECENT_SEC", "TTL_OLD_SEC"):
        monkeypatch.setattr(ov, name, 0.0)
    monkeypatch.setattr(detail_svc, "CACHE_TTL_SEC", 0.0)
    yield
    ov.clear_cache()
    detail_svc.clear_cache()


@pytest.fixture
def world(client, db):
    return build_class_world(db, members=3, status="completed", ended=True)


def detail(client, world, s):
    r = client.get(f"/api/v1/classes/{world['cls'].id}/sessions/{s.id}/upload-status", headers=world["auth"])
    assert r.status_code == 200, r.text
    return r.json()


# ── 상세 ─────────────────────────────────────────────────────────
def test_V_R31_상세_최상위는_목록_항목과_같은_값(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=6000, members=3)
    parts[2].eeg_collection_consented = False
    db.commit()
    add_sized(db, s, parts[0], "eeg", [100, 100])
    add_artifact(db, s, parts[0], "feature", 300, 10)
    add_features(db, s, parts[0], list(range(120)))
    add_features(db, s, parts[1], list(range(60)))
    d = detail(client, world, s)
    it = item_for(client, world["auth"], s)
    for k in ("participants_expected", "participants_arrived", "bytes_arrived", "bytes_expected", "bytes_basis",
              "duration_min", "participant_minutes_total"):
        assert d[k] == it[k], k
    assert it["participants_expected"] == 2 and it["participants_arrived"] == 2
    assert d["participant_minutes_total"] == 3


def test_V_R32_상세_참여자별_바이트와_측정_분(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=6001, members=2)
    add_sized(db, s, parts[0], "eeg", [100, 50])
    add_artifact(db, s, parts[0], "feature", 25, 3)
    add_features(db, s, parts[0], list(range(185)))
    d = detail(client, world, s)
    row = next(p for p in d["participants"] if p["participant_id"] == str(parts[0].id))
    other = next(p for p in d["participants"] if p["participant_id"] == str(parts[1].id))
    assert row["bytes_arrived"] == 175 and row["measured_min"] == 3
    assert other["bytes_arrived"] == 0 and other["measured_min"] == 0


def test_V_R33_바이트만_바뀌어도_상세_ETag_변경(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=6002, members=1)
    add_sized(db, s, parts[0], "eeg", [10])
    url = f"/api/v1/classes/{world['cls'].id}/sessions/{s.id}/upload-status"
    r = client.get(url, headers=world["auth"])
    etag = r.headers["ETag"]
    assert client.get(url, headers={**world["auth"], "If-None-Match": etag}).status_code == 304
    add_sized(db, s, parts[0], "eeg", [10], start=9)
    r2 = client.get(url, headers={**world["auth"], "If-None-Match": etag})
    assert r2.status_code == 200 and r2.headers["ETag"] != etag


# ── 회원 ─────────────────────────────────────────────────────────
def member_world(db, world, n, *, member_user=None, seq0=7000):
    """회원 한 명이 n 개 회차에 참여. 각 회차에 다른 사람(타인)도 참여."""
    me = member_user or make_user(db, role="client", name="회원", org=world["org"])
    rows = []
    for i in range(n):
        s, parts = add_session(db, world, started=NOW - timedelta(hours=1 + i), seq=seq0 + i, members=2)
        mine = SessionParticipant(id=uuid.uuid4(), session_id=s.id, user_id=me.id, report_included=True,
                                  eeg_collection_consented=True)
        db.add(mine)
        db.commit()
        rows.append((s, mine, parts))
    return me, rows


def me_get(client, user, **params):
    r = client.get(ME, headers=auth_for(user), params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_V_R34_본인_참여_회차만_보이고_타인_정보는_없다(client, world, db):
    me, rows = member_world(db, world, 3)
    add_session(db, world, started=NOW - timedelta(hours=9), seq=7900, members=2)   # 참여 안 한 회차
    body = me_get(client, me)
    assert [it["session_id"] for it in body["items"]] == [str(s.id) for s, _, _ in rows]
    assert body["total_candidates"] == 3
    text = str(body)
    for _, _, others in rows:
        for o in others:
            assert str(o.id) not in text and o.guest_name not in text
    assert "participants" not in body["items"][0] and "display_name" not in text


def test_V_R35_회원_cursor_순회(client, world, db):
    me, rows = member_world(db, world, 25)
    seen, cursor = [], None
    for _ in range(5):
        params = {"limit": 10, **({"cursor": cursor} if cursor else {})}
        body = me_get(client, me, **params)
        seen.append([it["session_id"] for it in body["items"]])
        cursor = body["next_cursor"]
        if not cursor:
            break
    assert [len(x) for x in seen] == [10, 10, 5]
    flat = [x for page in seen for x in page]
    assert flat == [str(s.id) for s, _, _ in rows] and len(set(flat)) == 25


def test_V_R36_수집_제외는_문제로_표시하지_않는다(client, world, db):
    me, rows = member_world(db, world, 1)
    rows[0][1].eeg_collection_consented = False
    db.commit()
    it = me_get(client, me)["items"][0]
    assert it["collection_state"] == "excluded" and it["status"] == "no_data" and it["progress_state"] == "not_collected"


def test_V_R37_비로그인_401(client):
    assert client.get(ME).status_code == 401


def test_V_R38_본인_percent는_상세의_본인_progress와_일치(client, world, db):
    me, rows = member_world(db, world, 1)
    s, mine, _ = rows[0]
    add_features(db, s, mine, list(range(90)))
    db.add(SessionIngestExpected(session_id=s.id, participant_id=mine.id, feature=100, raw_eeg=0, raw_ppg=0,
                                 raw_acc=0, final=False, first_reported_at=NOW - timedelta(minutes=5),
                                 reported_at=NOW - timedelta(seconds=10), updated_at=NOW - timedelta(seconds=10)))
    db.commit()
    it = me_get(client, me)["items"][0]
    d = detail(client, world, s)
    mine_row = next(p for p in d["participants"] if p["participant_id"] == str(mine.id))
    assert it["percent"] == mine_row["progress"]["total"]["percent"] == 90.0
    assert it["progress_state"] == mine_row["progress"]["state"]
    assert it["measured_min"] == 1 and it["duration_min"] == 45


def test_V_R39_본인_바이트만_합산(client, world, db):
    me, rows = member_world(db, world, 1)
    s, mine, others = rows[0]
    add_sized(db, s, mine, "eeg", [10, 20])
    add_sized(db, s, others[0], "eeg", [1000])
    add_artifact(db, s, mine, "feature", 5, 1)
    add_artifact(db, s, others[1], "feature", 9999, 1)
    it = me_get(client, me)["items"][0]
    assert it["bytes_arrived"] == 35


def test_회원_캐시는_사용자별로_분리된다(client, world, db, monkeypatch):
    for name in ("TTL_LIVE_SEC", "TTL_RECENT_SEC", "TTL_OLD_SEC"):
        monkeypatch.setattr(ov, name, 600.0)
    me, rows = member_world(db, world, 1)
    s = rows[0][0]
    other_user = make_user(db, role="client", name="다른 회원", org=world["org"])
    other_part = SessionParticipant(id=uuid.uuid4(), session_id=s.id, user_id=other_user.id, report_included=True,
                                    eeg_collection_consented=True)
    db.add(other_part)
    db.commit()
    add_sized(db, s, other_part, "eeg", [777])
    add_sized(db, s, rows[0][1], "eeg", [11])
    assert me_get(client, me)["items"][0]["bytes_arrived"] == 11
    assert me_get(client, other_user)["items"][0]["bytes_arrived"] == 777


def test_회원_304(client, world, db):
    me, _ = member_world(db, world, 2)
    r = client.get(ME, headers=auth_for(me))
    etag = r.headers["ETag"]
    r2 = client.get(ME, headers={**auth_for(me), "If-None-Match": etag})
    assert r2.status_code == 304 and r2.content == b""
    assert {"etag", "cache-control", "vary", "x-poll-interval"} <= {h.lower() for h in r2.headers}


def test_회원_잘못된_cursor_422(client, world, db):
    me, _ = member_world(db, world, 1)
    r = client.get(ME, headers=auth_for(me), params={"cursor": "xx"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "upload_status_invalid_cursor"


def test_회원_쿼리_수는_회차_수와_무관(client, world, db):
    from sqlalchemy import event

    me, _ = member_world(db, world, 2)
    actor = {"id": str(me.id), "role": "client"}

    def count():
        ov.clear_cache()
        n = {"n": 0}
        engine = db.get_bind()
        hook = lambda *a, **k: n.__setitem__("n", n["n"] + 1)  # noqa: E731
        event.listen(engine, "before_cursor_execute", hook)
        try:
            upload_member_service.load_member_sessions(db, actor, limit=10)
        finally:
            event.remove(engine, "before_cursor_execute", hook)
        return n["n"]

    few = count()
    member_world(db, world, 20, member_user=me, seq0=8000)   # 같은 사용자가 더 많은 회차에 참여
    assert few == count() <= 6
