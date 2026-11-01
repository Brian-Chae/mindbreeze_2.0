"""SDD-265 T3~T5 — 목록 cursor 페이지네이션·가산 필드·needs_attention_only (V-R01~R24, R30, R41, R42, R44, R46).

정답은 독립 SQL/파이썬 계산으로 만든다.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from app.models.biosignal import BiosignalArtifact
from app.models.record import EEGRawChunk
from app.models.session import Session, SessionParticipant
from app.models.session_ingest_expected import SessionIngestExpected
from app.services import upload_status_overview_service as svc
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
    monkeypatch.setattr(svc, "_utcnow", lambda: NOW)
    for name in ("TTL_LIVE_SEC", "TTL_RECENT_SEC", "TTL_OLD_SEC"):
        monkeypatch.setattr(svc, name, 0.0)
    yield
    svc.clear_cache()


@pytest.fixture
def world(client, db):
    return build_class_world(db, members=3, status="completed", ended=True)


def get(client, headers, **params):
    r = client.get(URL, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def ids(body):
    return [it["session_id"] for it in body["items"]]


def make_sessions(db, world, n, *, base_hours=1, seq0=3000):
    out = []
    for i in range(n):
        s, parts = add_session(db, world, started=NOW - timedelta(hours=base_hours + i), seq=seq0 + i, members=2)
        out.append((s, parts))
    return out


def walk(client, headers, limit, **params):
    pages, cursor = [], None
    for _ in range(20):
        q = dict(params, limit=limit)
        if cursor:
            q["cursor"] = cursor
        body = get(client, headers, **q)
        pages.append(body)
        cursor = body["next_cursor"]
        if cursor is None:
            break
    return pages


# ── A. cursor ────────────────────────────────────────────────────
def test_V_R01_R02_R03_페이지_순회(client, world, db):
    make_sessions(db, world, 24)   # world 기본 회차 1개 + 24 = 25
    full = get(client, world["auth"], limit=50)
    pages = walk(client, world["auth"], 10)
    assert [len(p["items"]) for p in pages] == [10, 10, 5]
    assert [p["has_more"] for p in pages] == [True, True, False]
    assert pages[-1]["next_cursor"] is None and pages[0]["next_cursor"]
    flat = [sid for p in pages for sid in ids(p)]
    assert flat == ids(full) and len(set(flat)) == 25


def test_V_R04_진행_중_회차가_경계에_걸려도_순서_유지(client, world, db):
    rows = make_sessions(db, world, 14)
    live, _ = add_session(db, world, status="in_progress", started=NOW - timedelta(days=5), seq=9001, members=1)
    full = ids(get(client, world["auth"], limit=50))
    assert full[0] == str(live.id)
    flat = [sid for p in walk(client, world["auth"], 5) for sid in ids(p)]
    assert flat == full


def test_V_R05_새_회차가_끼어도_이미_본_항목은_중복되지_않는다(client, world, db):
    make_sessions(db, world, 14)
    first = get(client, world["auth"], limit=5)
    add_session(db, world, started=NOW - timedelta(minutes=5), seq=9100, members=1)   # 가장 최신
    second = get(client, world["auth"], limit=5, cursor=first["next_cursor"])
    assert not set(ids(first)) & set(ids(second))
    assert len(second["items"]) == 5


def test_V_R06_같은_시각_회차도_경계에서_중복_누락_없음(client, world, db):
    t = NOW - timedelta(hours=3)
    for i in range(7):
        add_session(db, world, started=t, seq=9200 + i, members=1)
    full = ids(get(client, world["auth"], limit=50))
    flat = [sid for p in walk(client, world["auth"], 3) for sid in ids(p)]
    assert flat == full and len(set(flat)) == len(full)


@pytest.mark.parametrize("bad", ["!!!", "abc", "e30", "WzEsIngiLCJ4Il0"])
def test_V_R07_잘못된_cursor_422(client, world, bad):
    r = client.get(URL, headers=world["auth"], params={"cursor": bad})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "upload_status_invalid_cursor"


def test_V_R08_total_candidates는_cursor와_무관(client, world, db):
    make_sessions(db, world, 14)
    pages = walk(client, world["auth"], 5)
    assert {p["total_candidates"] for p in pages} == {15}


def test_V_R09_limit_기본값은_30(client, world, db):
    make_sessions(db, world, 34)
    body = get(client, world["auth"])
    assert body["limit"] == 30 and len(body["items"]) == 30 and body["has_more"] and body["truncated"]


def test_V_R10_다른_코치는_cursor로도_타인_회차를_못_본다(client, world, db):
    from tests.sdd237_helpers import auth_for, make_user

    make_sessions(db, world, 6)
    cursor = get(client, world["auth"], limit=2)["next_cursor"]
    other = make_user(db, name="다른 코치", org=world["org"])
    body = get(client, auth_for(other), limit=10, cursor=cursor)
    assert body["items"] == [] and body["has_more"] is False


# ── B. needs_attention_only ─────────────────────────────────────
def mark_attention(db, pair):
    s, parts = pair
    add_raw(db, s, parts[0], "eeg", [0], status="failed")


def test_V_R11_확인할_곳이_뒤에_있어도_첫_화면에_올라온다(client, world, db):
    rows = make_sessions(db, world, 59)
    for i in (7, 34, 54):
        mark_attention(db, rows[i])
    body = get(client, world["auth"], limit=10, needs_attention_only="true")
    got = set(ids(body))
    assert got == {str(rows[i][0].id) for i in (7, 34, 54)}
    assert all(it["status"] == "needs_attention" for it in body["items"])
    assert body["has_more"] is False and body["scan_limited"] is False


def test_V_R12_확인할_곳이_많으면_cursor로_이어진다(client, world, db):
    rows = make_sessions(db, world, 30)
    for pair in rows[:25]:
        mark_attention(db, pair)
    pages = walk(client, world["auth"], 10, needs_attention_only="true")
    assert [len(p["items"]) for p in pages] == [10, 10, 5]
    flat = [sid for p in pages for sid in ids(p)]
    assert len(set(flat)) == 25


def test_V_R13_없으면_빈_목록(client, world, db):
    make_sessions(db, world, 5)
    body = get(client, world["auth"], needs_attention_only="true")
    assert body["items"] == [] and body["has_more"] is False and body["next_cursor"] is None


def test_V_R14_스캔_상한에서_멈추면_scan_limited로_이어서_조회(client, world, db, monkeypatch):
    monkeypatch.setattr(svc, "SCAN_BATCH", 5)
    monkeypatch.setattr(svc, "MAX_SCAN_BATCHES", 2)
    rows = make_sessions(db, world, 29)
    mark_attention(db, rows[28])           # 최후미: 첫 응답 스캔 범위(10건) 밖
    first = get(client, world["auth"], limit=10, needs_attention_only="true")
    assert first["items"] == [] and first["scan_limited"] is True and first["next_cursor"]
    found, cursor = [], first["next_cursor"]
    for _ in range(10):
        body = get(client, world["auth"], limit=10, needs_attention_only="true", cursor=cursor)
        found += ids(body)
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert found == [str(rows[28][0].id)]


def test_V_R15_status와_needs_attention_only_동시_422(client, world):
    r = client.get(URL, headers=world["auth"], params={"status": "needs_attention", "needs_attention_only": "true"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "upload_status_filter_conflict"


def test_V_R16_status_단독은_후보_안_사후_필터_의미_유지(client, world, db):
    rows = make_sessions(db, world, 14)
    mark_attention(db, rows[12])           # 13번째 → limit=10 후보 밖
    body = get(client, world["auth"], limit=10, status="needs_attention")
    assert body["items"] == []


# ── C. 데이터 크기 ───────────────────────────────────────────────
def add_sized(db, s, part, signal, sizes, *, status="uploaded", start=0):
    for i, size in enumerate(sizes, start=start):
        db.add(EEGRawChunk(
            id=uuid.uuid4(), session_id=s.id, participant_id=part.id, user_id=part.user_id, stream_id="s1",
            segment_id="seg1", signal_type=signal, chunk_index=i, object_key=f"k/{uuid.uuid4().hex}",
            upload_status=status, size_bytes=size, created_at=NOW - timedelta(seconds=30),
            uploaded_at=NOW - timedelta(seconds=20) if status == "uploaded" else None))
    db.commit()


def add_artifact(db, s, part, kind, size, rows, *, status="uploaded", seq=0, alias=None):
    db.add(BiosignalArtifact(
        id=uuid.uuid4(), session_id=s.id, participant_id=part.id, artifact_alias=alias or f"a{uuid.uuid4().hex[:10]}",
        artifact_kind=kind, sequence=seq, row_count=rows, schema_version="v1", checksum="0" * 64, size_bytes=size,
        retention_class="feature", object_key=f"o/{uuid.uuid4().hex}", upload_status=status))
    db.commit()


def item_for(client, headers, s):
    return next(it for it in get(client, headers, limit=50)["items"] if it["session_id"] == str(s.id))


def test_V_R17_도착_바이트는_독립_SUM과_일치(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=4000, members=3)
    add_sized(db, s, parts[0], "eeg", [100, 200, 300])
    add_sized(db, s, parts[1], "ppg", [50, 50])
    add_sized(db, s, parts[2], "acc", [7])
    add_artifact(db, s, parts[0], "feature", 1000, 60)
    add_artifact(db, s, parts[1], "indices", 33, 1)
    expected = db.execute(sa.text(
        "select coalesce((select sum(size_bytes) from eeg_raw_chunks where session_id=:s and upload_status='uploaded'),0)"
        " + coalesce((select sum(size_bytes) from biosignal_artifacts where session_id=:s and upload_status='uploaded'),0)"),
        {"s": str(s.id)}).scalar()
    assert expected == 100 + 200 + 300 + 100 + 7 + 1000 + 33
    assert item_for(client, world["auth"], s)["bytes_arrived"] == expected


def test_V_R18_R19_pending_failed_는_합산하지_않는다(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=4001, members=1)
    add_sized(db, s, parts[0], "eeg", [100])
    add_sized(db, s, parts[0], "eeg", [999], status="pending", start=10)
    add_sized(db, s, parts[0], "eeg", [888], status="failed", start=20)
    add_artifact(db, s, parts[0], "feature", 500, 10)
    add_artifact(db, s, parts[0], "feature", 777, 10, status="pending", seq=1)
    add_artifact(db, s, parts[0], "feature", 666, 10, status="failed", seq=2)
    assert item_for(client, world["auth"], s)["bytes_arrived"] == 600


def test_V_R20_크기_NULL_청크는_0(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=4002, members=1)
    add_sized(db, s, parts[0], "eeg", [100, None, 50])
    assert item_for(client, world["auth"], s)["bytes_arrived"] == 150


def test_V_R21_기대_바이트는_평균_청크_기반_추정(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=4003, members=1)
    p = parts[0]
    add_sized(db, s, p, "eeg", [100] * 10)
    add_sized(db, s, p, "ppg", [40] * 5)
    add_sized(db, s, p, "acc", [20] * 5)
    add_artifact(db, s, p, "feature", 1000, 100)
    add_features(db, s, p, list(range(100)))
    db.add(SessionIngestExpected(session_id=s.id, participant_id=p.id, feature=200,
                                 raw_eeg=20, raw_ppg=5, raw_acc=10, final=False,
                                 first_reported_at=NOW - timedelta(minutes=5),
                                 reported_at=NOW - timedelta(minutes=1), updated_at=NOW - timedelta(minutes=1)))
    db.commit()
    it = item_for(client, world["auth"], s)
    arrived = 1000 + 200 + 100 + 1000
    expected = 20 * 100 + 5 * 40 + 10 * 20 + 1000 * 200 // 100
    assert it["bytes_arrived"] == arrived and it["bytes_expected"] == expected and it["bytes_basis"] == "estimate"


def test_V_R22_V_R23_기대_미보고_또는_도착_없음은_null(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=4004, members=1)
    add_sized(db, s, parts[0], "eeg", [100])
    it = item_for(client, world["auth"], s)
    assert it["bytes_expected"] is None and it["bytes_basis"] is None
    empty, _ = add_session(db, world, started=NOW - timedelta(hours=3), seq=4005, members=1)
    it2 = item_for(client, world["auth"], empty)
    assert it2["bytes_arrived"] == 0 and it2["bytes_expected"] is None


def test_V_R24_수집_제외_참여자의_도착_바이트는_합산에_포함(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=4006, members=3)
    parts[1].eeg_collection_consented = False   # 데이터가 이미 도착한 뒤 제외 → 상태는 도착 기록 유지
    parts[2].eeg_collection_consented = False   # 도착 기록 없음 → 수집 제외(분모에서 뺌)
    db.commit()
    add_sized(db, s, parts[0], "eeg", [10])
    add_sized(db, s, parts[1], "eeg", [90])
    it = item_for(client, world["auth"], s)
    assert it["bytes_arrived"] == 100
    assert it["excluded"] == 1 and it["participants_expected"] == 2 and it["participants_arrived"] == 2


# ── D. 길이·인원 ─────────────────────────────────────────────────
def test_V_R25_길이_52분(client, world, db):
    s, _ = add_session(db, world, started=NOW - timedelta(hours=3), seq=4100, members=1)
    s.ended_at = s.started_at + timedelta(minutes=52)
    db.commit()
    assert item_for(client, world["auth"], s)["duration_min"] == 52


def test_V_R26_진행_중은_경과(client, world, db):
    s, _ = add_session(db, world, status="in_progress", started=NOW - timedelta(minutes=17), seq=4101, members=1)
    assert item_for(client, world["auth"], s)["duration_min"] == 17


def test_V_R28_종료_시각_없는_완료는_null(client, world, db):
    s, _ = add_session(db, world, started=NOW - timedelta(hours=3), seq=4102, members=1)
    s.ended_at = None
    db.commit()
    assert item_for(client, world["auth"], s)["duration_min"] is None


def test_V_R29_V_R30_참여자_분_합계와_도착_인원(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=4200, members=4)
    parts[3].eeg_collection_consented = False   # 제외
    db.commit()
    add_features(db, s, parts[0], list(range(3600)))
    add_features(db, s, parts[1], list(range(1800)))
    # parts[2] 는 미도착
    it = item_for(client, world["auth"], s)
    assert it["participant_minutes_total"] == 5400 // 60
    assert it["participants"] == 4 and it["participants_expected"] == 3 and it["participants_arrived"] == 2


# ── F. 회귀·성능·표현 ────────────────────────────────────────────
def test_V_R41_기존_필드_값은_불변(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=4300, members=2)
    add_features(db, s, parts[0], [1, 2, 3])
    it = item_for(client, world["auth"], s)
    assert it["participants"] == 2 and it["received_unreconciled"] == 1 and it["no_data"] == 1
    assert it["status"] == "received_unreconciled" and it["last_received_at"] is not None


def test_V_R42_쿼리_수는_회차_참여자_수와_무관(client, world, db):
    from sqlalchemy import event

    actor = {"id": str(world["host"].id), "role": "counselor"}

    def count(**kw):
        svc.clear_cache()
        n = {"n": 0}
        engine = db.get_bind()
        hook = lambda *a, **k: n.__setitem__("n", n["n"] + 1)  # noqa: E731
        event.listen(engine, "before_cursor_execute", hook)
        try:
            svc.load_overview(db, actor, **kw)
        finally:
            event.remove(engine, "before_cursor_execute", hook)
        return n["n"]

    make_sessions(db, world, 2)
    few = count(limit=10)
    make_sessions(db, world, 30, seq0=5000)
    many = count(limit=10)
    page2 = count(limit=10, cursor=get(client, world["auth"], limit=10)["next_cursor"])
    assert few == many == page2 <= 6, (few, many, page2)


def test_V_R44_304_헤더_유지_cursor_페이지(client, world, db):
    make_sessions(db, world, 14)
    cursor = get(client, world["auth"], limit=5)["next_cursor"]
    r = client.get(URL, headers=world["auth"], params={"limit": 5, "cursor": cursor})
    etag = r.headers["ETag"]
    r2 = client.get(URL, headers={**world["auth"], "If-None-Match": etag}, params={"limit": 5, "cursor": cursor})
    assert r2.status_code == 304 and r2.content == b""
    assert {"etag", "cache-control", "vary", "x-poll-interval"} <= {h.lower() for h in r2.headers}


def test_V_R44_바이트_변화만으로도_ETag_변경(client, world, db):
    s, parts = add_session(db, world, started=NOW - timedelta(hours=2), seq=4400, members=1)
    add_sized(db, s, parts[0], "eeg", [10])
    etag = client.get(URL, headers=world["auth"]).headers["ETag"]
    add_sized(db, s, parts[0], "eeg", [10], start=5)
    r = client.get(URL, headers={**world["auth"], "If-None-Match": etag})
    assert r.status_code == 200 and r.headers["ETag"] != etag


def test_V_R46_응답에_금지어_없음(client, world, db):
    rows = make_sessions(db, world, 3)
    mark_attention(db, rows[0])
    body = get(client, world["auth"], limit=10)
    text = json.dumps({k: v for k, v in body.items()}, ensure_ascii=False).lower()
    import re

    text = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "", text)
    for banned in ("score", "점수", "완료", "100%", "보증", "guarantee", "좋음", "나쁨"):
        assert banned not in text, banned
