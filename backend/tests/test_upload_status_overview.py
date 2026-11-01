"""SDD-263 BE — 전체 회차 업로드 현황 목록 API (V-O01~O31).

정답은 독립 SQL/파이썬 계산과 SDD-261 상세 API 로 만든다.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from app.models.class_program import Class, ClassInstructor
from app.models.organization import Organization
from app.models.session import Session, SessionParticipant
from app.services import upload_status_overview_service as svc
from tests.sdd237_helpers import auth_for, build_class_world, make_user
from tests.test_upload_status import add_features, add_raw

NOW = datetime(2026, 11, 4, 5, 10, 0, tzinfo=timezone.utc)
URL = "/api/v1/upload-status/overview"


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
    monkeypatch.setattr(svc, "TTL_LIVE_SEC", 0.0)
    monkeypatch.setattr(svc, "TTL_RECENT_SEC", 0.0)
    monkeypatch.setattr(svc, "TTL_OLD_SEC", 0.0)
    yield
    svc.clear_cache()


@pytest.fixture
def world(client, db):
    return build_class_world(db, members=3, status="in_progress", ended=False)


_seq = [100]


def add_session(db, w, *, status="completed", started=None, host=None, cls=None, seq=None, members=0, **kw):
    if seq is None:
        _seq[0] += 1
        seq = _seq[0]
    s = Session(id=uuid.uuid4(), type="meditation", status=status, host_id=(host or w["host"]).id,
                class_id=(cls or w["cls"]).id, seq=seq, duration_min=45,
                started_at=started or NOW - timedelta(days=1),
                ended_at=(started or NOW - timedelta(days=1)) + timedelta(minutes=45) if status == "completed" else None,
                **kw)
    db.add(s)
    db.flush()
    parts = []
    for i in range(members):
        parts.append(SessionParticipant(id=uuid.uuid4(), session_id=s.id, guest_name=f"게스트{i}", report_included=True))
    db.add_all(parts)
    db.commit()
    return s, parts


def get(client, headers, **params):
    r = client.get(URL, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def sids(body):
    return [it["session_id"] for it in body["items"]]


def other_org_world(db):
    org = Organization(id=uuid.uuid4(), name="타기관", kind="center", org_code=uuid.uuid4().hex[:6])
    db.add(org)
    db.flush()
    host = make_user(db, org=org)
    cls = Class(id=uuid.uuid4(), organization_id=org.id, created_by=host.id, title="타기관 클래스", status="active",
                organization_attribution_known=True, default_duration_min=45)
    db.add(cls)
    db.flush()
    s = Session(id=uuid.uuid4(), type="meditation", status="completed", host_id=host.id, class_id=cls.id, seq=1,
                duration_min=45, started_at=NOW - timedelta(days=2), ended_at=NOW - timedelta(days=2, hours=-1))
    db.add(s)
    db.commit()
    return {"org": org, "host": host, "cls": cls, "session": s}


# ── 권한 ──────────────────────────────────────────────────────────
def test_V_O01_담당_코치는_host_회차만(client, world, db):
    mine, _ = add_session(db, world)
    other = make_user(db, org=world["org"])
    foreign, _ = add_session(db, world, host=other)
    body = get(client, world["auth"])
    assert str(mine.id) in sids(body) and str(world["session"].id) in sids(body)
    assert str(foreign.id) not in sids(body)


def test_V_O02_비담당_코치는_빈_목록(client, world, db):
    other = make_user(db, org=world["org"])
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=world["cls"].id, user_id=other.id, role="lead"))
    db.commit()
    body = get(client, auth_for(other))
    assert body["items"] == [] and body["total_candidates"] == 0


def test_V_O03_org_admin_자기_기관만(client, world, db):
    foreign = other_org_world(db)
    admin = make_user(db, role="org_admin", org=world["org"])
    db.commit()
    body = get(client, auth_for(admin))
    assert str(world["session"].id) in sids(body)
    assert str(foreign["session"].id) not in sids(body)


def test_V_O04_org_admin_타기관_org_id는_404(client, world, db):
    foreign = other_org_world(db)
    admin = make_user(db, role="org_admin", org=world["org"])
    db.commit()
    r = client.get(URL, headers=auth_for(admin), params={"org_id": str(foreign["org"].id)})
    assert r.status_code == 404
    assert r.json()["detail"] == {"code": "upload_status_not_found"}
    assert str(foreign["session"].id) not in r.text
    assert client.get(URL, headers=auth_for(admin), params={"org_id": str(world["org"].id)}).status_code == 200


def test_V_O05_platform_admin_전체와_기관_필터(client, world, db):
    foreign = other_org_world(db)
    pa = make_user(db, role="platform_admin")
    db.commit()
    both = sids(get(client, auth_for(pa)))
    assert str(world["session"].id) in both and str(foreign["session"].id) in both
    only = sids(get(client, auth_for(pa), org_id=str(foreign["org"].id)))
    assert only == [str(foreign["session"].id)]


def test_V_O06_client_403_미인증_401_비활성_차단(client, world, db):
    from app.core.security import create_access_token

    h = {"Authorization": f"Bearer {create_access_token(str(world['participants'][0].user_id))}"}
    r = client.get(URL, headers=h)
    assert r.status_code == 403 and r.json()["detail"] == {"code": "upload_status_forbidden"}
    assert client.get(URL).status_code == 401
    world["host"].status = "suspended"
    db.commit()
    assert client.get(URL, headers=world["auth"]).status_code in (401, 403)


def test_V_O07_membership_탈퇴_기관_비활성은_0건(client, world, db):
    from app.models.user_org_membership import UserOrgMembership

    db.query(UserOrgMembership).filter(UserOrgMembership.user_id == world["host"].id).update({"status": "removed"})
    db.commit()
    assert get(client, world["auth"])["items"] == []


def test_V_O07_비활성_기관은_0건(client, world, db):
    world["org"].deactivated_at = NOW
    db.commit()
    assert get(client, world["auth"])["items"] == []


def test_V_O08_숨김_회차_클래스_제외(client, world, db):
    hidden, _ = add_session(db, world, hidden_at=NOW)
    body = get(client, world["auth"])
    assert str(hidden.id) not in sids(body)
    world["cls"].hidden_at = NOW
    db.commit()
    assert get(client, world["auth"])["items"] == []


# ── 정확성 ────────────────────────────────────────────────────────
def build_mixed(db, world):
    s = world["session"]
    p1, p2, p3 = world["participants"]
    add_features(db, s, p1, range(1, 11), created=NOW - timedelta(seconds=5))  # 연속 → 수신 확인
    add_features(db, s, p2, [1, 2, 4], created=NOW - timedelta(seconds=9))     # 결측 → 확인 필요
    add_raw(db, s, p3, "eeg", [0, 1], status="uploaded")
    add_raw(db, s, p3, "ppg", [0], status="pending", created=NOW - timedelta(seconds=10))  # 60초 미만 → 업로드 중
    return s


def test_V_O09_상세_API_요약과_교차_일치(client, world, db):
    s = build_mixed(db, world)
    item = next(it for it in get(client, world["auth"])["items"] if it["session_id"] == str(s.id))
    detail = client.get(f"/api/v1/classes/{world['cls'].id}/sessions/{s.id}/upload-status", headers=world["auth"]).json()
    ds = detail["summary"]
    for key in ("needs_attention", "uploading", "received_unreconciled", "no_data", "excluded"):
        assert item[key] == ds[key], key
    assert item["participants"] == ds["participants"] == 3
    assert item["status"] == "needs_attention"
    last = max(t for p in detail["participants"] for t in (p["feature"]["last_received_at"], p["raw"]["last_received_at"]) if t)
    assert item["last_received_at"] == last


def test_V_O10_독립_COUNT_대조(client, world, db):
    s = build_mixed(db, world)
    item = next(it for it in get(client, world["auth"])["items"] if it["session_id"] == str(s.id))
    n_part = db.execute(sa.text("SELECT count(*) FROM session_participants WHERE session_id=:s AND removed_at IS NULL"),
                        {"s": str(s.id)}).scalar()
    assert item["participants"] == n_part
    assert item["needs_attention"] == 1 and item["uploading"] == 1 and item["received_unreconciled"] == 1
    assert item["needs_attention"] + item["uploading"] + item["received_unreconciled"] + item["no_data"] + item["excluded"] == n_part


def test_V_O11_스트림_결측_상세와_동일(client, world, db):
    s = world["session"]
    p1, p2, p3 = world["participants"]
    add_features(db, s, p1, [1, 2, 4], pg="a")
    add_features(db, s, p1, [1, 3], pg="b")
    add_raw(db, s, p2, "eeg", [0, 2], status="uploaded")
    item = next(it for it in get(client, world["auth"])["items"] if it["session_id"] == str(s.id))
    detail = client.get(f"/api/v1/classes/{world['cls'].id}/sessions/{s.id}/upload-status", headers=world["auth"]).json()
    assert item["needs_attention"] == detail["summary"]["needs_attention"] == 2


def test_V_O12_JOIN_곱셈_없음(client, world, db):
    s = world["session"]
    p1 = world["participants"][0]
    add_features(db, s, p1, range(1, 6))
    add_raw(db, s, p1, "eeg", range(0, 4))
    add_raw(db, s, p1, "acc", range(0, 3))
    item = next(it for it in get(client, world["auth"])["items"] if it["session_id"] == str(s.id))
    assert item["received_unreconciled"] == 1 and item["participants"] == 3


def test_V_O13_참여자_0명_회차는_no_data(client, world, db):
    empty, _ = add_session(db, world, members=0)
    item = next(it for it in get(client, world["auth"])["items"] if it["session_id"] == str(empty.id))
    assert item["participants"] == 0 and item["status"] == "no_data" and item["last_received_at"] is None


def test_V_O14_미착용_확정_표현_없음(client, world, db):
    s = world["session"]
    for p in world["participants"]:
        p.eeg_collection_consented = True
        p.band_connected = False
    world["participants"][0].band_connected = True
    db.commit()
    body = get(client, world["auth"])
    item = next(it for it in body["items"] if it["session_id"] == str(s.id))
    assert item["band_not_connected"] == 2 and item["no_data"] == 3
    assert "worn" not in json.dumps(body) and "미착용" not in json.dumps(body, ensure_ascii=False)


def test_V_O15_대기열_제외_참여자(client, world, db):
    s = world["session"]
    p = world["participants"][0]
    p.is_waitlisted = True
    db.commit()
    item = next(it for it in get(client, world["auth"])["items"] if it["session_id"] == str(s.id))
    assert item["excluded"] == 1 and item["participants"] == 3
    add_features(db, s, p, [1, 2])
    item = next(it for it in get(client, world["auth"])["items"] if it["session_id"] == str(s.id))
    assert item["excluded"] == 0 and item["received_unreconciled"] == 1


def test_회차_배지_우선순위(client, world, db):
    s = world["session"]
    p1, p2, p3 = world["participants"]
    add_features(db, s, p1, [1, 2])
    add_raw(db, s, p2, "eeg", [0], status="pending", created=NOW - timedelta(seconds=5))
    item = next(it for it in get(client, world["auth"])["items"] if it["session_id"] == str(s.id))
    assert item["status"] == "uploading"
    add_raw(db, s, p3, "eeg", [0, 3], status="failed")
    item = next(it for it in get(client, world["auth"])["items"] if it["session_id"] == str(s.id))
    assert item["status"] == "needs_attention"


# ── 정렬·한도·필터 ─────────────────────────────────────────────────
def test_V_O16_진행중_우선_후_최신순(client, world, db):
    older, _ = add_session(db, world, started=NOW - timedelta(days=5))
    newer, _ = add_session(db, world, started=NOW - timedelta(days=1))
    world["session"].started_at = NOW - timedelta(days=10)
    db.commit()
    assert sids(get(client, world["auth"])) == [str(world["session"].id), str(newer.id), str(older.id)]


def test_V_O17_limit_기본_최대_초과(client, world, db):
    for i in range(34):
        add_session(db, world, started=NOW - timedelta(hours=i + 1), seq=1000 + i)
    body = get(client, world["auth"])
    assert len(body["items"]) == 30 and body["limit"] == 30 and body["total_candidates"] == 35 and body["truncated"]
    body = get(client, world["auth"], limit=50)
    assert len(body["items"]) == 35 and not body["truncated"]
    assert client.get(URL, headers=world["auth"], params={"limit": 500}).status_code == 422
    assert client.get(URL, headers=world["auth"], params={"limit": 0}).status_code == 422


def test_V_O18_since_기본_30일_최대_90일(client, world, db):
    old, _ = add_session(db, world, started=NOW - timedelta(days=40))
    assert str(old.id) not in sids(get(client, world["auth"]))
    since = (NOW - timedelta(days=60)).strftime("%Y-%m-%d")
    assert str(old.id) in sids(get(client, world["auth"], since=since))
    too_old = (NOW - timedelta(days=100)).strftime("%Y-%m-%d")
    assert client.get(URL, headers=world["auth"], params={"since": too_old}).status_code == 422
    assert client.get(URL, headers=world["auth"], params={"since": "garbage"}).status_code == 422


def test_V_O19_status_class_필터(client, world, db):
    s = world["session"]
    add_features(db, s, world["participants"][0], [1, 3])  # 결측 → 확인 필요
    quiet, _ = add_session(db, world, members=1)
    only = get(client, world["auth"], status="needs_attention")
    assert sids(only) == [str(s.id)] and only["total_candidates"] == 2
    assert str(quiet.id) in sids(get(client, world["auth"], status="no_data"))
    assert client.get(URL, headers=world["auth"], params={"status": "bogus"}).status_code == 422
    cls2 = Class(id=uuid.uuid4(), organization_id=world["org"].id, created_by=world["host"].id, title="두 번째",
                 status="active", organization_attribution_known=True, default_duration_min=45)
    db.add(cls2)
    db.flush()
    s2, _ = add_session(db, world, cls=cls2)
    assert sids(get(client, world["auth"], class_id=str(cls2.id))) == [str(s2.id)]
    assert get(client, world["auth"], class_id=str(uuid.uuid4()))["items"] == []


def test_V_O20_예정_취소_회차_제외(client, world, db):
    sched, _ = add_session(db, world, status="scheduled")
    canc, _ = add_session(db, world, status="cancelled")
    body = get(client, world["auth"])
    assert str(sched.id) not in sids(body) and str(canc.id) not in sids(body)


# ── 성능(SQL 횟수) ───────────────────────────────────────────────
def count_queries(db, fn):
    n = []
    engine = db.get_bind()

    def hook(conn, cursor, statement, params, context, executemany):
        n.append(statement)

    sa.event.listen(engine, "before_cursor_execute", hook)
    try:
        fn()
    finally:
        sa.event.remove(engine, "before_cursor_execute", hook)
    return len(n)


def test_V_O21_SQL_횟수는_회차_수와_무관(client, world, db):
    build_mixed(db, world)
    few = count_queries(db, lambda: svc.load_overview(db, {"id": str(world["host"].id), "role": "counselor"}))
    for i in range(20):
        _, parts = add_session(db, world, started=NOW - timedelta(hours=i + 1), seq=2000 + i, members=3)
        add_features(db, db.get(Session, parts[0].session_id), parts[0], [1, 2, 3])
    svc.clear_cache()
    many = count_queries(db, lambda: svc.load_overview(db, {"id": str(world["host"].id), "role": "counselor"}))
    assert few == many <= 10, (few, many)


# ── ETag / 304 / 캐시 ────────────────────────────────────────────
def test_V_O24_304_헤더_권한_먼저(client, world, db):
    r = client.get(URL, headers=world["auth"])
    etag = r.headers["ETag"]
    assert etag.startswith('W/"') and r.json()["etag"] == etag
    assert r.headers["Cache-Control"] == "no-store, private" and r.headers["Vary"] == "Authorization"
    r2 = client.get(URL, headers={**world["auth"], "If-None-Match": etag})
    assert r2.status_code == 304 and r2.content == b""
    assert r2.headers["ETag"] == etag and r2.headers["X-Poll-Interval"] == r.headers["X-Poll-Interval"]
    assert client.get(URL, headers={"If-None-Match": etag}).status_code == 401


def test_V_O26_데이터_변화시_ETag_변경(client, world, db):
    etag = client.get(URL, headers=world["auth"]).headers["ETag"]
    add_features(db, world["session"], world["participants"][0], [1, 2])
    r = client.get(URL, headers={**world["auth"], "If-None-Match": etag})
    assert r.status_code == 200 and r.headers["ETag"] != etag


def test_V_O27_시각_경과는_ETag_불변(client, world, monkeypatch):
    etag = client.get(URL, headers=world["auth"]).headers["ETag"]
    monkeypatch.setattr(svc, "_utcnow", lambda: NOW + timedelta(seconds=3))
    assert client.get(URL, headers=world["auth"]).headers["ETag"] == etag


def test_V_O28_권한_회수는_캐시에_가려지지_않음(client, world, db, monkeypatch):
    monkeypatch.setattr(svc, "TTL_LIVE_SEC", 60.0)
    assert len(get(client, world["auth"])["items"]) == 1
    from app.models.user_org_membership import UserOrgMembership

    db.query(UserOrgMembership).filter(UserOrgMembership.user_id == world["host"].id).update({"status": "removed"})
    db.commit()
    assert get(client, world["auth"])["items"] == []


def test_캐시_적중시_회차_집계_쿼리_생략(client, world, db, monkeypatch):
    monkeypatch.setattr(svc, "TTL_LIVE_SEC", 60.0)
    actor = {"id": str(world["host"].id), "role": "counselor"}
    first = count_queries(db, lambda: svc.load_overview(db, actor))
    second = count_queries(db, lambda: svc.load_overview(db, actor))
    assert first >= 4 and second == 1


def test_V_O29_폴링_주기(client, world, db):
    assert client.get(URL, headers=world["auth"]).headers["X-Poll-Interval"] == "3"
    world["session"].status = "completed"
    world["session"].ended_at = NOW - timedelta(minutes=5)
    db.commit()
    add_raw(db, world["session"], world["participants"][0], "eeg", [0], status="pending", created=NOW - timedelta(seconds=5))
    assert client.get(URL, headers=world["auth"]).headers["X-Poll-Interval"] == "7"
    world["session"].ended_at = NOW - timedelta(hours=3)
    db.commit()
    assert client.get(URL, headers=world["auth"]).headers["X-Poll-Interval"] == "60"


# ── 금지 문구·회귀 ───────────────────────────────────────────────
def test_V_O30_금지_키_문구_없음(client, world, db):
    build_mixed(db, world)
    body = get(client, world["auth"])
    text = json.dumps(body, ensure_ascii=False).lower()
    for banned in ("score", "점수", "완료", "100%", "보증", "complete", "guarantee"):
        assert banned not in text, banned
    assert body["basis"] == "server_received"
    assert set(body["items"][0]) == {
        "session_id", "class_id", "class_title", "session_title", "seq", "organization_id", "organization_name",
        "session_status", "started_at", "ended_at", "participants", "needs_attention", "uploading",
        "received_unreconciled", "no_data", "excluded", "band_not_connected", "last_received_at", "status"}
