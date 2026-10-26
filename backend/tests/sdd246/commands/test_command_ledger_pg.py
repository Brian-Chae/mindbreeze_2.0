"""SDD-246 T03 — command ledger 멱등·동시성·outbox 동일 commit (실제 PostgreSQL).

RED→GREEN 시나리오: V01 통합(동일 ID 100회 동시, 다른 body 409, commit 후 ACK 유실, 실패 ACK 불변).
"""
from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
import sqlalchemy as sa

from app.models.live_state import LiveCommandLedger, LiveOutbox, LiveSessionEpoch
from app.services import session_live_commands as slc
from app.services.session_live_commands import Actor, CommandRejected, LiveCommand, apply_command, register_handler
from app.services.session_live_ledger import lookup_result



@pytest.fixture
def counting_handler():
    """업무 전이를 흉내 내는 handler: 호출 횟수를 센다(부작용 1회 보장 검증)."""
    calls = {"n": 0}
    lock = threading.Lock()

    def handler(ctx):
        with lock:
            calls["n"] += 1
        ctx.entity_version = 1
        ctx.result = {"raised": ctx.command.payload["raised"]}
        ctx.emit(domain="speaking", event_type="speaking.changed", entity_id=str(ctx.actor.participant_id),
                 entity_version=1, audience=["host"], payload={"raised": ctx.command.payload["raised"]})

    register_handler("hand.set", handler)
    yield calls


def _cmd(world, command_id=None, raised=True, **kw):
    return LiveCommand(command_id=command_id or uuid.uuid4(), session_id=world.session_id, kind="hand.set",
                       payload={"raised": raised}, **kw)


def _counts(maker, world):
    with maker() as s:
        ledger = s.scalar(sa.select(sa.func.count()).select_from(LiveCommandLedger).where(LiveCommandLedger.session_id == world.session_id))
        outbox = s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == world.session_id))
        return ledger, outbox


@pytest.mark.parametrize("warm", [False, True], ids=["epoch행_신규", "epoch행_선생성"])
def test_동일_command_id_100회_동시_요청은_ledger_업무전이_outbox_각_1건(maker, world, counting_handler, warm):
    actor = world.member(0)
    cmd = _cmd(world)
    if warm:  # 첫 INSERT 의 암묵 직렬화를 배제하고 FOR UPDATE 락만으로 직렬화되는지 본다
        with maker() as s:
            apply_command(s, world.member(1), _cmd(world))
        counting_handler["n"] = 0
    barrier = threading.Barrier(100)

    def run(_):
        with maker() as s:
            barrier.wait()
            return apply_command(s, actor, cmd)

    with ThreadPoolExecutor(max_workers=100) as pool:
        results = list(pool.map(run, range(100)))

    assert counting_handler["n"] == 1
    assert _counts(maker, world) == ((2, 2) if warm else (1, 1))
    assert sum(1 for r in results if not r.duplicate) == 1
    assert {r.status for r in results} == {"applied"}
    assert len({(r.epoch, r.revision, r.entity_version, tuple(r.result.items())) for r in results}) == 1


def test_같은_ID_다른_body는_idempotency_conflict_이고_원결과는_보존된다(maker, world, counting_handler):
    actor = world.member(0)
    cid = uuid.uuid4()
    with maker() as s:
        first = apply_command(s, actor, _cmd(world, cid, raised=True))
    with maker() as s:
        second = apply_command(s, actor, _cmd(world, cid, raised=False))
    assert first.status == "applied" and not first.duplicate
    assert second.code == "idempotency_conflict" and second.http_status == 409 and not second.committed
    assert counting_handler["n"] == 1
    assert _counts(maker, world) == (1, 1)
    with maker() as s:
        again = lookup_result(s, world.session_id, actor.actor_id, cid)
    assert again.status == "applied" and again.result == {"raised": True}


def test_다른_actor_는_같은_command_id_를_독립적으로_쓴다(maker, world, counting_handler):
    cid = uuid.uuid4()
    with maker() as s:
        apply_command(s, world.member(0), _cmd(world, cid))
    with maker() as s:
        r = apply_command(s, world.member(1), _cmd(world, cid))
    assert not r.duplicate and counting_handler["n"] == 2


def test_commit_후_ACK_유실_재시도는_duplicate_원결과이고_부작용_1회(maker, world, counting_handler):
    actor, cid = world.member(0), uuid.uuid4()
    with maker() as s:
        original = apply_command(s, actor, _cmd(world, cid))
    # 호출자는 결과를 받지 못했다고 가정 → 결과 조회 후 같은 ID 로 재시도
    with maker() as s:
        looked = lookup_result(s, world.session_id, actor.actor_id, cid)
    with maker() as s:
        retry = apply_command(s, actor, _cmd(world, cid))
    assert looked.revision == retry.revision == original.revision
    assert retry.duplicate and retry.status == "applied" and counting_handler["n"] == 1
    assert _counts(maker, world) == (1, 1)


def test_lookup_result_는_commit_전이면_None(maker, world):
    with maker() as s:
        assert lookup_result(s, world.session_id, world.member(0).actor_id, uuid.uuid4()) is None


def test_commit_직전_crash_는_아무것도_남기지_않고_같은_ID_재시도가_성공한다(maker, world, counting_handler):
    actor, cid = world.member(0), uuid.uuid4()
    with maker() as s:
        # commit=False 로 적용한 뒤 프로세스 사망을 흉내(세션을 commit 없이 닫음)
        apply_command(s, actor, _cmd(world, cid), commit=False)
        s.rollback()
    assert _counts(maker, world) == (0, 0)
    with maker() as s:
        r = apply_command(s, actor, _cmd(world, cid))
    assert r.status == "applied" and not r.duplicate
    assert _counts(maker, world) == (1, 1)


