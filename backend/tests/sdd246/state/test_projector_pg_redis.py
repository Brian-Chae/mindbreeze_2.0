"""SDD-246 T04 — projector·snapshot·replay·재구축 (실제 PostgreSQL + 실제 Redis).

RED 시나리오: outbox 역순/중복 호출, Redis 갱신 후 DB 표기 전 crash, snapshot 완전성·scope, replay 경계,
Redis 소실 → epoch 증가 재구축, 활성 TTL 미만료/종료 후 TTL, OOM fail-closed.
"""
from __future__ import annotations

import json
import uuid

import pytest
import redis as redis_lib
from sqlalchemy import select

from app.models.live_state import LiveOutbox, LiveSessionEpoch
from app.services import session_live_outbox as ob
from app.services.live_redis import keys
from app.services.live_redis.client import LiveRedisUnavailable, ProjectionFenceLost
from app.services.session_live_state import (
    Cursor, LiveStateService, ReplayUnavailable, Scope, ScopeStale, ScopeViolation,
)
from tests.sdd246.state.helpers import install_hand_handler, send


@pytest.fixture(autouse=True)
def _handler():
    install_hand_handler()


def _rows(maker, sid):
    with maker() as s:
        return list(s.execute(select(LiveOutbox).where(LiveOutbox.session_id == sid)
                              .order_by(LiveOutbox.revision)).scalars())


def _seq(live, sid, aud, dom):
    return int(live.r.get(keys.seq(live.prefix, sid, aud, dom)) or 0)


def test_순서_projection과_snapshot_through(world, maker, live, db):
    for i in range(3):
        send(world, 0, raised=bool(i % 2 == 0), ver=i + 1)
    send(world, 1, raised=True, ver=1, with_session=True)
    res = ob.drain(db, live, world.session_id)
    assert res.projected == 5 and res.applied_revision == 5
    pid0 = str(world.members[0][1])
    assert _seq(live, world.session_id, "host", "speaking") == 4
    assert _seq(live, world.session_id, f"member:{pid0}", "speaking") == 3
    snap = LiveStateService(live).snapshot(world.session_id, Scope("host"))
    assert snap["epoch"] == "1" and snap["speaking"]["entities"][pid0]["version"] == "3"
    # 모든 outbox processed 표기
    assert all(r.processed_at is not None for r in _rows(maker, world.session_id))


def test_역순_중복_호출도_revision_순서와_exactly_once(world, maker, live, db):
    for i in range(4):
        send(world, 0, ver=i + 1)
    rows = _rows(maker, world.session_id)
    # 역순으로 호출 + 같은 event 반복 호출
    for r in reversed(rows):
        ob.project(db, live, r)
    for r in rows:
        ob.project(db, live, r)
    host_seq = _seq(live, world.session_id, "host", "speaking")
    assert host_seq == 4  # 이중 증가 없음
    xs = live.r.xrange(keys.events(live.prefix, world.session_id, "host", "speaking"))
    assert [e[0] for e in xs] == [f"{n}-0" for n in range(1, 5)]
    assert [int(e[1]["entity_version"]) for e in xs] == [1, 2, 3, 4]


def test_Redis_갱신후_DB표기전_crash_재처리_무해(world, maker, live, db):
    for i in range(3):
        send(world, 0, ver=i + 1)

    class Crash(Exception):
        pass

    def boom(row):
        if row.revision == 2:
            raise Crash()

    with pytest.raises(Crash):
        ob.drain(db, live, world.session_id, hooks=ob.Hooks(after_redis=boom))
    db.rollback()
    rows = _rows(maker, world.session_id)
    assert [r.processed_at is not None for r in rows] == [True, False, False]  # rev2 는 Redis 만 반영됨
    assert _seq(live, world.session_id, "host", "speaking") == 2
    # 락은 TTL 이전이므로 같은 토큰으로 재진입할 수 없다 → 새 projector 는 락이 풀릴 때까지 대기해야 한다
    live.r.delete(keys.lock(live.prefix, world.session_id))  # 프로세스 사망으로 TTL 만료된 것과 동일
    res = ob.drain(db, live, world.session_id)
    assert res.projected == 1 and res.marked >= 1
    assert _seq(live, world.session_id, "host", "speaking") == 3  # rev2 가 두 번 반영되지 않음
    assert all(r.processed_at is not None for r in _rows(maker, world.session_id))


