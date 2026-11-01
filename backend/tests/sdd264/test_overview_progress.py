"""SDD-264 B6 — 전체 회차 목록(SDD-263)에 회차별·전체 progress 가산 (V-X9, X39, X42, X52).

상세(SDD-261) 응답의 합계와 목록 항목의 합계가 같은 입력에서 같은 값이어야 한다(공용 aggregate).
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.session_ingest_expected import SessionIngestExpected
from app.services import upload_status_overview_service as svc
from app.services import upload_status_service as detail_svc
from tests.sdd237_helpers import build_class_world
from tests.test_upload_status import add_features, add_raw
from tests.test_upload_status_overview import URL, add_session

NOW = datetime(2026, 11, 4, 5, 10, 0, tzinfo=timezone.utc)


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
    svc.clear_cache()
    detail_svc.clear_cache()
    monkeypatch.setattr(svc, "_utcnow", lambda: NOW)
    monkeypatch.setattr(detail_svc, "_utcnow", lambda: NOW)
    monkeypatch.setattr(detail_svc, "CACHE_TTL_SEC", 0.0)
    for name in ("TTL_LIVE_SEC", "TTL_RECENT_SEC", "TTL_OLD_SEC"):
        monkeypatch.setattr(svc, name, 0.0)
    yield
    svc.clear_cache()
    detail_svc.clear_cache()


@pytest.fixture
def world(client, db):
    return build_class_world(db, members=3, status="in_progress", ended=False)


def report(db, session, p, feature, eeg=0, ppg=0, acc=0, *, final=True):
    t = NOW - timedelta(seconds=8)
    db.add(SessionIngestExpected(participant_id=p.id, session_id=session.id, feature=feature, raw_eeg=eeg,
                                 raw_ppg=ppg, raw_acc=acc, final=final, first_reported_at=t - timedelta(seconds=30),
                                 reported_at=t, updated_at=t))
    db.commit()


def overview(client, w, **headers):
    r = client.get(URL, headers=w["auth"] if not headers else headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_V_X39_목록_항목_합계가_상세_합계와_같다(client, db, world):
    s, ps = world["session"], world["participants"]
    for p, got, exp in zip(ps, (10, 20, 3), (10, 20, 9)):
        add_features(db, s, p, range(got))
        report(db, s, p, exp, 0, 0, 0)
    add_raw(db, s, ps[0], "eeg", range(4))
    report_row = db.get(SessionIngestExpected, ps[0].id)
    report_row.raw_eeg = 5
    db.commit()

    body = overview(client, world)
    item = next(i for i in body["items"] if i["session_id"] == str(s.id))
    detail = client.get(f"/api/v1/classes/{world['cls'].id}/sessions/{s.id}/upload-status", headers=world["auth"]).json()
    assert item["progress"] == detail["progress"]
    # 수신 10/20/3 · 기대 10/20/9 → 상한 후 합 33, 33/39 = 84.6 (내림)
    assert item["progress"]["feature"] == {"expected": 39, "received": 33, "percent": 84.6}
    assert item["progress"]["raw"]["eeg"] == {"expected": 5, "received": 4, "percent": 80.0}
    assert item["progress"]["participants"]["total"] == 3


def test_최상위_progress_는_items_합계(client, db, world):
    s1, ps1 = world["session"], world["participants"]
    add_features(db, s1, ps1[0], range(5))
    report(db, s1, ps1[0], 10)
    s2, ps2 = add_session(db, world, status="completed", members=2)
    for p in ps2:
        add_features(db, s2, p, range(7))
        report(db, s2, p, 7)

    body = overview(client, world)
    assert len(body["items"]) == 2
    top = body["progress"]
    assert top["feature"]["expected"] == sum(i["progress"]["feature"]["expected"] or 0 for i in body["items"]) == 24
    assert top["feature"]["received"] == sum(i["progress"]["feature"]["received"] for i in body["items"]) == 19
    assert top["feature"]["percent"] == 79.1
    assert top["participants"]["total"] == sum(i["participants"] for i in body["items"]) == 5
    assert top["participants"]["expected_unknown"] == 2          # s1 의 보고 없는 2명


def test_보고_없는_회차는_기대량_미확인으로_세고_수치는_null(client, db, world):
    body = overview(client, world)
    p = body["items"][0]["progress"]
    assert p["participants"]["expected_unknown"] == 3 and p["participants"]["counted"] == 3
    assert p["feature"] == {"expected": None, "received": 0, "percent": None}
    assert body["progress"]["overall"]["percent"] is None


def test_V_X42_목록_응답에도_금지_문구_없음(client, db, world):
    s, ps = world["session"], world["participants"]
    add_features(db, s, ps[0], range(5))
    report(db, s, ps[0], 5, 1, 1, 1)
    import re

    text = json.dumps(overview(client, world), ensure_ascii=False).lower()
    text = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<id>", text)
    for banned in ("score", "점수", "완료", "100%", "보증", "complete", "guarantee"):
        assert banned not in text, banned


def test_V_X52_기대량_보고만으로_목록_ETag_변경(client, db, world):
    s, ps = world["session"], world["participants"]
    add_features(db, s, ps[0], range(5))
    r1 = client.get(URL, headers=world["auth"])
    e1 = r1.headers["ETag"]
    assert client.get(URL, headers={**world["auth"], "If-None-Match": e1}).status_code == 304
    report(db, s, ps[0], 5)
    r2 = client.get(URL, headers={**world["auth"], "If-None-Match": e1})
    assert r2.status_code == 200 and r2.headers["ETag"] != e1


def test_V_X50_쿼리_수는_회차_참여자_수와_무관(client, db, world):
    from sqlalchemy import event

    for _ in range(4):
        s, ps = add_session(db, world, status="completed", members=5)
        for p in ps:
            report(db, s, p, 3)

    counter = {"n": 0}

    def on_exec(*_a, **_k):
        counter["n"] += 1

    actor = {"id": str(world["host"].id), "role": "counselor"}   # 만료 객체 refresh 쿼리가 카운트에 끼지 않게 먼저 읽는다
    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", on_exec)
    try:
        svc.load_overview(db, actor)
    finally:
        event.remove(engine, "before_cursor_execute", on_exec)
    # 후보 1 + 참여자 1 + feature 1 + raw 1 + 기대량 1 + (SDD-265) 도착 크기 1 = 6
    assert counter["n"] <= 6, counter["n"]


def test_V_X9_권한_비담당_코치는_빈_목록_progress_도_비어있다(client, db, world):
    from tests.sdd237_helpers import auth_for, make_user

    other = make_user(db, name="다른 코치", org=world["org"])
    db.commit()
    r = client.get(URL, headers=auth_for(other))
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["progress"]["participants"]["total"] == 0
    assert body["progress"]["overall"] == {"expected": None, "received": 0, "percent": None}
