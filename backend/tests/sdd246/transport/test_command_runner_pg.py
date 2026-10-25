"""SDD-246 T05 — 명령 실행기(apply_command → commit → drain → 방송) 업무 연결 시험 (실제 PG + Redis)."""
from __future__ import annotations

import uuid

import pytest
import sqlalchemy as sa

from app.models.live_state import LiveOutbox
from app.models.session import Session as SessionModel, SessionParticipant
from app.services import class_participation_service as cps
from app.services.session_live_state import Scope
from tests.sdd246.transport.conftest import make_cmd, wire_cmd


def _run(maker, world, actor, kind, payload=None, **kw):
    with maker() as s:
        return cps.run_live_command(s, actor, make_cmd(world, kind, payload, **kw))


def _pdata(maker, pid):
    with maker() as s:
        p = s.get(SessionParticipant, pid)
        return bool(p.raise_hand), bool(p.speaking)


def test_손들기_업무상태가_DB에_반영되고_ack_cursors를_돌려준다(maker, world):
    m = world.member(0)
    out = _run(maker, world, m, "hand.set", {"raised": True})
    assert out.ack["status"] == "applied" and out.ack["committed"] is True
    assert _pdata(maker, m.participant_id) == (True, False)
    assert out.ack["cursors"], "ACK 는 projection 이후 cursor 를 포함해야 한다"


def test_손들기_내리기_왕복이_host_audience에_순서대로_도착한다(maker, world, live):
    m = world.member(0)
    got: list[dict] = []
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
        cps.publish_pending(s, live, world.session_id, got.append)  # seed 방송 소진
    got.clear()
    ids = []
    for raised in (True, False, True, False):
        out = _run(maker, world, m, "hand.set", {"raised": raised})
        assert out.ack["status"] == "applied"
        ids.append(out.ack["command_id"])
        with maker() as s:
            cps.publish_pending(s, live, world.session_id, got.append)
    host_events = [e for e in got if e["audience"] == "host" and e["domain"] == "speaking"]
    assert [e["payload"]["hand_raised"] for e in host_events] == [True, False, True, False]
    assert [int(e["seq"]) for e in host_events] == sorted(int(e["seq"]) for e in host_events)
    assert [int(e["entity_version"]) for e in host_events] == sorted(int(e["entity_version"]) for e in host_events)
    assert [e["command_id"] for e in host_events] == ids


def test_이미_같은_상태의_손들기는_새_event를_만들지_않는다(maker, world):
    m = world.member(0)
    _run(maker, world, m, "hand.set", {"raised": True})
    with maker() as s:
        before = s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == world.session_id))
    out = _run(maker, world, m, "hand.set", {"raised": True})
    assert out.ack["status"] == "applied"
    with maker() as s:
        after = s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == world.session_id))
    assert after == before


def test_같은_command_id_재시도는_duplicate이고_부작용이_한번이다(maker, world):
    m = world.member(0)
    cid = uuid.uuid4()
    first = _run(maker, world, m, "hand.set", {"raised": True}, command_id=cid)
    again = _run(maker, world, m, "hand.set", {"raised": True}, command_id=cid)
    assert first.ack["status"] == "applied" and again.ack["status"] == "duplicate"
    with maker() as s:
        n = s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(
            LiveOutbox.session_id == world.session_id, LiveOutbox.command_id == cid))
    assert n == 1


def test_member는_호스트_명령을_거절당한다(maker, world):
    m = world.member(0)
    out = _run(maker, world, m, "session.end", {"reason": "done"})
    assert out.ack["status"] == "rejected" and out.ack["code"] == "forbidden"


def test_호스트가_발언권을_주면_손이_내려가고_can_publish가_event에_실린다(maker, world, live):
    m = world.member(0)
    h = world.host()
    with maker() as s:  # can_publish 규칙: 온라인 그룹 ≤20
        row = s.get(SessionModel, world.session_id)
        row.location_type = "online"
        s.commit()
    _run(maker, world, m, "hand.set", {"raised": True})
    out = _run(maker, world, h, "speaking.set",
               {"target_id": str(m.participant_id), "can_publish": True, "expected_grant_version": None}, target_id=str(m.participant_id))
    assert out.ack["status"] == "applied", out.ack
    assert _pdata(maker, m.participant_id) == (False, True)
    got = []
    with maker() as s:
        cps.publish_pending(s, live, world.session_id, got.append)
    last = [e for e in got if e["audience"] == f"member:{m.participant_id}" and e["domain"] == "speaking"][-1]
    assert last["payload"]["can_publish"] is True and last["payload"]["hand_raised"] is False