def test_fence_과거_projector_쓰기_거부(world, live, db):
    send(world, 0)
    ob.drain(db, live, world.session_id)
    old = live.acquire_projector(world.session_id, "old")
    live.r.delete(keys.lock(live.prefix, world.session_id))  # 락 만료
    new = live.acquire_projector(world.session_id, "new")
    assert new.fence > old.fence
    send(world, 0, ver=2)
    row = _rows(world.maker, world.session_id)[-1]
    with pytest.raises(ProjectionFenceLost):
        ob._project_row(live, world.session_id, row, 1, old, 0)
    assert _seq(live, world.session_id, "host", "speaking") == 1


def test_두_projector_동시_drain은_하나만_쓴다(world, maker, live):
    from concurrent.futures import ThreadPoolExecutor
    for i in range(30):
        send(world, 0, ver=i + 1)

    def run(_):
        s = maker()
        try:
            return ob.drain(s, live, world.session_id, wait_s=3.0)
        finally:
            s.close()

    with ThreadPoolExecutor(4) as ex:
        results = list(ex.map(run, range(4)))
    assert sum(r.projected for r in results) == 30
    assert _seq(live, world.session_id, "host", "speaking") == 30


def test_snapshot_scope_member_는_타인_개별정보_없음(world, live, db):
    send(world, 0, ver=1, with_session=True)
    send(world, 1, ver=1)
    ob.drain(db, live, world.session_id)
    svc = LiveStateService(live)
    p0, p1 = (str(m[1]) for m in world.members)
    host = svc.snapshot(world.session_id, Scope("host"))
    mem = svc.snapshot(world.session_id, Scope("member", world.members[0][1]))
    assert set(host["speaking"]["entities"]) == {p0, p1}
    assert set(mem["speaking"]["entities"]) == {p0}
    assert mem["audiences"] == ["public", f"member:{p0}"]
    assert {c["audience"] for c in mem["through"]} <= {"public", f"member:{p0}"}
    assert mem["session"]["data"]["status"] == "in_progress"
    with pytest.raises(ScopeViolation):
        svc.replay(world.session_id, Scope("member", world.members[0][1]), [Cursor(f"member:{p1}", "speaking", 0)])


def test_snapshot_누락필드_없고_session없으면_불완전(world, live, db):
    from app.services.session_live_state import SnapshotIncomplete
    send(world, 0)  # session domain event 없음
    ob.drain(db, live, world.session_id)
    with pytest.raises(SnapshotIncomplete):
        LiveStateService(live).snapshot(world.session_id, Scope("host"))
    send(world, 0, ver=2, with_session=True)
    ob.drain(db, live, world.session_id)
    snap = LiveStateService(live).snapshot(world.session_id, Scope("host"))
    for f in ("session", "participation", "waiting", "speaking", "signal", "audio", "devices", "metrics",
              "aggregates", "policy", "terminal", "through", "epoch", "auth_revision"):
        assert f in snap


def test_replay_cursor_이후만_연속_seq(world, live, db):
    for i in range(5):
        send(world, 0, ver=i + 1)
    ob.drain(db, live, world.session_id)
    svc = LiveStateService(live)
    out = svc.replay(world.session_id, Scope("host"), [Cursor("host", "speaking", 2)], expected_epoch=1)
    assert [e["seq"] for e in out.events] == ["3", "4", "5"]
    assert out.through == [Cursor("host", "speaking", 5)]
    assert svc.replay(world.session_id, Scope("host"), [Cursor("host", "speaking", 5)]).events == []
    with pytest.raises(ReplayUnavailable):  # cursor 가 서버보다 앞섬
        svc.replay(world.session_id, Scope("host"), [Cursor("host", "speaking", 9)])
    with pytest.raises(ReplayUnavailable):  # epoch 불일치
        svc.replay(world.session_id, Scope("host"), [Cursor("host", "speaking", 1)], expected_epoch=7)


