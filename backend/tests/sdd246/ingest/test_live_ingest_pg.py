"""SDD-246 T05b — live:metric/live:device 수집(T09 sink), capture ACK result, DeviceEntity 계약 일치, rebuild 방송 워터마크 (PG + Redis 실제)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.models.eeg_feature import EEGFeatureWindow
from app.models.live_state import CaptureStream, LiveOutbox
from app.models.session import SessionParticipant
from app.schemas import session_live_v2 as w
from app.services import class_participation_service as cps
from app.services import live_ingest_service as li
from app.services import session_live_outbox as ob
from app.services.session_live_commands import apply_command
from app.services.session_live_state import Scope
from tests.sdd246.transport.conftest import make_cmd

CONTRACTS = Path(__file__).parents[4] / "contracts" / "session-live-v2"
HASH = "a" * 64
MET = lambda v=1.5, validity="valid": {"value": v, "unit": "index_raw", "validity": validity, "reason": None,  # noqa: E731
                                        "last_valid_sequence": None, "last_valid_observed_at_ms": None}


def _schemas():
    from jsonschema import Draft7Validator
    from referencing import Registry, Resource

    reg = Registry()
    for f in (CONTRACTS / "schema").glob("*.schema.json"):
        doc = json.loads(f.read_text(encoding="utf-8"))
        reg = reg.with_resource(f.name, Resource.from_contents(doc))
        reg = reg.with_resource(doc["$id"], Resource.from_contents(doc))
    return reg, Draft7Validator


def _validate(schema_file: str, fragment: str | None, msg) -> list[str]:
    reg, V = _schemas()
    doc = json.loads((CONTRACTS / "schema" / schema_file).read_text(encoding="utf-8"))
    sch = doc if fragment is None else doc["definitions"][fragment]
    sch = {**sch, "definitions": doc.get("definitions", {})} if fragment else sch
    base = "https://contracts.mindbreeze.local/session-live-v2/" + schema_file
    return [e.message for e in V({**sch, "$id": base}, registry=reg).iter_errors(msg)]


def _start(maker, world, i=0, now=None):
    with maker() as s:
        return apply_command(s, world.member(i), make_cmd(world, "capture.start", {
            "device_profile": "linkband2-v1", "algorithm_version": "web-ts-1", "model_version": "b0"}), now=now)


def _stream(maker, sid):
    with maker() as s:
        return s.get(CaptureStream, uuid.UUID(sid))


def _anchor(maker, sid, *, at, mono_us=0, uncertain=False, unc_ms=20):
    with maker() as s:
        st = s.get(CaptureStream, uuid.UUID(sid))
        st.anchor_server_at, st.anchor_monotonic_us, st.clock_uncertain, st.clock_uncertainty_ms = at, mono_us, uncertain, unc_ms
        s.commit()


def _env(world, started, seq, *, i=0, gen=None, h=HASH, metrics=None):
    uid, pid = world.members[i]
    return {"session_id": str(world.session_id), "participant_id": str(pid), "stream_id": started.result["stream_id"],
            "stream_generation": gen or started.result["generation"], "sequence": str(seq),
            "window_start_us": str((seq - 1) * 1_000_000), "window_end_us": str(seq * 1_000_000), "observed_at_ms": 1760000000000,
            "clock_anchor_id": str(uuid.uuid4()), "clock_uncertainty_ms": 12.5, "device_profile_version": "linkband2-v1",
            "algorithm_version": "web-ts-1", "model_version": "b0", "feature_hash": h, "contact": {"fp1": "contact", "fp2": "contact"},
            "sqi": 0.9, "metrics": metrics if metrics is not None else {"focus_raw": MET(1.5), "relaxation_raw": MET(0.3)}}


def _batch(*windows):
    return {"protocol_version": 2, "schema_version": 1, "windows": list(windows)}


def _ingest(maker, world, data, i=0, now=None):
    with maker() as s:
        return li.ingest_metrics(s, world.member(i), world.session_id, data, now=now)


def _metrics_events(maker, world):
    with maker() as s:
        return s.execute(sa.select(LiveOutbox).where(LiveOutbox.session_id == world.session_id, LiveOutbox.domain == "metrics")
                         .order_by(LiveOutbox.revision)).scalars().all()


@pytest.fixture
def started(maker, world):
    from app.services import session_live_ledger as led  # noqa: F401

    with maker() as s:
        cps.seed_live_state(s, world.session_id)
    now = datetime.now(timezone.utc)
    r = _start(maker, world, now=now)
    assert r.status == "applied"
    _anchor(maker, r.result["stream_id"], at=now, mono_us=0)  # 창 [0,1s] 이 now 시점
    return r


# ---------------- (1) capture ACK result ----------------

def test_capture_start_ACK에_stream_owner_generation_lease_participant가_계약대로_들어간다(maker, world):
    with maker() as s:
        res = apply_command(s, world.member(0), make_cmd(world, "capture.start", {
            "device_profile": "linkband2-v1", "algorithm_version": "web-ts-1", "model_version": "b0"}))
    ack = w.ack_from_result(res, [])
    assert ack["status"] == "applied" and not _validate("ack.schema.json", None, ack), ack
    r = ack["result"]
    assert r["stream_id"] == res.result["stream_id"] and r["participant_id"] == str(world.members[0][1])
    assert r["generation"] == r["owner_generation"] == "1"
    assert r["lease"]["expires_at_ms"] > 0 and r["lease"]["offline_bound_until_ms"] > r["lease"]["expires_at_ms"]
    assert "lease_expires_at" not in r  # ledger 내부 값(ISO 문자열)은 누출하지 않는다


def test_capture_start_이외_ACK는_result가_없거나_계약에_맞는다(maker, world):
    with maker() as s:
        res = apply_command(s, world.member(0), make_cmd(world, "hand.set", {"raised": True}))
    assert "result" not in w.ack_from_result(res, [])


# ---------------- (2) device.changed ↔ DeviceEntity ----------------

def test_stream_수명_event_payload는_DeviceEntity_스키마와_일치한다(maker, world):
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
    r = _start(maker, world)
    with maker() as s:
        ev = s.execute(sa.select(LiveOutbox).where(LiveOutbox.domain == "device", LiveOutbox.session_id == world.session_id)).scalars().one()
    errs = _validate("state.schema.json", "DeviceEntity", ev.payload)
    assert not errs, errs
    assert ev.payload["generation"] == "1" and ev.payload["status"] == "active" and ev.payload["stream_id"] == r.result["stream_id"]


def test_밴드_보고_payload도_DeviceEntity이고_이후_stream_event가_밴드_필드를_보존한다(maker, world, started):
    sid, pid = started.result["stream_id"], world.members[0][1]
    rep = {"protocol_version": 2, "schema_version": 1, "session_id": str(world.session_id), "stream_id": sid, "device_seq": "5",
           "band_state": "connected", "contact": {"fp1": "contact", "fp2": "leadoff"}, "sqi": 0.8, "battery_pct": 77, "state_reason": None}
    with maker() as s:
        out = li.ingest_device(s, world.member(0), world.session_id, rep)
    assert out.response["status"] == "accepted" and out.projected
    with maker() as s:
        evs = s.execute(sa.select(LiveOutbox).where(LiveOutbox.domain == "device").order_by(LiveOutbox.revision)).scalars().all()
        p = s.get(SessionParticipant, pid)
        assert p.band_connected is True and p.band_battery == 77  # v1 호스트 모니터링 호환
    assert not _validate("state.schema.json", "DeviceEntity", evs[-1].payload)
    assert evs[-1].payload["band_state"] == "connected" and evs[-1].payload["battery_pct"] == 77
    # 이후 reanchor 같은 stream 수명 event 는 마지막 밴드 값을 덮어 지우지 않는다
    with maker() as s:
        apply_command(s, world.member(0), make_cmd(world, "capture.reanchor", {
            "stream_id": sid, "clock_probe_id": str(uuid.uuid4()), "device_ticks": "1", "monotonic_us": "1"}))
        last = s.execute(sa.select(LiveOutbox).where(LiveOutbox.domain == "device").order_by(LiveOutbox.revision.desc())).scalars().first()
    assert last.payload["band_state"] == "connected" and last.payload["device_seq"] == "5"
    assert not _validate("state.schema.json", "DeviceEntity", last.payload)


def test_device_seq는_단조_작거나_같으면_duplicate_타인_stream과_비활성_stream은_거절(maker, world, started):
    sid = started.result["stream_id"]
    base = {"protocol_version": 2, "schema_version": 1, "session_id": str(world.session_id), "stream_id": sid, "device_seq": "5",
            "band_state": "connected", "contact": {"fp1": "contact", "fp2": "contact"}, "sqi": None, "battery_pct": None, "state_reason": None}

    def call(msg, i=0):
        with maker() as s:
            return li.ingest_device(s, world.member(i), world.session_id, msg).response

    assert call(base)["status"] == "accepted"
    assert call({**base, "device_seq": "5"})["status"] == "duplicate"
    assert call({**base, "device_seq": "4"})["status"] == "duplicate"
    assert call({**base, "device_seq": "6", "band_state": "lost"})["status"] == "accepted"
    assert call(base, i=1)["code"] == "stream_not_found"  # 타인 stream 은 존재 여부도 알리지 않는다
    assert call({**base, "battery_pct": 101})["code"] == "invalid_message"
    with maker() as s:
        kinds = [(e.payload.get("device_seq"), e.payload["status"]) for e in s.execute(
            sa.select(LiveOutbox).where(LiveOutbox.domain == "device", LiveOutbox.session_id == world.session_id)
            .order_by(LiveOutbox.revision)).scalars()]
    # start 1 + accepted 2 (duplicate 는 outbox 에 쓰지 않는다)
    assert kinds == [(None, "active"), ("5", "active"), ("6", "active")], kinds
    _start(maker, world)  # 새 stream 이 이전 stream 을 superseded 로 닫는다
    assert call({**base, "device_seq": "99"})["code"] == "stream_not_active"


# ---------------- (3) metric ingest ----------------

def test_metric_수락은_feature를_저장하고_durable_ack와_최신값_metrics_event를_만든다(maker, world, started):
    out = _ingest(maker, world, _batch(_env(world, started, 1), _env(world, started, 2)))
    acks = out.response["acks"]
    assert [a["status"] for a in acks] == ["accepted", "accepted"] and all(a["durable"] for a in acks)
    assert not _validate("metric.schema.json", "MetricAckBatch", out.response)
    with maker() as s:
        rows = s.execute(sa.select(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id)
                         .order_by(EEGFeatureWindow.window_index)).scalars().all()
    assert [r.window_index for r in rows] == [1, 2] and rows[0].focus_index == 1.5 and rows[0].relaxation_index == 0.3
    assert rows[0].play_group_id == started.result["stream_id"] and rows[0].source_feature_alias == HASH
    evs = _metrics_events(maker, world)
    assert len(evs) == 1, "한 배치는 가장 새 창 하나만 투영(고빈도 outbox 폭증 방지)"
    assert evs[0].payload["sequence"] == "2" and evs[0].audience_policy == ["host", f"member:{world.members[0][1]}"]
    assert not _validate("state.schema.json", "MetricsEntity", evs[0].payload)
    assert out.projected


def test_invalid_warming_up_값은_0으로_저장되지_않고_null이다(maker, world, started):
    m = {"focus_raw": MET(None, "invalid"), "relaxation_raw": MET(None, "warming_up"), "bpm": {**MET(None, "gap"), "unit": "beats_per_min"}}
    out = _ingest(maker, world, _batch(_env(world, started, 1, metrics=m)))
    assert out.response["acks"][0]["status"] == "accepted"
    with maker() as s:
        r = s.scalars(sa.select(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id)).one()
    assert r.focus_index is None and r.relaxation_index is None and r.heart_rate is None


def test_같은_sequence_같은_hash는_duplicate_다른_hash는_충돌로_거절되고_덮어쓰지_않는다(maker, world, started):
    first = _ingest(maker, world, _batch(_env(world, started, 1)))
    assert first.response["acks"][0]["status"] == "accepted"
    dup = _ingest(maker, world, _batch(_env(world, started, 1)))
    assert dup.response["acks"][0]["status"] == "duplicate" and dup.response["acks"][0]["durable"] is True
    bad = _ingest(maker, world, _batch(_env(world, started, 1, h="b" * 64, metrics={"focus_raw": MET(9.9)})))
    a = bad.response["acks"][0]
    assert a["status"] == "rejected" and a["code"] == "feature_hash_conflict" and a["durable"] is False
    with maker() as s:
        r = s.scalars(sa.select(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id)).one()
    assert r.focus_index == 1.5  # 덮어쓰기 없음
    assert len(_metrics_events(maker, world)) == 1  # duplicate 는 새 투영을 만들지 않는다


def test_participant_mismatch_타인_stream_구_generation은_저장도_투영도_없다(maker, world, started):
    other = _start(maker, world, i=1)
    # 타인 participant 를 주장
    forged = _env(world, started, 1)
    forged["participant_id"] = str(world.members[1][1])
    # 타인 stream 을 내 participant 로 전송
    steal = _env(world, other, 2)
    steal["participant_id"] = str(world.members[0][1])
    # 구 generation
    stale = _env(world, started, 3, gen="9")
    acks = _ingest(maker, world, _batch(forged, steal, stale)).response["acks"]
    assert [a["code"] for a in acks] == ["participant_mismatch", "stream_not_found", "stale_owner_generation"]
    assert all(a["status"] == "rejected" and a["durable"] is False for a in acks)
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id)) == 0
    assert _metrics_events(maker, world) == []


def test_superseded_stream의_늦은_metric은_이력으로만_저장되고_live를_못_바꾼다(maker, world, started):
    new = _start(maker, world)  # started 는 superseded
    assert new.result["generation"] == "2"
    late = _ingest(maker, world, _batch(_env(world, started, 1)))
    a = late.response["acks"][0]
    assert a["status"] == "accepted" and a["durable"] is True  # 이력은 보존(데이터 유실 방지)
    assert late.projected is False and _metrics_events(maker, world) == []  # 구 owner 는 live 최신값을 못 바꾼다
    # 구 generation 을 새 stream 에 주장하면 fencing 거절
    forged = _ingest(maker, world, _batch(_env(world, new, 1, gen="1")))
    assert forged.response["acks"][0]["code"] == "stale_owner_generation"
    ok = _ingest(maker, world, _batch(_env(world, new, 1)))
    assert ok.response["acks"][0]["status"] == "accepted" and ok.projected


def test_종료_cutoff_이후_창은_거절_이전_창은_저장하되_live에는_투영하지_않는다(maker, world):
    now = datetime.now(timezone.utc)
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
    r = _start(maker, world, now=now - timedelta(minutes=5))
    sid = r.result["stream_id"]
    _anchor(maker, sid, at=now - timedelta(minutes=2), mono_us=0)
    with maker() as s:
        st = s.get(CaptureStream, uuid.UUID(sid))
        st.cutoff_at, st.cutoff_code, st.status, st.close_deadline_at = now - timedelta(minutes=1), "completed", "ended", now + timedelta(hours=24)
        st.lease_expires_at = None
        s.commit()
    before = _env(world, r, 5)   # [4s,5s] → anchor 기준 2분 전 → cutoff(1분 전) 이전
    after = _env(world, r, 130)  # [129s,130s] → 2분 전 + 130s = 10초 후 → cutoff 이후
    acks = _ingest(maker, world, _batch(before, after), now=now).response["acks"]
    assert acks[0]["status"] == "accepted" and acks[0]["durable"] is True
    assert acks[1]["status"] == "rejected" and acks[1]["code"] == "window_after_cutoff"
    assert _metrics_events(maker, world) == [], "종료된 stream 은 이력 저장만, live 최신값으로 투영하지 않는다"


def test_신선도는_서버시각과_anchor로_판정하고_클라이언트_observed_at은_쓰지_않는다(maker, world, started):
    sid = started.result["stream_id"]
    now = _stream(maker, sid).anchor_server_at  # 창 시각은 서버 anchor 기준
    with maker() as s:  # lease 만료 후 수신은 투영하지 않는다(별도 시험) — 여기서는 신선도 판정만 본다
        s.get(CaptureStream, uuid.UUID(sid)).lease_expires_at = now + timedelta(hours=1)
        s.commit()
    cases = [(now, "fresh"), (now + timedelta(seconds=20), "delayed"), (now + timedelta(seconds=120), "stale")]
    for n, (t, expect) in enumerate(cases, start=1):
        # 창 종료가 anchor(now)+n초 → 수신시각 t 와의 차이로 판정
        env = _env(world, started, n)
        _ingest(maker, world, _batch(env), now=t)
        ev = _metrics_events(maker, world)[-1]
        # 마지막 이벤트 freshness 는 해당 호출의 판정
        assert ev.payload["freshness"] == expect, (expect, ev.payload["freshness"])
        assert ev.payload["observed_at_ms"] == int((now + timedelta(seconds=n)).timestamp() * 1000)  # 서버 환산값
        assert ev.payload["observed_at_ms"] != 1760000000000
    # clock_uncertain 이면 time_uncertain, observed_at 은 null
    with maker() as s:
        st = s.get(CaptureStream, uuid.UUID(sid))
        st.clock_uncertain = True
        s.commit()
    _ingest(maker, world, _batch(_env(world, started, 10)), now=now)
    ev = _metrics_events(maker, world)[-1]
    assert ev.payload["freshness"] == "time_uncertain" and ev.payload["observed_at_ms"] is None


def test_투영은_최신값만_이미_더_새_값이_있으면_뒤늦은_창은_저장만_한다(maker, world, started):
    _ingest(maker, world, _batch(_env(world, started, 10)))
    late = _ingest(maker, world, _batch(_env(world, started, 3, h="c" * 64)))
    assert late.response["acks"][0]["status"] == "accepted" and late.response["acks"][0]["durable"] is True
    assert late.projected is False
    evs = _metrics_events(maker, world)
    assert [e.payload["sequence"] for e in evs] == ["10"]
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id)) == 2  # 저장은 둘 다


def test_배치_검증_종합점수_unknown필드_61창_u64_범위는_거절(maker, world, started):
    e = _env(world, started, 1)
    assert _ingest(maker, world, _batch({**e, "total_score": 80})).response["code"] == "invalid_message"
    assert _ingest(maker, world, _batch(*[_env(world, started, n + 1) for n in range(61)])).response["code"] == "invalid_message"
    assert _ingest(maker, world, {"protocol_version": 2, "schema_version": 1, "windows": []}).response["ok"] is False
    big = _env(world, started, 1)
    big["sequence"] = str(2 ** 40)
    assert _ingest(maker, world, _batch(big)).response["code"] == "sequence_out_of_range"
    assert _ingest(maker, world, _batch({**e, "metrics": {"focus_display": {**MET(1), "unit": "score_0_100", "value": 101}}})).response["code"] == "invalid_message"
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id)) == 0


def test_고빈도_metrics_event는_Redis_dedupe_키를_만들지_않는다(maker, world, started, live):
    _ingest(maker, world, _batch(_env(world, started, 1)))
    with maker() as s:
        cps.publish_pending(s, live, world.session_id, lambda ev: None)  # drain 포함
    keys = live.r.keys(f"{live.base(world.session_id)}:dedupe:*")
    with maker() as s:
        mids = {str(e.event_id) for e in s.execute(sa.select(LiveOutbox).where(LiveOutbox.domain == "metrics")).scalars()}
    assert mids and not any(k.split(":dedupe:")[1] in mids for k in keys)
    # 다른 도메인(device 등)은 기존대로 dedupe 키가 있다
    assert keys


def test_metrics_투영은_host와_본인_member에게만_가고_타인_member에게는_안_간다(maker, world, started, live):
    _ingest(maker, world, _batch(_env(world, started, 1)))
    with maker() as s:
        ob.drain(s, live, world.session_id)
        a = ob.snapshot_ready(s, live, world.session_id, Scope("member", world.members[0][1]))
        b = ob.snapshot_ready(s, live, world.session_id, Scope("member", world.members[1][1]))
        h = ob.snapshot_ready(s, live, world.session_id, Scope("host"))
    mine = str(world.members[0][1])
    assert mine in a["metrics"]["entities"] and mine in h["metrics"]["entities"]
    assert not b["metrics"]["entities"], "타 member 는 남의 metrics 를 받지 못한다"


# ---------------- sink 연결 ----------------

def test_기본_sink가_네임스페이스에_연결되어_ingest_unavailable이_해소된다(maker, world, started, monkeypatch):
    from app.ws import session_live_namespace as ns

    monkeypatch.setattr(ns, "_METRIC_SINK", None)
    monkeypatch.setattr(ns, "_DEVICE_SINK", None)
    monkeypatch.setattr(ns, "_open_db", lambda: maker())
    monkeypatch.setattr(ns, "publish_session_sync", lambda sid: 0)
    ns.install_default_ingest_sinks()
    assert ns._METRIC_SINK is not None and ns._DEVICE_SINK is not None
    resp = ns._METRIC_SINK(world.member(0), world.session_id, _batch(_env(world, started, 1)))
    assert resp["acks"][0]["status"] == "accepted"
    # 이미 등록된 sink 는 덮어쓰지 않는다
    sentinel = lambda *a: {"ok": True}  # noqa: E731
    ns.set_metric_sink(sentinel)
    ns.install_default_ingest_sinks()
    assert ns._METRIC_SINK is sentinel


# ---------------- (3) ob.rebuild emitted ----------------

def test_rebuild_후_방송_워터마크가_applied와_같아_전체_재방송이_없다(maker, world, started, live):
    for n in range(1, 4):
        _ingest(maker, world, _batch(_env(world, started, n)))
    got: list = []
    with maker() as s:
        cps.publish_pending(s, live, world.session_id, got.append)
    assert got
    base = live.base(world.session_id)
    # Redis 소실(회차 키 전체) 시뮬레이션: emitted·meta·state 모두 삭제
    for k in live.r.keys(f"{base}:*"):
        if not k.endswith(":fence"):
            live.r.delete(k)
    with maker() as s:
        ob.ensure_ready(s, live, world.session_id)
    meta = live.read_meta(world.session_id)
    assert int(live.r.get(live.emitted_key(world.session_id))) == int(meta["applied_revision"]) > 0
    again: list = []
    with maker() as s:
        n = cps.publish_pending(s, live, world.session_id, again.append)
    assert n == 0 and again == [], "재구축 직후 기존 outbox 가 전부 재방송되면 안 된다"
    # 재구축 후 새 명령은 정상 방송된다
    _ingest(maker, world, _batch(_env(world, started, 9)))
    with maker() as s:
        cps.publish_pending(s, live, world.session_id, again.append)
    assert [e["payload"]["sequence"] for e in again if e["domain"] == "metrics"] and all(e["kind"] for e in again)


# ---------------- (5) 플래그 ----------------

def test_LIVE_PROTOCOL_V2는_settings_필드_기본_False이고_env가_우선한다(monkeypatch):
    from app.config import Settings, settings

    assert Settings.model_fields["live_protocol_v2"].default is False
    monkeypatch.delenv("LIVE_PROTOCOL_V2", raising=False)
    monkeypatch.setattr(settings, "live_protocol_v2", False)
    assert w.live_protocol_v2_enabled() is False
    monkeypatch.setattr(settings, "live_protocol_v2", True)
    assert w.live_protocol_v2_enabled() is True
    monkeypatch.setenv("LIVE_PROTOCOL_V2", "0")
    assert w.live_protocol_v2_enabled() is False


def test_lease_만료_후_수신한_창은_저장만_하고_live로_투영하지_않는다(maker, world, started):
    anchor = _stream(maker, started.result["stream_id"]).anchor_server_at
    out = _ingest(maker, world, _batch(_env(world, started, 1)), now=anchor + timedelta(seconds=45))  # lease 30초 초과, offline 상한 10분 이내
    a = out.response["acks"][0]
    assert a["status"] == "accepted" and a["durable"] is True
    assert out.projected is False and _metrics_events(maker, world) == []
