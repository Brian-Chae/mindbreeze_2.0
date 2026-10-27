"""SDD-246 T10 — v1 호환 어댑터 (실제 PostgreSQL).

시험 축: 정규화 fixture / HTTP 반복 멱등 / v1·v2 회차 protocol 고정 / capability 입장 규칙 /
legacy_unknown 메타 / seq 위조 금지 / shadow read-only / 단일 경로(apply_command) 부작용.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.models.live_state import LiveCommandLedger, LiveOutbox
from app.models.session import Session as SessionModel, SessionParticipant
from app.services import session_live_commands as slc
from app.services import session_live_legacy as leg
from app.services.session_live_commands import Actor, CommandRejected

FIXTURE = Path(__file__).parents[4] / "contracts" / "session-live-legacy-fixtures" / "cases.json"


def _fill(v, session, participant, other):
    m = {"{session}": str(session), "{participant}": str(participant), "{other}": str(other)}
    if isinstance(v, str):
        return m.get(v, v)
    if isinstance(v, list):
        return [_fill(i, session, participant, other) for i in v]
    if isinstance(v, dict):
        return {k: _fill(i, session, participant, other) for k, i in v.items()}
    return v


CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


# --- 1) 정규화 fixture (DB 불필요) -----------------------------------------------------------

@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_정규화_fixture(case):
    sid, pid, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    actor = Actor(actor_id=uuid.uuid4(), role=case["actor_role"], participant_id=pid if case["actor_role"] == "member" else None)
    call = leg.normalize(case["op"], actor, _fill(case["params"], sid, pid, other))
    exp = _fill(case["expect"], sid, pid, other)
    assert call.kind == exp["kind"]
    assert call.target_id == exp["target_id"]
    expected_payload = dict(exp["payload"])
    expected_payload.pop("participant_ids", None)  # 명시 대상은 extra 로 분리
    assert call.payload == expected_payload
    if "participant_ids" in exp["payload"]:
        assert call.extra["participant_ids"] == exp["payload"]["participant_ids"]


def test_fixture_가짜_최신성_필드_없음():
    forbidden = {"expected_epoch", "client_generation", "expected_entity_version", "expected_grant_version",
                 "expected_revision", "checkin_revision"}
    for c in CASES:
        assert not (forbidden & set(c["expect"]["payload"])), c["name"]


@pytest.mark.parametrize("op", ["features", "feature", "participation_heartbeat", "waiting_room", "nope"])
def test_command_아닌_호출은_변환_거절(op):
    with pytest.raises(leg.UnsupportedLegacyOp):
        leg.normalize(op, Actor(actor_id=uuid.uuid4(), role="member"), {})


def test_live_command에_epoch_세대_버전_없음():
    actor = Actor(actor_id=uuid.uuid4(), role="member", participant_id=uuid.uuid4())
    sid = uuid.uuid4()
    call = leg.normalize("raise_hand", actor, {"participant_id": str(actor.participant_id)})
    cmd = leg.to_live_command(sid, call, uuid.uuid4())
    assert (cmd.expected_epoch, cmd.client_generation, cmd.expected_entity_version) == (None, None, None)


def test_오디오_위치_ms_변환과_비정상값():
    a = Actor(actor_id=uuid.uuid4(), role="host")
    assert leg.normalize("audio_sync", a, {"action": "seek", "position_sec": 1.0005}).payload["position_ms"] == 1001
    assert leg.normalize("audio_sync", a, {"action": "seek", "position_sec": 10**9}).payload["position_ms"] == leg.AUDIO_MAX_MS
    assert leg.normalize("audio_sync", a, {"action": "seek", "position_sec": -5}).payload["position_ms"] == 0
    for bad in (float("nan"), float("inf"), "3", True, None):
        with pytest.raises(leg.LegacyError):
            leg.normalize("audio_sync", a, {"action": "seek", "position_sec": bad})


# --- 2) 실제 apply_command 경로 + 구 응답 ---------------------------------------------------------

def _register_hand_handlers():
    """T05 가 할 일의 합성 대역: 손들기 handler 가 참가자 행을 바꾸고 outbox 를 쓴다."""
    def set_hand(ctx):
        raised = bool(ctx.command.payload["raised"])
        part = ctx.db.execute(select(SessionParticipant).where(SessionParticipant.id == ctx.actor.participant_id)
                              .with_for_update()).scalar_one()
        if part.is_waitlisted:
            raise CommandRejected("participant_waitlisted")
        part.raise_hand = raised
        ctx.db.flush()
        ctx.emit(domain="speaking", event_type="hand.changed", entity_id=str(part.id), entity_version=1,
                 audience=["host", f"member:{part.id}"], payload={"raised": raised})
        ctx.entity_version = 1

    def lower_hand(ctx):
        pid = uuid.UUID(ctx.command.payload["target_id"])
        part = ctx.db.execute(select(SessionParticipant).where(SessionParticipant.id == pid).with_for_update()).scalar_one()
        part.raise_hand = False
        ctx.db.flush()
        ctx.emit(domain="speaking", event_type="hand.changed", entity_id=str(pid), entity_version=1,
                 audience=["host"], payload={"raised": False})
        ctx.entity_version = 1

    slc.register_handler("hand.set", set_hand)
    slc.register_handler("hand.lower", lower_hand)


def _counts(maker, sid):
    with maker() as s:
        n_led = s.execute(select(func.count()).select_from(LiveCommandLedger).where(
            LiveCommandLedger.session_id == sid, LiveCommandLedger.kind != leg.PIN_KIND)).scalar_one()
        n_out = s.execute(select(func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == sid)).scalar_one()
        return n_led, n_out


def test_구앱_raise_hand_구_응답_형식(world, maker, db):
    _register_hand_handlers()
    actor = world.member(0)
    out = leg.execute_v1(db, actor, "raise_hand", world.session_id, {"participant_id": str(actor.participant_id)})
    assert out.body == {"participant_id": str(actor.participant_id), "raise_hand": True, "speaking": False, "can_publish": out.body["can_publish"]}
    assert set(out.body) == {"participant_id", "raise_hand", "speaking", "can_publish"}  # 구 SpeakingStateResponse 키 그대로
    assert out.duplicate is False
    assert _counts(maker, world.session_id) == (1, 1)


def test_구앱_HTTP_반복_재시도는_멱등(world, maker, db):
    """ACK 유실로 같은 raise-hand 를 3번 다시 보내도 부작용(ledger·outbox)은 1번."""
    _register_hand_handlers()
    actor = world.member(0)
    params = {"participant_id": str(actor.participant_id)}
    outs = [leg.execute_v1(db, actor, "raise_hand", world.session_id, params) for _ in range(3)]
    assert [o.duplicate for o in outs] == [False, True, True]
    assert len({o.command_id for o in outs}) == 1
    assert outs[0].body == outs[1].body == outs[2].body
    assert _counts(maker, world.session_id) == (1, 1)


def test_들기_내리기_다시들기는_재시도로_오인되지_않는다(world, maker, db):
    _register_hand_handlers()
    actor = world.member(0)
    params = {"participant_id": str(actor.participant_id)}
    o1 = leg.execute_v1(db, actor, "raise_hand", world.session_id, params)
    o2 = leg.execute_v1(db, actor, "lower_hand", world.session_id, params)
    o3 = leg.execute_v1(db, actor, "raise_hand", world.session_id, params)
    assert [o1.duplicate, o2.duplicate, o3.duplicate] == [False, False, False]
    assert len({o1.command_id, o2.command_id, o3.command_id}) == 3
    assert o3.body["raise_hand"] is True and o2.body["lowered_by"] == "self"
    assert _counts(maker, world.session_id) == (3, 3)


def test_재시도_창을_넘기면_새_명령(world, maker, db):
    _register_hand_handlers()
    actor = world.member(0)
    params = {"participant_id": str(actor.participant_id)}
    t0 = datetime.now(timezone.utc)
    o1 = leg.execute_v1(db, actor, "raise_hand", world.session_id, params, now=t0)
    o2 = leg.execute_v1(db, actor, "raise_hand", world.session_id, params, now=t0 + timedelta(seconds=leg.LEGACY_RETRY_WINDOW_SECONDS + 5))
    assert o1.command_id != o2.command_id and o2.duplicate is False


def test_명시_idempotency_key는_결정적_ID(world, db):
    actor = world.member(0)
    call = leg.normalize("raise_hand", actor, {"participant_id": str(actor.participant_id)})
    a = leg.derive_command_id(db, session_id=world.session_id, actor=actor, call=call, idempotency_key="k-1")
    b = leg.derive_command_id(db, session_id=world.session_id, actor=actor, call=call, idempotency_key="k-1")
    c = leg.derive_command_id(db, session_id=world.session_id, actor=actor, call=call, idempotency_key="k-2")
    other = leg.derive_command_id(db, session_id=world.session_id, actor=world.member(1), call=call, idempotency_key="k-1")
    assert a == b and a != c and a != other


def test_호스트_lower_hand는_hand_lower로_lowered_by_host(world, db):
    _register_hand_handlers()
    m = world.member(0)
    leg.execute_v1(db, m, "raise_hand", world.session_id, {"participant_id": str(m.participant_id)})
    out = leg.execute_v1(db, world.host(), "lower_hand", world.session_id, {"participant_id": str(m.participant_id)})
    assert out.kind == "hand.lower" and out.body["lowered_by"] == "host" and out.body["raise_hand"] is False


def test_거절은_구_상태코드와_메시지로_변환(world, maker, db):
    _register_hand_handlers()
    actor = world.member(0)
    with maker() as s:
        s.execute(SessionParticipant.__table__.update().where(SessionParticipant.id == actor.participant_id).values(is_waitlisted=True))
        s.commit()
    with pytest.raises(leg.LegacyError) as ei:
        leg.execute_v1(db, actor, "raise_hand", world.session_id, {"participant_id": str(actor.participant_id)})
    assert (ei.value.status_code, ei.value.detail) == (403, "대기 중인 참여자는 손을 들 수 없습니다")
    # 거절도 ledger 에 남아 재시도가 같은 결과(부작용 0)
    with pytest.raises(leg.LegacyError) as ei2:
        leg.execute_v1(db, actor, "raise_hand", world.session_id, {"participant_id": str(actor.participant_id)})
    assert ei2.value.status_code == 403


def test_member의_호스트전용_호출은_forbidden_403(world, db):
    _register_hand_handlers()
    m = world.member(0)
    with pytest.raises(leg.LegacyError) as ei:
        leg.execute_v1(db, m, "transition", world.session_id, {"action": "start"})
    assert ei.value.status_code == 403


def test_없는_세션은_404(db):
    with pytest.raises(leg.LegacyError) as ei:
        leg.execute_v1(db, Actor(actor_id=uuid.uuid4(), role="host"), "transition", uuid.uuid4(), {"action": "start"})
    assert ei.value.status_code == 404


def test_handler_미등록은_503_부작용없음(world, maker, db):
    slc._HANDLERS.pop("hand.set", None)
    actor = world.member(0)
    with pytest.raises(leg.LegacyError) as ei:
        leg.execute_v1(db, actor, "raise_hand", world.session_id, {"participant_id": str(actor.participant_id)})
    assert ei.value.status_code == 503
    assert _counts(maker, world.session_id) == (0, 0)


def test_부작용은_apply_command_한_경로(world, db, monkeypatch):
    """어댑터가 apply_command 를 거치지 않고 업무 쓰기를 하지 않는다 — apply_command 를 막으면 아무것도 바뀌지 않는다."""
    _register_hand_handlers()
    calls = []

    def fake(db_, actor, command, **kw):
        calls.append(command)
        return slc.DurableResult(command_id=command.command_id, status="applied", code=None, epoch=1, revision=1,
                                 entity_version=1, result={}, duplicate=False)
    monkeypatch.setattr(leg, "apply_command", fake)
    actor = world.member(0)
    leg.execute_v1(db, actor, "raise_hand", world.session_id, {"participant_id": str(actor.participant_id)})
    assert len(calls) == 1
    part = db.execute(select(SessionParticipant).where(SessionParticipant.id == actor.participant_id)
                      .execution_options(populate_existing=True)).scalar_one()
    assert part.raise_hand is False  # 업무 쓰기는 handler(apply_command 안)에서만


# --- 3) 회차 protocol 고정 ----------------------------------------------------------------------

def test_구_회차_첫_접촉은_v1_legacy_unknown(world, db):
    assert leg.get_session_protocol(db, world.session_id) is None
    pin = leg.pin_session_protocol(db, world.session_id)
    assert (pin.protocol, pin.origin, pin.legacy_unknown) == (1, "legacy_unknown", True)


def test_pin은_first_writer_wins_변경불가(world, db):
    first = leg.pin_session_protocol(db, world.session_id, protocol=2)
    again_v1 = leg.pin_session_protocol(db, world.session_id, protocol=1)
    again_none = leg.pin_session_protocol(db, world.session_id)
    assert first.protocol == again_v1.protocol == again_none.protocol == 2
    assert again_v1.origin == "new_run"


def test_진행중_v1_회차에_신규_웹이_와도_v1_유지(world, db):
    leg.pin_session_protocol(db, world.session_id, protocol=1)
    hello = leg.ClientHello(frozenset({1, 2}), frozenset({"paint_ack"}))
    adm = leg.admit_client(leg.get_session_protocol(db, world.session_id), hello)
    assert adm.action == "allow" and adm.effective_protocol == 1 and adm.notice


def test_v2_회차에_구_앱은_426_부작용없음(world, maker, db):
    _register_hand_handlers()
    leg.pin_session_protocol(db, world.session_id, protocol=2)
    actor = world.member(0)
    for hello in (None, leg.ClientHello(frozenset({1}))):
        with pytest.raises(leg.LegacyError) as ei:
            leg.execute_v1(db, actor, "raise_hand", world.session_id, {"participant_id": str(actor.participant_id)}, hello=hello)
        assert ei.value.status_code == 426 and "업데이트" in ei.value.detail
    assert _counts(maker, world.session_id) == (0, 0)


def test_v2_회차_밴드_capability_없어도_입장은_허용(world, db):
    pin = leg.pin_session_protocol(db, world.session_id, protocol=2)
    hello = leg.ClientHello(frozenset({2}), frozenset({"paint_ack"}))  # ble_capture 없음
    ent = leg.admit_client(pin, hello, flow="entry")
    cap = leg.admit_client(pin, hello, flow="capture")
    assert ent.action == "allow" and ent.capture_available is True
    assert cap.action == "allow" and cap.capture_available is False and cap.missing_capabilities == ("ble_capture",)
    full = leg.admit_client(pin, leg.ClientHello(frozenset({2}), frozenset({"ble_capture"})), flow="capture")
    assert full.capture_available is True


def test_hello_wire_파싱():
    h = leg.ClientHello.from_wire({"protocol_version": 2, "schema_version": 1, "supported_protocol_versions": [1, 2],
                                   "capabilities": ["ble_capture"]})
    assert h.supported_protocol_versions == frozenset({1, 2}) and "ble_capture" in h.capabilities
    assert leg.ClientHello.from_wire(None) is None


def test_알수없는_flow는_거절():
    with pytest.raises(ValueError):
        leg.admit_client(leg.ProtocolPin(uuid.uuid4(), 2, "new_run"), None, flow="bogus")


def test_회차_v2_에서_새_회차_v1_롤백(world, maker):
    """회차마다 독립 pin. 기존 v2 회차는 그대로, 새 회차를 v1 로 선택해도 서로 영향이 없다."""
    with maker() as s:
        old = s.get(SessionModel, world.session_id)
        new = SessionModel(host_id=old.host_id, class_id=old.class_id, seq=2, host_state="assigned", type="meditation",
                           duration_min=30, status="in_progress", participant_mode="group", max_participants=20)
        s.add(new)
        s.commit()
        new_id = new.id
    with maker() as s:
        leg.pin_session_protocol(s, world.session_id, protocol=2)
        leg.pin_session_protocol(s, new_id, protocol=1)
    with maker() as s:
        assert leg.get_session_protocol(s, world.session_id).protocol == 2
        assert leg.get_session_protocol(s, new_id).protocol == 1


def test_pin_동시_경합에서도_한_값(world, maker):
    from concurrent.futures import ThreadPoolExecutor

    def go(p):
        with maker() as s:
            return leg.pin_session_protocol(s, world.session_id, protocol=p).protocol

    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(go, [1, 2, 1, 2, 1, 2, 1, 2]))
    assert len(set(res)) == 1


# --- 4) legacy_unknown 메타 / seq 위조 금지 ---------------------------------------------------------

def test_구행_메타는_unknown이고_seq_시각을_만들지_않는다():
    rows = [{"id": 1, "value": 0.5, "device_seq": 7, "created_at": "2026-01-01T00:00:00Z"}]
    out = leg.annotate_legacy_rows(rows)
    assert out[0]["value"] == 0.5 and out[0]["id"] == 1  # 원 필드 불변
    meta = out[0]["_meta"]
    assert meta["provenance"] == "legacy_unknown"
    assert meta["sequence"] is None and meta["device_time_us"] is None and meta["cursor"] is None
    assert meta["freshness"] == "unknown"
    assert "_meta" not in rows[0]  # 입력 불변


def test_v1_회차_cursor는_없다_가짜_seq금지(world, db):
    pin = leg.pin_session_protocol(db, world.session_id)
    assert leg.legacy_snapshot_cursor(pin) is None
    assert leg.legacy_snapshot_cursor(None) is None
    with pytest.raises(ValueError):
        leg.legacy_snapshot_cursor(leg.ProtocolPin(world.session_id, 2, "new_run"))


# --- 5) shadow 비교는 read-only ----------------------------------------------------------------------

def test_shadow_비교는_쓰기_0(world, maker, db):
    _register_hand_handlers()
    actor = world.member(0)
    out = leg.execute_v1(db, actor, "raise_hand", world.session_id, {"participant_id": str(actor.participant_id)})
    before = _counts(maker, world.session_id)
    with maker() as s:
        ep_before = s.execute(select(LiveOutbox.revision).where(LiveOutbox.session_id == world.session_id)
                              .order_by(LiveOutbox.revision.desc())).scalars().first()
        rep = leg.shadow_compare_participant(s, world.session_id, actor.participant_id, out.body)
        assert rep.match and rep.pin is not None
        assert not s.new and not s.dirty and not s.deleted
        s.rollback()
    drift = dict(out.body, raise_hand=False)
    with maker() as s:
        rep2 = leg.shadow_compare_participant(s, world.session_id, actor.participant_id, drift)
        assert not rep2.match and rep2.diffs["raise_hand"] == (False, True)
    assert _counts(maker, world.session_id) == before
    with maker() as s:
        assert s.execute(select(LiveOutbox.revision).where(LiveOutbox.session_id == world.session_id)
                         .order_by(LiveOutbox.revision.desc())).scalars().first() == ep_before


def test_shadow_비교는_락을_잡지_않는다(world, maker):
    """다른 연결이 epoch 행을 FOR UPDATE 로 쥐고 있어도 shadow 는 즉시 반환한다."""
    from app.services.session_live_ledger import lock_epoch
    holder = maker()
    try:
        lock_epoch(holder, world.session_id)
        with maker() as s:
            s.execute(__import__("sqlalchemy").text("SET LOCAL lock_timeout = '500ms'"))
            rep = leg.shadow_compare_participant(s, world.session_id, world.members[0][1], {"raise_hand": False, "speaking": False})
            assert rep.match
    finally:
        holder.rollback()
        holder.close()


def test_구경로_전이의_commit후_부수효과를_실행한다(world, db):
    """REST(v1 호출)로 종료해도 handler 가 _defer 한 종료 후 파이프라인(리포트 생성 적재)이 실행돼야 한다."""
    from app.services import class_participation_service as cps

    ran: list[str] = []

    def end_handler(ctx):
        ctx.entity_version = 1
        cps._defer(ctx, lambda: ran.append("pipeline"))

    slc.register_handler("session.end", end_handler)
    try:
        leg.execute_v1(db, world.host(), "transition", world.session_id, {"action": "end"})
    finally:
        slc.register_handler("session.end", slc._handle_session_end)
    assert ran == ["pipeline"]
    assert cps._AFTER_COMMIT == {}