def test_replay_log_절단은_snapshot_요구(world, live, db):
    for i in range(5):
        send(world, 0, ver=i + 1)
    ob.drain(db, live, world.session_id)
    ek = keys.events(live.prefix, world.session_id, "host", "speaking")
    live.r.xtrim(ek, maxlen=2, approximate=False)  # 앞쪽 절단
    with pytest.raises(ReplayUnavailable):
        LiveStateService(live).replay(world.session_id, Scope("host"), [Cursor("host", "speaking", 1)])
    ok = LiveStateService(live).replay(world.session_id, Scope("host"), [Cursor("host", "speaking", 3)])
    assert [e["seq"] for e in ok.events] == ["4", "5"]


def test_auth_revision_상승시_오래된_scope는_거절(world, maker, live, db):
    send(world, 0, with_session=True)
    ob.drain(db, live, world.session_id)
    with maker() as s:
        row = s.execute(select(LiveSessionEpoch).where(LiveSessionEpoch.session_id == world.session_id)).scalar_one()
        row.auth_revision = 3
        s.commit()
    send(world, 0, ver=2)  # 이후 event 가 projection 되면 auth_revision 이 Redis 로 전파
    ob.drain(db, live, world.session_id)
    svc = LiveStateService(live)
    with pytest.raises(ScopeStale):
        svc.snapshot(world.session_id, Scope("member", world.members[0][1], auth_revision=0))
    assert svc.snapshot(world.session_id, Scope("member", world.members[0][1], auth_revision=3))["auth_revision"] == "3"
    assert svc.heartbeat(world.session_id, Scope("host"))["auth_revision"] == "3"


def test_snapshot_중_delta_원자경계(world, maker, live):
    """snapshot 이 읽은 state 의 speaking 버전은 항상 through seq 와 일치한다(동시 projection 중에도)."""
    from concurrent.futures import ThreadPoolExecutor
    send(world, 0, ver=1, with_session=True)
    s0 = maker()
    ob.drain(s0, live, world.session_id)
    s0.close()
    N = 150
    for i in range(N):
        send(world, 0, ver=i + 2)
    pid = str(world.members[0][1])
    svc = LiveStateService(live)
    stop = {"v": False}
    seen: list[tuple[int, int]] = []

    def reader():
        while not stop["v"]:
            snap = svc.snapshot(world.session_id, Scope("host"))
            seq = next(int(c["seq"]) for c in snap["through"] if c["audience"] == "host" and c["domain"] == "speaking")
            ver = int(snap["speaking"]["entities"][pid]["version"]) if pid in snap["speaking"]["entities"] else 0
            seen.append((seq, ver))

    def writer():
        s = maker()
        try:
            ob.drain(s, live, world.session_id, wait_s=3.0)
        finally:
            s.close()
            stop["v"] = True

    with ThreadPoolExecutor(3) as ex:
        f = [ex.submit(reader), ex.submit(reader), ex.submit(writer)]
        for x in f:
            x.result()
    assert seen
    # host speaking seq n 번째 event 의 entity_version == n (첫 send 의 ver=1 이 seq1, 이후 ver=i+2): seq 와 ver 일치
    assert all(seq == ver for seq, ver in seen), [t for t in seen if t[0] != t[1]][:5]


