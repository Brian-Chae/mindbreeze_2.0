"""SDD-264 B5 — 회차 상세(SDD-261) 응답에 기대량·progress 가산 (V-X1, X2, X13, X23~X26, X39, X40, X42, X52).

정답은 독립 SQL COUNT/파이썬 계산으로 만든다.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from app.models.session_ingest_expected import SessionIngestExpected
from app.services import upload_status_service as svc
from tests.sdd237_helpers import auth_for, build_class_world

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
def _fixed_clock(monkeypatch):
    svc.clear_cache()
    monkeypatch.setattr(svc, "CACHE_TTL_SEC", 0.0)
    monkeypatch.setattr(svc, "_utcnow", lambda: NOW)
    yield
    svc.clear_cache()


@pytest.fixture
def world(client, db):
    return build_class_world(db, members=3, status="in_progress", ended=False)


def url(w):
    return f"/api/v1/classes/{w['cls'].id}/sessions/{w['session'].id}/upload-status"


def add_features(db, w, p, n, *, created=NOW - timedelta(seconds=5)):
    for i in range(n):
        db.add(EEGFeatureWindow(id=uuid.uuid4(), session_id=w["session"].id, participant_id=p.id, user_id=p.user_id,
                                play_group_id="pg-1", window_index=i, quality="valid", created_at=created))
    db.commit()


def add_raw(db, w, p, signal, n, *, status="uploaded"):
    for i in range(n):
        db.add(EEGRawChunk(id=uuid.uuid4(), session_id=w["session"].id, participant_id=p.id, user_id=p.user_id,
                           stream_id="s1", segment_id="seg1", signal_type=signal, chunk_index=i,
                           object_key=f"k/{uuid.uuid4().hex}", upload_status=status,
                           created_at=NOW - timedelta(seconds=30),
                           uploaded_at=NOW - timedelta(seconds=10) if status == "uploaded" else None))
    db.commit()


def report(db, w, p, feature, eeg, ppg, acc, *, final=False, first=NOW - timedelta(seconds=40),
           updated=NOW - timedelta(seconds=8)):
    db.add(SessionIngestExpected(participant_id=p.id, session_id=w["session"].id, feature=feature, raw_eeg=eeg,
                                 raw_ppg=ppg, raw_acc=acc, final=final, first_reported_at=first,
                                 reported_at=updated, updated_at=updated))
    db.commit()


def body_of(client, w):
    r = client.get(url(w), headers=w["auth"])
    assert r.status_code == 200, r.text
    return r.json()


def row(body, p):
    return next(x for x in body["participants"] if x["participant_id"] == str(p.id))


def test_V_X1_V_X2_기대와_수신이_독립_COUNT_와_일치(client, db, world):
    p = world["participants"][0]
    add_features(db, world, p, 60)
    add_raw(db, world, p, "eeg", 30)
    add_raw(db, world, p, "eeg", 0)
    # pending/failed 는 수신이 아니다 (chunk_index 겹치지 않게 별도 stream)
    for i, st in enumerate(["pending"] * 10 + ["failed"] * 2):
        db.add(EEGRawChunk(id=uuid.uuid4(), session_id=world["session"].id, participant_id=p.id, user_id=p.user_id,
                           stream_id="s2", segment_id="seg2", signal_type="eeg", chunk_index=i,
                           object_key=f"k/{uuid.uuid4().hex}", upload_status=st, created_at=NOW - timedelta(seconds=5)))
    db.commit()
    report(db, world, p, 100, 50, 0, 0)
    r = row(body_of(client, world), p)

    n_feat = db.execute(sa.select(sa.func.count()).select_from(EEGFeatureWindow)
                        .where(EEGFeatureWindow.participant_id == p.id)).scalar()
    n_eeg_up = db.execute(sa.select(sa.func.count()).select_from(EEGRawChunk).where(
        EEGRawChunk.participant_id == p.id, EEGRawChunk.signal_type == "eeg",
        EEGRawChunk.upload_status == "uploaded")).scalar()
    assert (n_feat, n_eeg_up) == (60, 30)
    assert r["feature"]["received"] == n_feat and r["feature"]["expected"] == 100
    assert r["feature"]["expected_basis"] == "phone_report" and r["feature"]["completeness"] == "short"
    eeg = next(s for s in r["raw"]["signals"] if s["signal_type"] == "eeg")
    assert eeg["expected"] == 50 and eeg["uploaded"] == n_eeg_up
    assert r["progress"]["raw"]["eeg"] == {"expected": 50, "received": 30, "percent": 60.0}
    assert r["progress"]["feature"] == {"expected": 100, "received": 60, "percent": 60.0}


def test_보고_없으면_기존_값_그대로(client, db, world):
    p = world["participants"][0]
    add_features(db, world, p, 4)
    b = body_of(client, world)
    r = row(b, p)
    assert r["feature"]["expected"] is None and r["feature"]["expected_basis"] == "unknown"
    assert r["feature"]["completeness"] == "unknown" and r["raw"]["completeness"] == "unknown"
    assert r["phone_report"] is None
    assert all(s["expected"] is None for s in r["raw"]["signals"])
    assert r["progress"]["state"] == "expected_unknown" and r["progress"]["feature"]["received"] == 4
    assert b["progress"]["participants"]["expected_unknown"] == 3


def test_phone_report_는_reported_at_과_final(client, db, world):
    p = world["participants"][0]
    report(db, world, p, 10, 0, 0, 0, final=True, updated=NOW - timedelta(seconds=7))
    r = row(body_of(client, world), p)
    assert r["phone_report"] == {"reported_at": "2026-11-04T05:09:53Z", "final": True}
    assert r["raw"]["completeness"] == "all_received"      # 0/0/0 ≤ 수신 0


def test_V_X40_M_of_N_독립_계산과_일치(client, db, world):
    a, b, c = world["participants"]
    report(db, world, a, 5, 0, 0, 0, final=True)
    add_features(db, world, a, 5)
    report(db, world, b, 5, 0, 0, 0, final=True)
    add_features(db, world, b, 3)
    c.eeg_collection_consented = False                   # 수집 제외 + 수신 0 → not_collected
    db.commit()
    body = body_of(client, world)
    parts = body["progress"]["participants"]
    states = [x["progress"]["state"] for x in body["participants"]]
    assert states.count("all_received") == parts["all_received"] == 1
    assert parts["total"] == 3 and parts["not_collected"] == 1 and parts["counted"] == 2
    assert parts["all_received"] + parts["in_progress"] + parts["needs_attention"] + parts["expected_unknown"] == 2
    assert body["progress"]["feature"] == {"expected": 10, "received": 8, "percent": 80.0}


def test_V_X26_수집제외인데_수신_있으면_not_collected_아님(client, db, world):
    a = world["participants"][0]
    a.eeg_collection_consented = False
    db.commit()
    add_features(db, world, a, 2)
    r = row(body_of(client, world), a)
    assert r["progress"]["state"] != "not_collected"
    assert "collection_excluded_now" in r["reasons"]


def test_기존_status_reasons_는_기대량과_독립(client, db, world):
    p = world["participants"][0]
    add_features(db, world, p, 5)
    before = row(body_of(client, world), p)
    report(db, world, p, 5, 0, 0, 0, final=True)
    svc.clear_cache()
    after = row(body_of(client, world), p)
    assert (before["status"], before["reasons"]) == (after["status"], after["reasons"]) == ("received_unreconciled", [])
    assert after["progress"]["state"] == "all_received"


def test_V_X13_추가된_값은_개인정보_없음_숫자_불리언_시각_enum만(client, db, world):
    p = world["participants"][0]
    add_features(db, world, p, 2)
    report(db, world, p, 2, 1, 1, 1, final=True)
    b = body_of(client, world)

    def walk(node, path=""):
        if isinstance(node, dict):
            for k, v in node.items():
                yield from walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for v in node:
                yield from walk(v, path)
        else:
            yield path, node

    for path, value in walk(b["progress"]):
        assert value is None or isinstance(value, (int, float, bool)) or path.endswith(".state"), path
    for path, value in walk(row(b, p)["progress"]):
        assert value is None or isinstance(value, (int, float, bool)) or path.endswith(".state"), path


def test_V_X42_응답_전체에_금지_문구_없음(client, db, world):
    p = world["participants"][0]
    add_features(db, world, p, 5)
    report(db, world, p, 5, 1, 1, 1, final=True)
    text = json.dumps(body_of(client, world), ensure_ascii=False).lower()
    for banned in ("score", "점수", "완료", "100%", "보증", "guarantee", "good", "bad"):
        assert banned not in text, banned
    assert "\"complete\"" not in text


def test_V_X52_기대량만_바뀌어도_ETag_변경_그대로면_304(client, db, world):
    p = world["participants"][0]
    add_features(db, world, p, 5)
    r1 = client.get(url(world), headers=world["auth"])
    etag1 = r1.headers["ETag"]
    r304 = client.get(url(world), headers={**world["auth"], "If-None-Match": etag1})
    assert r304.status_code == 304
    report(db, world, p, 5, 0, 0, 0)
    r2 = client.get(url(world), headers={**world["auth"], "If-None-Match": etag1})
    assert r2.status_code == 200 and r2.headers["ETag"] != etag1
    etag2 = r2.headers["ETag"]
    # 값 증가 / final 전환 모두 ETag 를 바꾼다
    row_ = db.get(SessionIngestExpected, p.id)
    row_.final = True
    row_.updated_at = NOW - timedelta(seconds=1)
    db.commit()
    r3 = client.get(url(world), headers={**world["auth"], "If-None-Match": etag2})
    assert r3.status_code == 200 and r3.headers["ETag"] != etag2


def test_정체_판정은_시간_경과로_바뀌므로_ETag_가_따라_바뀐다(client, db, world, monkeypatch):
    p = world["participants"][0]
    add_features(db, world, p, 5, created=NOW - timedelta(seconds=10))
    report(db, world, p, 10, 0, 0, 0)
    e1 = client.get(url(world), headers=world["auth"]).headers["ETag"]
    monkeypatch.setattr(svc, "_utcnow", lambda: NOW + timedelta(seconds=200))
    svc.clear_cache()
    r = client.get(url(world), headers={**world["auth"], "If-None-Match": e1})
    assert r.status_code == 200
    assert row(r.json(), p)["progress"]["state"] == "needs_attention"      # 마지막 수신 후 120초 이상


def test_V_X39_합계는_참여자_progress_로_독립_계산한_값과_같다(client, db, world):
    a, b, c = world["participants"]
    for p, f, e in ((a, 7, 10), (b, 20, 20), (c, 3, 9)):
        add_features(db, world, p, f)
        report(db, world, p, e, 0, 0, 0)
    body = body_of(client, world)
    exp = sum(x["progress"]["feature"]["expected"] for x in body["participants"])
    rec = sum(min(x["progress"]["feature"]["received"], x["progress"]["feature"]["expected"])
              for x in body["participants"])
    assert (body["progress"]["feature"]["expected"], body["progress"]["feature"]["received"]) == (exp, rec) == (39, 30)
    assert body["progress"]["feature"]["percent"] == 76.9
    assert body["progress"]["overall"]["expected"] == 39
