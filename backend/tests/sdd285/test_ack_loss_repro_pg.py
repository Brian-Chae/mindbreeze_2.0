"""SDD-285 — `capture.start` 응답(ACK) 유실 가설 서버측 재현 (로컬 PG 임시 DB 전용, dev/운영 DB 접속 없음).

검증 항목
 R1 ACK 가 앱에 못 가도(서버는 commit 완료) 같은 command_id 재전송은 duplicate 로 같은 stream 을 돌려준다.
 R2 handler 예외/교착이면 ledger·stream 이 남지 않고(롤백) 같은 ID 재시도가 정상 적용된다.
 R3 새 command_id 재시작은 이전 stream 을 superseded 로 만들고 generation 을 올린다(운영 4명은 generation 1 뿐 → 앱이 새 ID 를 보내지 않았다).
 R4 회차 행(sessions) 락을 먼저 쥔 다른 트랜잭션과 엇갈려도 교착이 없다(S2 이전엔 epoch→sessions KEY SHARE vs sessions→epoch 로 교착).
 R5 capture.start 만 40명 동시에 와도 epoch 락 직렬화로 교착은 없다.
"""
from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import sqlalchemy as sa
from sqlalchemy.exc import DBAPIError

from app.models.live_state import CaptureStream, LiveCommandLedger
from app.services import session_live_commands as slc
from app.services.session_live_commands import LiveCommand, apply_command
from app.services.session_live_ledger import lock_epoch

PAYLOAD = {"device_profile": "t", "algorithm_version": "1", "model_version": "1"}


def _start(world, cid=None):
    return LiveCommand(command_id=cid or uuid.uuid4(), session_id=world.session_id, kind="capture.start", payload=dict(PAYLOAD))


def _warm(maker, world):
    """epoch 행을 미리 만든다(첫 INSERT 의 FK 락이 시험을 흐리지 않게)."""
    with maker() as s:
        apply_command(s, world.member(1), _start(world))


def _streams(maker, world):
    with maker() as s:
        return s.execute(sa.select(CaptureStream.generation, CaptureStream.status).where(
            CaptureStream.session_id == world.session_id).order_by(CaptureStream.generation)).all()


def test_R1_ACK유실_후_같은ID_재전송은_duplicate로_같은_stream(maker, world):
    cmd = _start(world)
    with maker() as s:
        first = apply_command(s, world.member(0), cmd)  # 서버 commit 완료, ACK 는 앱에 가지 못했다고 가정(결과를 버림)
    with maker() as s:
        again = apply_command(s, world.member(0), cmd)
    assert first.status == "applied" and not first.duplicate
    assert again.duplicate and again.status == "applied"
    assert again.result["stream_id"] == first.result["stream_id"] and again.result["participant_id"]
    assert len(_streams(maker, world)) == 1


def test_R2_handler예외면_흔적없이_롤백되고_같은ID_재시도가_적용된다(maker, world):
    real = slc._HANDLERS["capture.start"]

    def boom(ctx):
        real(ctx)
        raise sa.exc.OperationalError("stmt", {}, Exception("deadlock detected"))

    slc._HANDLERS["capture.start"] = boom
    cmd = _start(world)
    raised = False
    with maker() as s:
        try:
            apply_command(s, world.member(0), cmd)
        except sa.exc.OperationalError:
            raised = True  # 운영: _run_command_sync 가 그대로 전파 → ACK 없음
    assert raised
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(LiveCommandLedger).where(LiveCommandLedger.command_id == cmd.command_id)) == 0
    assert _streams(maker, world) == []
    slc._HANDLERS["capture.start"] = real
    with maker() as s:
        retry = apply_command(s, world.member(0), cmd)
    assert retry.status == "applied" and not retry.duplicate
    assert len(_streams(maker, world)) == 1


def test_R3_새ID_재시작은_이전_stream을_superseded로_만든다(maker, world):
    with maker() as s:
        apply_command(s, world.member(0), _start(world))
    with maker() as s:
        apply_command(s, world.member(0), _start(world))
    rows = _streams(maker, world)
    assert [(int(g), st) for g, st in rows] == [(1, "superseded"), (2, "active")]


def test_R4_sessions행락과_엇갈려도_락순서_고정으로_교착이_없다(maker, world):
    _warm(maker, world)
    outcome: dict[str, object] = {}
    a_locked, b_started = threading.Event(), threading.Event()

    def contender():  # REST/호스트 경로 흉내: sessions 행 FOR UPDATE → 이후 epoch 락(auth_revision 갱신 등)
        with maker() as s:
            try:
                s.execute(sa.text("select id from sessions where id=:i for update"), {"i": world.session_id})
                a_locked.set()
                b_started.wait(5)
                time.sleep(0.6)  # B 가 epoch 락을 쥐고 capture_stream INSERT(FK → sessions KEY SHARE)에서 대기하도록
                lock_epoch(s, world.session_id)
                s.commit()
                outcome["A"] = "ok"
            except DBAPIError as exc:
                s.rollback()
                outcome["A"] = "deadlock" if "deadlock" in str(exc).lower() else repr(exc)

    def start():
        a_locked.wait(5)
        with maker() as s:
            b_started.set()
            try:
                outcome["B_res"] = apply_command(s, world.member(0), _start(world))
                outcome["B"] = "ok"
            except DBAPIError as exc:
                s.rollback()
                outcome["B"] = "deadlock" if "deadlock" in str(exc).lower() else repr(exc)

    ta, tb = threading.Thread(target=contender), threading.Thread(target=start)
    ta.start(); tb.start(); ta.join(30); tb.join(30)
    # 수정 전(S2 이전)에는 여기서 교착이 났다(epoch→sessions KEY SHARE vs sessions→epoch). S2 로 capture 명령도 sessions→epoch 순서를 지킨다.
    assert outcome.get("A") == "ok" and outcome.get("B") == "ok", outcome


def test_R5_capture_start_40명_동시는_교착없이_모두_적용(maker):
    from tests.sdd246.commands.conftest import World
    world = World(maker, 41)
    _warm(maker, world)
    members = list(range(40))
    barrier = threading.Barrier(32)

    def run(i):
        with maker() as s:
            try:
                barrier.wait(10)
            except threading.BrokenBarrierError:
                pass
            try:
                return apply_command(s, world.member(i), _start(world)).status
            except DBAPIError as exc:
                return "error:" + str(exc)[:60]

    with ThreadPoolExecutor(max_workers=32) as pool:
        res = list(pool.map(run, members))
    assert res.count("applied") == 40, res