def test_Redis_소실후_DB_재구축_epoch_증가(world, maker, live, db):
    send(world, 0, ver=1, with_session=True)
    send(world, 1, ver=1)
    send(world, 0, ver=2)
    ob.drain(db, live, world.session_id)
    before = LiveStateService(live).snapshot(world.session_id, Scope("host"))
    raw = redis_lib.Redis.from_url(live.r.connection_pool.connection_kwargs and
                                   f"redis://localhost:6379/{live.r.connection_pool.connection_kwargs.get('db', 0)}")
    for k in raw.scan_iter(match=f"{live.prefix}:*"):
        raw.delete(k)  # 전체 소실(이 prefix 만)
    with pytest.raises(Exception):  # meta 없음 → READY 금지
        LiveStateService(live).snapshot(world.session_id, Scope("host"))
    send(world, 1, ver=2)  # 소실 중에도 명령은 DB 에 계속 쌓인다
    snap = ob.snapshot_ready(db, live, world.session_id, Scope("host"))
    assert snap["epoch"] == "2"
    assert snap["session"]["data"] == before["session"]["data"]
    p0, p1 = (str(m[1]) for m in world.members)
    assert snap["speaking"]["entities"][p0]["version"] == before["speaking"]["entities"][p0]["version"]
    assert snap["speaking"]["entities"][p1]["version"] == "2"  # 소실 중 쌓인 미projection outbox 포함
    with maker() as s:
        assert s.execute(select(LiveSessionEpoch.epoch).where(LiveSessionEpoch.session_id == world.session_id)).scalar_one() == 2
    # 이전 epoch cursor 로 replay 금지
    with pytest.raises(ReplayUnavailable):
        LiveStateService(live).replay(world.session_id, Scope("host"), [Cursor("host", "speaking", 1)], expected_epoch=1)
    # 재구축 후 다음 명령 projection 정상, seq 는 epoch 안에서 연속
    send(world, 0, ver=3)
    ob.drain(db, live, world.session_id)
    s2 = LiveStateService(live).snapshot(world.session_id, Scope("host"))
    assert s2["epoch"] == "2"


def test_단일_rebuild_동시호출(world, maker, live):
    from concurrent.futures import ThreadPoolExecutor
    send(world, 0, with_session=True)
    s = maker()
    ob.drain(s, live, world.session_id)
    s.close()
    for k in list(live.r.scan_iter(match=f"{live.prefix}:*")):
        live.r.delete(k)

    def run(_):
        ss = maker()
        try:
            return ob.ensure_ready(ss, live, world.session_id)
        finally:
            ss.close()

    with ThreadPoolExecutor(6) as ex:
        epochs = list(ex.map(run, range(6)))
    assert set(epochs) == {2}  # 6개 호출이 epoch 를 한 번만 올린다
    with maker() as s:
        assert s.execute(select(LiveSessionEpoch.epoch).where(LiveSessionEpoch.session_id == world.session_id)).scalar_one() == 2


def test_활성_상태는_TTL_없고_종료후_24h_TTL(world, maker, live, db):
    send(world, 0, ver=1, with_session=True)
    ob.drain(db, live, world.session_id)
    pat = f"{live.prefix}:*"
    ks = [k for k in live.r.scan_iter(match=pat)]
    assert ks
    non_ttl = {k for k in ks if live.r.ttl(k) == -1}
    assert keys.meta(live.prefix, world.session_id) in non_ttl
    assert keys.state(live.prefix, world.session_id, "host", "speaking") in non_ttl
    # dedupe 는 최소 24h 보장
    dd = [k for k in ks if ":dedupe:" in k]
    assert dd and all(live.r.ttl(k) > 23 * 3600 for k in dd)
    # 종료
    send(world, 0, ver=2, with_session=True, status="completed")
    ob.drain(db, live, world.session_id)
    ks = [k for k in live.r.scan_iter(match=pat)]
    assert all(0 < live.r.ttl(k) <= 24 * 3600 for k in ks if not k.endswith(":fence"))
    snap = LiveStateService(live).snapshot(world.session_id, Scope("host"))
    assert snap["terminal"] is True