def test_업무_전이_ledger_outbox_는_같은_commit_이다(maker, world, counting_handler):
    """commit 이후 다른 연결에서 셋이 동시에 보이고, handler 예외면 셋 다 없다."""
    actor = world.member(0)

    def boom(ctx):
        ctx.emit(domain="speaking", event_type="x", entity_id=None, entity_version=1, audience=["host"], payload={})
        raise RuntimeError("handler crash")

    register_handler("hand.set", boom)
    with maker() as s:
        with pytest.raises(RuntimeError):
            apply_command(s, actor, _cmd(world))
    assert _counts(maker, world) == (0, 0)
    with maker() as s:
        row = s.get(LiveSessionEpoch, world.session_id)
        assert row is None or int(row.revision) == 0


def test_outbox_revision_은_회차_내_gap_없이_단조_증가한다(maker, world, counting_handler):
    actors = [world.member(0), world.member(1)]

    def run(i):
        with maker() as s:
            return apply_command(s, actors[i % 2], _cmd(world))

    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(run, range(40)))
    with maker() as s:
        revs = s.scalars(sa.select(LiveOutbox.revision).where(LiveOutbox.session_id == world.session_id).order_by(LiveOutbox.revision)).all()
        assert revs == list(range(1, 41))
        assert int(s.get(LiveSessionEpoch, world.session_id).revision) == 40


def test_거절은_ledger_에_결정적으로_저장돼_재시도해도_같다(maker, world):
    def reject(ctx):
        ctx.emit(domain="speaking", event_type="x", entity_id=None, entity_version=1, audience=["host"], payload={})
        raise CommandRejected("not_allowed_now", {"why": "test"})

    register_handler("hand.set", reject)
    cid, actor = uuid.uuid4(), world.member(0)
    with maker() as s:
        a = apply_command(s, actor, _cmd(world, cid))
    with maker() as s:
        b = apply_command(s, actor, _cmd(world, cid))
    assert (a.status, a.code) == ("rejected", "not_allowed_now") and a.result == {"why": "test"}
    assert b.duplicate and (b.status, b.code) == ("rejected", "not_allowed_now")
    # 거절 명령의 부분 outbox 는 savepoint 와 함께 되돌아간다
    assert _counts(maker, world) == (1, 0)


def test_오래된_실패_ACK_가_새_intent_를_rollback_하지_않는다(maker, world, counting_handler):
    """같은 대상의 intent A(raised) 성공 → intent B(lowered, 새 ID) 성공. A 재시도(duplicate)가 와도 B 는 그대로, 부작용 추가 없음."""
    actor = world.member(0)
    a, b = uuid.uuid4(), uuid.uuid4()
    with maker() as s:
        apply_command(s, actor, _cmd(world, a, raised=True))
    with maker() as s:
        apply_command(s, actor, _cmd(world, b, raised=False))
    with maker() as s:
        stale = apply_command(s, actor, _cmd(world, a, raised=True))
    assert stale.duplicate and stale.revision == 1  # 원 결과 revision, 현재 revision(2)을 덮지 않음
    with maker() as s:
        assert int(s.get(LiveSessionEpoch, world.session_id).revision) == 2
    assert counting_handler["n"] == 2


def test_epoch_불일치와_미지_kind_와_세션없음은_transient_거절로_ledger_를_남기지_않는다(maker, world, counting_handler):
    actor = world.member(0)
    with maker() as s:
        r = apply_command(s, actor, _cmd(world, expected_epoch=99))
    assert r.code == "epoch_mismatch" and r.transient and not r.committed
    with maker() as s:
        r2 = apply_command(s, actor, LiveCommand(command_id=uuid.uuid4(), session_id=uuid.uuid4(), kind="hand.set", payload={"raised": True}))
    assert r2.code == "session_not_found" and r2.transient
    assert _counts(maker, world) == (0, 0)


def test_권한없는_actor_는_forbidden_으로_ledger_에_남는다(maker, world, counting_handler):
    host_only = LiveCommand(command_id=uuid.uuid4(), session_id=world.session_id, kind="audio.set", payload={})
    with maker() as s:
        r = apply_command(s, world.member(0), host_only)
    assert (r.status, r.code) == ("rejected", "forbidden")
    assert counting_handler["n"] == 0


def test_system_actor_는_host_명령을_수행할_수_있다(maker, world):
    calls = []
    register_handler("waitlist.promote", lambda ctx: calls.append(ctx.actor.role))
    with maker() as s:
        r = apply_command(s, Actor.system(), LiveCommand(command_id=uuid.uuid4(), session_id=world.session_id,
                                                          kind="waitlist.promote", payload={"target_id": str(uuid.uuid4())}))
    assert r.status == "applied" and calls == ["system"]


def test_body_hash_는_command_id_epoch_client_generation_에_무관하다():
    sid = uuid.uuid4()
    a = LiveCommand(command_id=uuid.uuid4(), session_id=sid, kind="hand.set", payload={"raised": True}, expected_epoch=1, client_generation=1)
    b = LiveCommand(command_id=uuid.uuid4(), session_id=sid, kind="hand.set", payload={"raised": True}, expected_epoch=2, client_generation=9)
    c = LiveCommand(command_id=uuid.uuid4(), session_id=sid, kind="hand.set", payload={"raised": False})
    assert a.body_hash() == b.body_hash() != c.body_hash()
