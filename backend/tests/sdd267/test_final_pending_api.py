"""SDD-267 — 상세·목록·회원 응답의 final_pending 가산과 ETag (V-P19~P26)."""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from app.models.session_ingest_expected import SessionIngestExpected
from app.models.user import User
from app.services import upload_status_overview_service as ov
from app.services import upload_status_service as detail_svc
from tests.sdd237_helpers import auth_for, build_class_world

NOW = datetime(2026, 11, 4, 5, 10, 0, tzinfo=timezone.utc)
OV = "/api/v1/upload-status/overview"
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


@pytest.fixture
def clock(monkeypatch):
    state = {"now": NOW}
    for m in (ov, detail_svc):
        monkeypatch.setattr(m, "_utcnow", lambda: state["now"])
    for name in ("TTL_LIVE_SEC", "TTL_RECENT_SEC", "TTL_OLD_SEC"):
        monkeypatch.setattr(ov, name, 0.0)
    monkeypatch.setattr(detail_svc, "CACHE_TTL_SEC", 0.0)
    ov.clear_cache()
    detail_svc.clear_cache()
    yield state
    ov.clear_cache()
    detail_svc.clear_cache()


@pytest.fixture
def world(client, db, clock):
    w = build_class_world(db, members=3, status="completed", ended=True)
    w["session"].ended_at = NOW - timedelta(seconds=181)
    db.commit()
    return w


def seed(db, w, p, n=5, *, final=False, received=None, last_ago=130):
    """feature n 개 수신 + 기대량 n(raw 0) 보고."""
    for i in range(received if received is not None else n):
        db.add(EEGFeatureWindow(id=uuid.uuid4(), session_id=w["session"].id, participant_id=p.id, user_id=p.user_id,
                                play_group_id="pg", window_index=i, quality="valid",
                                created_at=NOW - timedelta(seconds=last_ago)))
    t = NOW - timedelta(seconds=last_ago)
    db.add(SessionIngestExpected(participant_id=p.id, session_id=w["session"].id, feature=n, raw_eeg=0, raw_ppg=0,
                                 raw_acc=0, final=final, first_reported_at=t - timedelta(seconds=30),
                                 reported_at=t, updated_at=t))
    db.commit()


def detail(client, w):
    r = client.get(f"/api/v1/classes/{w['cls'].id}/sessions/{w['session'].id}/upload-status", headers=w["auth"])
    assert r.status_code == 200, r.text
    return r


def item(client, w):
    r = client.get(OV, headers=w["auth"])
    assert r.status_code == 200, r.text
    return next(i for i in r.json()["items"] if i["session_id"] == str(w["session"].id)), r.json()


def test_P19_P21_상세_목록_일관(client, db, world):
    a, b, c = world["participants"]
    seed(db, world, a)
    seed(db, world, b)
    seed(db, world, c, final=True)
    d = detail(client, world).json()
    flags = {x["participant_id"]: x["progress"]["final_pending"] for x in d["participants"]}
    assert flags == {str(a.id): True, str(b.id): True, str(c.id): False}
    assert d["progress"]["participants"]["final_pending"] == 2
    assert d["progress"]["participants"]["all_received"] == 1 and d["progress"]["participants"]["in_progress"] == 2
    it, top = item(client, world)
    assert it["progress"]["participants"] == d["progress"]["participants"]
    assert top["progress"]["participants"]["final_pending"] == 2


def test_P22_회원_목록(client, db, world):
    a, b, c = world["participants"]
    seed(db, world, a)
    seed(db, world, b, final=True)
    for p, want in ((a, True), (b, False)):
        user = db.get(User, p.user_id)
        r = client.get(ME, headers=auth_for(user))
        assert r.status_code == 200, r.text
        row = next(i for i in r.json()["items"] if i["session_id"] == str(world["session"].id))
        assert row["final_pending"] is want
    assert row["progress_state"] == "all_received"


def test_P23_종료후_180초_경계에서_ETag_변화(client, db, world, clock):
    seed(db, world, world["participants"][0])
    world["session"].ended_at = NOW - timedelta(seconds=170)
    db.commit()
    clock["now"] = NOW + timedelta(seconds=1)   # 종료 후 171초
    e1 = detail(client, world).headers["etag"]
    clock["now"] = NOW + timedelta(seconds=8)   # 같은 30초 버킷, 종료 후 178초
    e1b = detail(client, world).headers["etag"]
    clock["now"] = NOW + timedelta(seconds=11)  # 종료 후 181초 (같은 버킷)
    e2 = detail(client, world).headers["etag"]
    assert e1 == e1b and e1 != e2


def test_P24_보고_없는_조용한_완료_회차는_304(client, db, world, clock):
    world["session"].ended_at = NOW - timedelta(hours=3)
    db.commit()
    e = detail(client, world).headers["etag"]
    clock["now"] = NOW + timedelta(seconds=45)
    r = client.get(f"/api/v1/classes/{world['cls'].id}/sessions/{world['session'].id}/upload-status",
                   headers={**world["auth"], "If-None-Match": e})
    assert r.status_code == 304


def test_P25_금지_표현_없음(client, db, world):
    seed(db, world, world["participants"][0])
    text = json.dumps(detail(client, world).json(), ensure_ascii=False)
    for w in ("score", "점수", "보증", "좋음", "나쁨"):
        assert w not in text