def test_OOM_fail_closed(world, maker, live, db, redis_url):
    """실제 maxmemory 를 낮춰 쓰기 OOM 을 유발 → LiveRedisUnavailable, 메모리 성공 응답 없음, outbox 미표기."""
    raw = redis_lib.Redis.from_url(redis_url)
    send(world, 0, ver=1, with_session=True)
    ob.drain(db, live, world.session_id)
    old = raw.config_get("maxmemory")["maxmemory"]
    used = raw.info("memory")["used_memory"]
    try:
        send(world, 0, ver=2)
        raw.config_set("maxmemory", str(max(used - 1024, 1024 * 1024)))
        with pytest.raises(LiveRedisUnavailable) as ei:
            ob.drain(db, live, world.session_id)
        assert ei.value.reason == "redis_oom"
        db.rollback()
        rows = _rows(maker, world.session_id)
        assert rows[-1].processed_at is None  # 성공으로 표기하지 않음
    finally:
        raw.config_set("maxmemory", old)
        raw.close()
    res = ob.drain(db, live, world.session_id)  # 복구 후 이어서 적용
    assert res.applied_revision == len(_rows(maker, world.session_id))


def test_Redis_연결불가는_LiveRedisUnavailable(world, db):
    from app.services.live_redis.client import LiveRedis
    dead = LiveRedis.from_url("redis://127.0.0.1:1/11", prefix="t04dead", socket_timeout=0.2)
    send(world, 0)
    with pytest.raises(LiveRedisUnavailable):
        ob.drain(db, dead, world.session_id)
    with pytest.raises(LiveRedisUnavailable):
        LiveStateService(dead).snapshot(world.session_id, Scope("host"))


def test_tombstone_removed_event(world, maker, live, db):
    from app.services.session_live_commands import LiveCommand, apply_command, register_handler

    def rm(ctx):
        pid = str(ctx.actor.participant_id)
        ctx.entity_version = 5
        ctx.emit(domain="participation", event_type="participant.removed", entity_id=pid, entity_version=5,
                 audience=["host"], payload={"entity_id": pid, "version": "5"})

    register_handler("entry.leave", rm)
    send(world, 0, ver=1, with_session=True)
    apply_command(maker(), world.member(0), LiveCommand(command_id=uuid.uuid4(), session_id=world.session_id,
                                                        kind="entry.leave", payload={}))
    ob.drain(db, live, world.session_id)
    snap = LiveStateService(live).snapshot(world.session_id, Scope("host"))
    pid = str(world.members[0][1])
    assert snap["participation"]["tombstones"] == [{"entity_id": pid, "version": "5"}]
    assert pid not in snap["participation"]["entities"]


def test_Lua_직접_건너뛰기_거부와_중복_무해(world, maker, live, db):
    """drain 을 거치지 않고 Lua 에 역순/중복 event 를 직접 넣어도 revision 순서·exactly-once 가 지켜진다."""
    from app.services.live_redis.client import ProjectionGap
    for i in range(3):
        send(world, 0, ver=i + 1)
    ob.ensure_ready(db, live, world.session_id)
    rows = _rows(maker, world.session_id)
    fence = live.acquire_projector(world.session_id, "direct")
    sid = world.session_id
    with pytest.raises(ProjectionGap):  # rev1 을 건너뛰고 rev2
        ob._project_row(live, sid, rows[1], 1, fence, 0)
    assert _seq(live, sid, "host", "speaking") == 0
    assert ob._project_row(live, sid, rows[0], 1, fence, 0)[0] == "ok"
    assert ob._project_row(live, sid, rows[0], 1, fence, 0)[0] == "dup"  # 중복: seq 증가 없음
    assert _seq(live, sid, "host", "speaking") == 1
    assert ob._project_row(live, sid, rows[1], 1, fence, 0)[0] == "ok"
    assert ob._project_row(live, sid, rows[0], 1, fence, 0)[0] == "dup"  # 과거 revision 재전달
    assert _seq(live, sid, "host", "speaking") == 2


def test_낮은_entity_version은_state를_덮지_못한다(world, maker, live, db):
    send(world, 0, ver=5)
    send(world, 0, ver=3)  # 늦게 도착한 낮은 버전
    ob.drain(db, live, world.session_id)
    st = live.r.hgetall(keys.state(live.prefix, world.session_id, "host", "speaking"))
    assert json.loads(next(iter(st.values())))["v"] == 5
    assert _seq(live, world.session_id, "host", "speaking") == 2  # stream 에는 남는다
