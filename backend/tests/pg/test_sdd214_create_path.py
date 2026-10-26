"""SDD-214 P1·P2 — 생성 API 를 실제 PG 제약·동시성 위에서 검증한다 (verify CP-3·CP-6, CN 연계).

SQLite 는 CHECK·복합 FK 를 메타데이터로 만들지 않으므로(TD8) 부모 없는 세션이 통과한다. 여기서는 마이그레이션 head 의
제약이 켜진 임시 DB 에 HTTP API 로 요청해(내부 헬퍼 직접 호출 없음) 모든 생성 지점이 제약을 만족하고, 동시 요청과 중간 실패에서도
일관한지 확인한다. 요청마다 실제 커밋되므로 사용자는 테스트마다 새로 만든다. 임시 DB 는 세션 종료 시 지운다.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterator

import fakeredis.aioredis
import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from tests.pg.conftest import alembic_ok

pytestmark = pytest.mark.pg


@pytest.fixture(scope="module")
def engine(scratch_db) -> Iterator[sa.Engine]:
    url = scratch_db("create_path")
    alembic_ok(url, "upgrade", "head")
    eng = sa.create_engine(url, pool_size=20, max_overflow=20)
    yield eng
    eng.dispose()


@pytest.fixture
def factory(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture
def app(factory, monkeypatch):
    from app.core.database import get_db
    from app.core.redis import get_redis
    from app.main import app as fastapi_app

    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)

    def _get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr("app.core.database.SessionLocal", factory)
    fastapi_app.dependency_overrides[get_db] = _get_db
    fastapi_app.dependency_overrides[get_redis] = lambda: fake
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def api(app) -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def _mk_user(factory, role: str = "counselor") -> tuple[uuid.UUID, dict]:
    from app.core.security import create_access_token

    uid = uuid.uuid4()
    with factory() as db:
        db.execute(
            sa.text(
                "INSERT INTO users (id, email, password_hash, name, role, verified_tier) "
                "VALUES (:id, :email, 'x', '테스트', :role, 'email')"
            ),
            {"id": str(uid), "email": f"cp-{uid.hex[:8]}@example.com", "role": role},
        )
        db.commit()
    return uid, {"Authorization": f"Bearer {create_access_token(str(uid))}"}


def _payload(**over) -> dict:
    body = {"type": "meditation", "duration_min": 50, "title": "제목", "participant_mode": "group", "max_participants": 10}
    body.update(over)
    return body


def _create(api: TestClient, headers: dict, **over) -> dict:
    res = api.post("/api/v1/sessions", json=_payload(**over), headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _scalar(factory, sql: str, **params):
    with factory() as db:
        return db.execute(sa.text(sql), params).scalar_one()


def _row(factory, session_id: str):
    with factory() as db:
        return db.execute(sa.text("select * from sessions where id = :i"), {"i": session_id}).one()


def test_부모_없는_비템플릿_세션은_PG_CHECK_로_거부된다(factory):
    from app.models.session import Session

    host, _ = _mk_user(factory)
    with factory() as db:
        db.add(Session(
            type="meditation", status="ready", host_id=host, duration_min=50, max_participants=10,
            location_type="offline", participant_mode="group", linkband_mode="none", webrtc_room_id=uuid.uuid4(),
        ))
        with pytest.raises(IntegrityError, match="ck_sessions_one_parent"):
            db.flush()


def test_API_명상_생성은_CHECK와_복합_FK를_통과한다(api, factory):
    host, headers = _mk_user(factory)
    body = _create(api, headers)
    row = _row(factory, body["id"])
    assert row.class_id is not None and row.counseling_relationship_id is None
    assert (row.seq, row.host_state, row.session_kind) == (1, "assigned", "regular")
    assert _scalar(factory, "select count(*) from class_instructors where class_id = :c and user_id = :u and role = 'lead'",
                   c=str(row.class_id), u=str(host)) == 1
    assert _scalar(factory, "select access_code from classes where id = :c", c=str(row.class_id)) == body["access_code"]


def test_API_상담_생성은_보관용_관계를_재사용하고_숨긴_세션의_seq도_재사용하지_않는다(api, factory):
    host, headers = _mk_user(factory)
    a = _create(api, headers, type="clinical", participant_mode="one_on_one")
    b = _create(api, headers, type="hypnosis", participant_mode="one_on_one")
    assert api.delete(f"/api/v1/sessions/{b['id']}", headers=headers).status_code in (200, 204)
    c = _create(api, headers, type="clinical", participant_mode="one_on_one")
    rows = [_row(factory, x["id"]) for x in (a, b, c)]
    assert len({r.counseling_relationship_id for r in rows}) == 1
    assert [r.seq for r in rows] == [1, 2, 3]
    assert _scalar(factory, "select count(*) from counseling_relationships where counselor_id = :h and is_placeholder", h=str(host)) == 1


def test_API_복제와_템플릿_경로도_제약을_만족한다(api, factory):
    _, headers = _mk_user(factory)
    src = _create(api, headers)
    dup = api.post(f"/api/v1/sessions/{src['id']}/duplicate", json={}, headers=headers)
    assert dup.status_code == 201, dup.text
    saved = api.post(f"/api/v1/sessions/{src['id']}/save-as-template", json={}, headers=headers)
    assert saved.status_code in (200, 201), saved.text
    made = _create(api, headers, is_template=True)
    a, b = _row(factory, src["id"]), _row(factory, dup.json()["id"])
    assert b.class_id is not None and b.class_id != a.class_id and b.seq == 1
    for sid in (saved.json()["id"], made["id"]):
        t = _row(factory, sid)
        assert t.is_template and t.class_id is None and t.counseling_relationship_id is None and t.seq is None


def test_API_PUT_동기화와_마지막_세션_숨김이_PG에서_일관된다(api, factory):
    _, headers = _mk_user(factory)
    body = _create(api, headers, title="전")
    assert api.put(f"/api/v1/sessions/{body['id']}", json={"title": "후", "max_participants": 7}, headers=headers).status_code == 200
    cid = str(_row(factory, body["id"]).class_id)
    assert _scalar(factory, "select title from classes where id = :c", c=cid) == "후"
    assert _scalar(factory, "select capacity from classes where id = :c", c=cid) == 7
    assert api.delete(f"/api/v1/sessions/{body['id']}", headers=headers).status_code in (200, 204)
    assert _scalar(factory, "select hidden_at is not null from classes where id = :c", c=cid) is True


@pytest.mark.parametrize(
    "fail_on, extra",
    [
        ("INSERT INTO class_instructors", {}),
        ("INSERT INTO sessions", {}),
        ("INSERT INTO counseling_relationship_counselors", {"type": "clinical", "participant_mode": "one_on_one"}),
        ("INSERT INTO sessions", {"type": "clinical", "participant_mode": "one_on_one"}),
    ],
)
def test_중간_INSERT_실패는_부모와_세션을_모두_롤백한다(api, factory, engine, fail_on, extra):
    host, headers = _mk_user(factory)
    seen: list[str] = []

    def _inject(conn, cursor, statement, params, context, executemany):
        head = statement.lstrip()[:60]
        seen.append(head)
        if head.startswith(fail_on):
            raise RuntimeError("주입된 INSERT 실패")

    sa.event.listen(engine, "before_cursor_execute", _inject)
    try:
        res = api.post("/api/v1/sessions", json=_payload(**extra), headers=headers)
    finally:
        sa.event.remove(engine, "before_cursor_execute", _inject)
    assert res.status_code == 500
    # 실패 지점 이전에 부모 INSERT 가 실제로 실행됐음을 문장 순서로 증명한다.
    parent = "INSERT INTO counseling_relationships" if "type" in extra else "INSERT INTO classes"
    failing_idx = next(i for i, s in enumerate(seen) if s.startswith(fail_on))
    assert any(s.startswith(parent) for s in seen[:failing_idx]), seen
    for table, col in (("sessions", "host_id"), ("class_instructors", "user_id"), ("classes", "created_by"),
                       ("counseling_relationships", "counselor_id"), ("counseling_relationship_counselors", "counselor_id")):
        assert _scalar(factory, f"select count(*) from {table} where {col} = :h", h=str(host)) == 0, table


def test_상담_보관용_관계_동시_최초_생성은_관계_1개와_연속_seq를_만든다(app, factory):
    host, headers = _mk_user(factory)
    n = 8
    barrier = threading.Barrier(n)
    results: list[tuple[int, dict]] = []
    lock = threading.Lock()

    def _worker():
        client = TestClient(app, raise_server_exceptions=False)
        barrier.wait()
        res = client.post("/api/v1/sessions", json=_payload(type="clinical", participant_mode="one_on_one"), headers=headers)
        with lock:
            results.append((res.status_code, res.json()))

    threads = [threading.Thread(target=_worker) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=120)
    assert sorted(code for code, _ in results) == [201] * n, results
    assert _scalar(factory, "select count(*) from counseling_relationships where counselor_id = :h and is_placeholder", h=str(host)) == 1
    assert _scalar(factory, "select count(*) from counseling_relationship_counselors where counselor_id = :h", h=str(host)) == 1
    with factory() as db:
        seqs = sorted(r[0] for r in db.execute(sa.text("select seq from sessions where host_id = :h"), {"h": str(host)}))
    assert seqs == list(range(1, n + 1))


def test_동시_PUT_이_클래스_설정을_과거_값으로_되돌리지_않는다(app, api, factory, monkeypatch):
    from app.services import session_service as svc

    _, headers = _mk_user(factory)
    body = _create(api, headers, title="원래", max_participants=5)
    original = svc._sync_parent_class
    a_in_hook, b_done = threading.Event(), threading.Event()
    first = threading.Lock()
    state = {"a_claimed": False}

    def _hooked(s, db):
        with first:
            is_a = not state["a_claimed"]
            state["a_claimed"] = True
        if is_a:
            a_in_hook.set()
            # B 가 잠금 없이 끝까지 갈 수 있다면 여기서 풀려난다. 잠금이 있으면 B 는 A 커밋까지 막혀 타임아웃으로 넘어간다.
            b_done.wait(timeout=2.5)
        return original(s, db)

    monkeypatch.setattr(svc, "_sync_parent_class", _hooked)
    out: dict[str, int] = {}

    def _put(name: str, payload: dict):
        res = TestClient(app, raise_server_exceptions=False).put(f"/api/v1/sessions/{body['id']}", json=payload, headers=headers)
        out[name] = res.status_code
        if name == "b":
            b_done.set()

    ta = threading.Thread(target=_put, args=("a", {"title": "A가바꾼제목"}))
    ta.start()
    assert a_in_hook.wait(timeout=30)
    tb = threading.Thread(target=_put, args=("b", {"max_participants": 7}))
    tb.start()
    ta.join(timeout=60)
    tb.join(timeout=60)
    assert out == {"a": 200, "b": 200}
    s = _row(factory, body["id"])
    with factory() as db:
        k = db.execute(sa.text("select title, capacity from classes where id = :c"), {"c": str(s.class_id)}).one()
    assert (s.title, s.max_participants) == ("A가바꾼제목", 7)
    assert (k.title, k.capacity) == (s.title, s.max_participants)


def test_호스트_삭제는_명상_클래스를_숨기지_않고_재배정한다(factory):
    from app.services import admin_service

    host, _ = _mk_user(factory)
    other, _ = _mk_user(factory)
    admin, _ = _mk_user(factory, role="platform_admin")
    with factory() as db:
        shared = uuid.uuid4()
        alone = uuid.uuid4()
        for cid in (shared, alone):
            db.execute(sa.text("insert into classes (id, created_by, default_duration_min) values (:i, :u, 50)"),
                       {"i": str(cid), "u": str(host)})
            db.execute(sa.text("insert into class_instructors (id, class_id, user_id, role, status) values (gen_random_uuid(), :c, :u, 'lead', 'active')"),
                       {"c": str(cid), "u": str(host)})
        # shared 클래스에는 다른 강사의 가시 세션이 하나 남아 있다.
        db.execute(sa.text("insert into class_instructors (id, class_id, user_id, role, status) values (gen_random_uuid(), :c, :u, 'assistant', 'active')"),
                   {"c": str(shared), "u": str(other)})
        for cid, owner, seq in ((shared, host, 1), (shared, other, 2), (alone, host, 1)):
            db.execute(
                sa.text(
                    "insert into sessions (id, type, status, host_id, duration_min, max_participants, location_type, participant_mode, "
                    "linkband_mode, class_id, seq, host_state) values (gen_random_uuid(), 'meditation', 'ready', :h, 50, 10, 'offline', "
                    "'group', 'none', :c, :q, 'assigned')"
                ),
                {"h": str(owner), "c": str(cid), "q": seq},
            )
        db.commit()
        admin_service.delete_user(host, admin, db)
    assert _scalar(factory, "select hidden_at is null from classes where id = :c", c=str(shared)) is True
    assert _scalar(factory, "select hidden_at is null from classes where id = :c", c=str(alone)) is True
    assert _scalar(factory, "select count(*) from sessions where host_id = :u and host_state = 'needs_reassign' and hidden_at is null", u=str(host)) == 2
