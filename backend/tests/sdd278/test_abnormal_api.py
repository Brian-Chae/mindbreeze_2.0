"""SDD-278 — 상세·개요·회원 응답의 비정상 종료 의심 가산·하위호환 (V11~V12)."""

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

NOW = datetime(2026, 11, 5, 5, 0, 0, tzinfo=timezone.utc)
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



# build_class_world 의 회차 종료 시각(START+duration)을 NOW 기준으로 재설정해 쓴다.


@pytest.fixture
def world(client, db, clock):
    w = build_class_world(db, members=3, status="completed", ended=True)
    w["session"].ended_at = NOW - timedelta(hours=25)
    db.commit()
    return w


def seed_data(db, w, p, n=5, *, report=None, final=False, last_ago=25 * 3600):
    for i in range(n):
        db.add(EEGFeatureWindow(id=uuid.uuid4(), session_id=w["session"].id, participant_id=p.id, user_id=p.user_id,
                                play_group_id="pg", window_index=i, quality="valid",
                                created_at=NOW - timedelta(seconds=last_ago)))
    if report:
        t = NOW - timedelta(seconds=last_ago)
        db.add(SessionIngestExpected(participant_id=p.id, session_id=w["session"].id, feature=n, raw_eeg=0, raw_ppg=0,
                                     raw_acc=0, final=final, first_reported_at=t - timedelta(seconds=30),
                                     reported_at=t, updated_at=t))
    db.commit()


def detail(client, w):
    r = client.get(f"/api/v1/classes/{w['cls'].id}/sessions/{w['session'].id}/upload-status", headers=w["auth"])
    assert r.status_code == 200, r.text
    return r.json()


def overview_item(client, w):
    r = client.get(OV, headers=w["auth"])
    assert r.status_code == 200, r.text
    body = r.json()
    return next(i for i in body["items"] if i["session_id"] == str(w["session"].id)), body


def test_V12_상세_비회원급_보고없음_25시간(client, db, world):
    a, b, c = world["participants"]
    seed_data(db, world, a, report=True, final=True)   # 정상 도착
    seed_data(db, world, b)                            # 데이터 있음, 폰 보고 없음 → 의심
    d = detail(client, world)                          # c: 데이터 없음 → 의심 아님
    flags = {x["participant_id"]: x["progress"]["abnormal_exit_suspected"] for x in d["participants"]}
    assert flags == {str(a.id): False, str(b.id): True, str(c.id): False}
    states = {x["participant_id"]: x["progress"]["state"] for x in d["participants"]}
    assert states[str(b.id)] == "expected_unknown"     # state 열거값 불변
    q = d["progress"]["participants"]
    assert q["abnormal_exit_suspected"] == 1 and q["all_received"] == 1
    it, top = overview_item(client, world)
    assert it["progress"]["participants"] == q
    assert top["progress"]["participants"]["abnormal_exit_suspected"] == 1


def test_V12_종료_23시간대는_의심_아님(client, db, world):
    world["session"].ended_at = NOW - timedelta(hours=23, minutes=59)
    db.commit()
    seed_data(db, world, world["participants"][0])
    d = detail(client, world)
    assert d["progress"]["participants"]["abnormal_exit_suspected"] == 0


def test_V11_기존_키_불변_가산만(client, db, world):
    a, b, _ = world["participants"]
    seed_data(db, world, a, report=True, final=True)
    seed_data(db, world, b)
    d = detail(client, world)
    old_person = {"state", "feature", "raw", "total", "final_pending"}
    old_counts = {"total", "counted", "all_received", "in_progress", "needs_attention", "expected_unknown",
                  "not_collected", "final_pending"}
    for x in d["participants"]:
        assert set(x["progress"]) == old_person | {"abnormal_exit_suspected"}
    assert set(d["progress"]["participants"]) == old_counts | {"abnormal_exit_suspected"}
    it, top = overview_item(client, world)
    assert set(it["progress"]["participants"]) == old_counts | {"abnormal_exit_suspected"}
    assert set(top["progress"]["participants"]) == old_counts | {"abnormal_exit_suspected"}
    # 기존 상태 판정 값은 의심 여부와 무관하게 동일
    assert d["progress"]["participants"]["expected_unknown"] == 2 and d["progress"]["participants"]["all_received"] == 1


def test_V11_회원_본인_행(client, db, world):
    a, b, _ = world["participants"]
    seed_data(db, world, a, report=True, final=True)
    seed_data(db, world, b)
    old_keys = {"session_id", "class_id", "class_title", "session_title", "seq", "organization_name", "session_status",
                "started_at", "ended_at", "status", "collection_state", "progress_state", "final_pending", "percent",
                "bytes_arrived", "bytes_expected", "bytes_basis", "duration_min", "measured_min", "last_received_at"}
    for p, want, state in ((a, False, "all_received"), (b, True, "expected_unknown")):
        r = client.get(ME, headers=auth_for(db.get(User, p.user_id)))
        assert r.status_code == 200, r.text
        row = next(i for i in r.json()["items"] if i["session_id"] == str(world["session"].id))
        assert set(row) == old_keys | {"abnormal_exit_suspected"}
        assert row["abnormal_exit_suspected"] is want and row["progress_state"] == state


def test_설정_오버라이드_짧은_기한(client, db, world, monkeypatch):
    from app.config import settings
    world["session"].ended_at = NOW - timedelta(seconds=90)
    db.commit()
    seed_data(db, world, world["participants"][0], last_ago=60)
    assert detail(client, world)["progress"]["participants"]["abnormal_exit_suspected"] == 0
    detail_svc.clear_cache()
    monkeypatch.setattr(settings, "upload_abnormal_exit_after_sec", 60)
    assert detail(client, world)["progress"]["participants"]["abnormal_exit_suspected"] == 1


def test_ETag는_기한_경과_시점에_바뀐다(client, db, world, clock):
    world["session"].ended_at = NOW - timedelta(hours=23, minutes=59)
    db.commit()
    seed_data(db, world, world["participants"][0])
    path = f"/api/v1/classes/{world['cls'].id}/sessions/{world['session'].id}/upload-status"
    r1 = client.get(path, headers=world["auth"])
    clock["now"] = NOW + timedelta(minutes=2)
    r2 = client.get(path, headers={**world["auth"], "If-None-Match": r1.headers["ETag"]})
    assert r2.status_code == 200 and r2.json()["progress"]["participants"]["abnormal_exit_suspected"] == 1