def test_session_end는_payload_status_completed를_emit하고_Redis_TTL이_걸린다(maker, world, live):
    h = world.host()
    out = _run(maker, world, h, "session.end", {"reason": "done"})
    assert out.ack["status"] == "applied", out.ack
    with maker() as s:
        assert s.get(SessionModel, world.session_id).status == "completed"
        ev = s.execute(sa.select(LiveOutbox).where(LiveOutbox.session_id == world.session_id, LiveOutbox.domain == "session")
                       .order_by(LiveOutbox.revision.desc())).scalars().first()
    assert ev.payload["status"] == "completed" and ev.event_type == "session.changed"
    ttl = live.r.ttl(live.meta_key(world.session_id))
    assert 0 < ttl <= 24 * 3600


def test_종료된_회차에_손들기는_거절된다(maker, world):
    _run(maker, world, world.host(), "session.end", {"reason": "done"})
    out = _run(maker, world, world.member(0), "hand.set", {"raised": True})
    assert out.ack["status"] == "rejected" and out.ack["code"] == "session_ended"


def test_신호는_절대_만료시각을_갖고_clear는_expired_tombstone이다(maker, world, live):
    m = world.member(0)
    out = _run(maker, world, m, "signal.send", {"signal_type": "following", "target_scope": "host", "ttl_ms": 5000})
    assert out.ack["status"] == "applied"
    sig = out.result.result
    clear = _run(maker, world, m, "signal.clear", {"signal_id": sig["signal_id"]})
    assert clear.ack["status"] == "applied"
    with maker() as s:
        last = s.execute(sa.select(LiveOutbox).where(LiveOutbox.session_id == world.session_id, LiveOutbox.domain == "signal")
                         .order_by(LiveOutbox.revision.desc())).scalars().first()
    assert last.event_type == "signal.expired"  # 삭제 규칙(T04)


def test_chat_set_enabled는_정책_event를_public으로_낸다(maker, world):
    out = _run(maker, world, world.host(), "chat.set_enabled", {"enabled": True})
    assert out.ack["status"] == "applied", out.ack
    with maker() as s:
        assert s.get(SessionModel, world.session_id).chat_enabled is True
        ev = s.execute(sa.select(LiveOutbox).where(LiveOutbox.session_id == world.session_id, LiveOutbox.domain == "policy")
                       .order_by(LiveOutbox.revision.desc())).scalars().first()
    assert ev.audience_policy == ["public"] and ev.payload["chat_enabled"] is True


def test_waiting_set_ready는_오래된_checkin_revision을_거절한다(maker, world):
    m = world.member(0)
    ok = _run(maker, world, m, "waiting.set_ready", {"ready": True, "checkin_revision": "5"})
    stale = _run(maker, world, m, "waiting.set_ready", {"ready": False, "checkin_revision": "3"})
    assert ok.ack["status"] == "applied"
    assert stale.ack["status"] == "rejected" and stale.ack["code"] == "checkin_revision_stale"


def test_waitlist_cancel은_본인만_하고_멱등이다(maker, world):
    m = world.member(0)
    with maker() as s:
        p = s.get(SessionParticipant, m.participant_id)
        p.is_waitlisted, p.waitlist_position = True, 1
        s.commit()
    first = _run(maker, world, m, "waitlist.cancel")
    assert first.ack["status"] == "applied"
    with maker() as s:
        row = s.execute(sa.select(SessionParticipant).where(SessionParticipant.id == m.participant_id)
                        .execution_options(include_removed=True)).scalar_one()
        assert row.waitlist_cancelled_at is not None
    again = _run(maker, world, m, "waitlist.cancel")  # 취소된 본인 재호출은 거절(참가자 없음)이지 500 이 아니다
    assert again.ack["status"] in ("applied", "rejected")


def test_audio_set은_호스트의_진행중_회차에서만_된다(maker, world, monkeypatch):
    monkeypatch.setattr("app.services.class_audio_service.is_known_track", lambda t: True)
    h = world.host()
    out = _run(maker, world, h, "audio.set", {"track_id": str(uuid.uuid4()), "action": "play", "position_ms": 1000,
                                               "expected_revision": None})
    assert out.ack["status"] == "applied", out.ack
    out2 = _run(maker, world, world.member(0), "audio.set", {"track_id": None, "action": "stop", "position_ms": 0, "expected_revision": None})
    assert out2.ack["code"] == "forbidden"


def test_live_Redis_장애시_commit된_명령은_retryable_committed_true(maker, world, live, monkeypatch):
    from app.services.live_redis.client import LiveRedisUnavailable
    from app.services import session_live_outbox as ob

    m = world.member(0)
    cid = uuid.uuid4()

    def boom(*a, **k):
        raise LiveRedisUnavailable("redis_unreachable")

    monkeypatch.setattr(ob, "drain", boom)
    out = _run(maker, world, m, "hand.set", {"raised": True}, command_id=cid)
    assert out.ack["status"] == "retryable" and out.ack["committed"] is True and out.degraded
    monkeypatch.undo()
    cps.register_live_handlers()
    again = _run(maker, world, m, "hand.set", {"raised": True}, command_id=cid)
    assert again.ack["status"] == "duplicate"  # 새 ID 없이 ledger 결과 재생, 부작용 1회
    assert _pdata(maker, m.participant_id) == (True, False)
