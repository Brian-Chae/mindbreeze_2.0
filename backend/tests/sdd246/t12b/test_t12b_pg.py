"""SDD-246 T12b — 서버 보정 시험: 미래 창 신선도, session.end 즉시 committed ACK, v2 pin 전 경로, 계약 문구."""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import sqlalchemy as sa

from app.models.live_state import CaptureStream
from app.models.session import Session as SessionModel
from app.services import class_participation_service as cps
from app.services import live_ingest_service as li
from app.services.session_live_legacy import PROTOCOL_V2, get_session_protocol, pin_new_run_if_enabled
from tests.sdd246.ingest.test_live_ingest_pg import _anchor, _batch, _env, _ingest, _metrics_events, _start, _stream  # noqa: F401
from tests.sdd246.transport.conftest import make_cmd

CONTRACTS = Path(__file__).parents[4] / "contracts" / "session-live-v2" / "schema"


# ---------------- (1) 미래 창 ----------------

def _stub_stream(**kw):
    return CaptureStream(clock_uncertain=kw.get("uncertain", False))


def test_freshness_of_미래_창은_허용오차를_넘으면_time_uncertain():
    now = datetime.now(timezone.utc)
    st = _stub_stream()
    assert li.freshness_of(st, now + timedelta(seconds=60), now, True) == "time_uncertain"
    assert li.freshness_of(st, now + timedelta(seconds=3), now, True) == "time_uncertain"
    # 허용오차 이내의 미세한 미래(시계 오차)는 fresh 유지
    assert li.freshness_of(st, now + timedelta(milliseconds=500), now, True) == "fresh"
    assert li.freshness_of(st, now - timedelta(seconds=1), now, True) == "fresh"
    assert li.freshness_of(st, now - timedelta(seconds=20), now, True) == "delayed"
    assert li.freshness_of(st, now - timedelta(seconds=120), now, True) == "stale"


def test_미래_창_수신은_저장되고_live_freshness는_time_uncertain(maker, world):
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
    now = datetime.now(timezone.utc)
    r = _start(maker, world, now=now)
    # anchor 를 수신 시각보다 1시간 미래로 → 창 끝이 미래로 환산된다
    _anchor(maker, r.result["stream_id"], at=now + timedelta(hours=1), mono_us=0)
    _ingest(maker, world, _batch(_env(world, r, 1)), now=now)
    ev = _metrics_events(maker, world)[-1]
    assert ev.payload["freshness"] == "time_uncertain"


# ---------------- (2) session.end ACK ----------------

def test_호스트_session_end_ACK는_stale_scope여도_committed_applied로_1초_이내(maker, world):
    h = world.host()
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
    t0 = time.monotonic()
    with maker() as s:
        # 연결이 들고 있는 auth_revision(구 값)으로 실행 → 종료 handler 가 revision 을 올려 ScopeStale 이 된다
        out = cps.run_live_command(s, h, make_cmd(world, "session.end", {"reason": "done"}), auth_revision=0)
    dt = time.monotonic() - t0
    assert out.ack["status"] == "applied" and out.ack["committed"] is True, out.ack
    assert out.ack.get("code") != "scope_stale"
    assert out.auth_revision is not None and out.auth_revision > 0
    assert dt < 1.0, f"session.end ACK {dt:.2f}s"
    with maker() as s:
        assert s.get(SessionModel, world.session_id).status == "completed"


def test_멤버의_scope_stale은_여전히_retryable_committed(maker, world, monkeypatch):
    from app.services.session_live_state import ScopeStale

    m = world.member(0)
    with maker() as s:
        cps.seed_live_state(s, world.session_id)

    def boom(*a, **k):
        raise ScopeStale(0, 1)

    monkeypatch.setattr(cps, "_cursors_for", boom)
    with maker() as s:
        out = cps.run_live_command(s, m, make_cmd(world, "hand.set", {"raised": True}))
    assert out.ack["status"] == "retryable" and out.ack["code"] == "scope_stale" and out.ack["committed"] is True


# ---------------- (4) v2 pin 전 경로 ----------------

def test_플래그_off면_pin이_없다(maker, world, monkeypatch):
    monkeypatch.setenv("LIVE_PROTOCOL_V2", "0")
    with maker() as s:
        pin_new_run_if_enabled(s, world.session_id)
        s.commit()
        assert get_session_protocol(s, world.session_id) is None


def test_pin_new_run_if_enabled는_같은_트랜잭션에서_v2로_고정하고_멱등이다(maker, world):
    with maker() as s:
        pin_new_run_if_enabled(s, world.session_id)
        s.commit()
    with maker() as s:
        pin = get_session_protocol(s, world.session_id)
        assert pin is not None and pin.protocol == PROTOCOL_V2 and pin.origin == "new_run"
        pin_new_run_if_enabled(s, world.session_id)  # 재호출해도 변하지 않는다
        s.commit()
        assert get_session_protocol(s, world.session_id).protocol == PROTOCOL_V2


def test_클래스_회차_생성_create_sessions가_v2로_고정한다(maker, world):
    from app.models.class_program import Class
    from app.services import class_write_service as cws

    with maker() as s:
        cls = s.execute(sa.select(Class).where(Class.created_by == world.host_id)).scalars().first()
        base = s.get(SessionModel, world.session_id)

        class Row:
            host_id = world.host_id
            seq = 2
            session_kind = "regular"
            scheduled_at = datetime.now(timezone.utc) + timedelta(days=1)
            duration_min = 30
            location_type = "online"
            location_address = None
            assignment_override = False

        orig_validate, orig_inst, orig_effect = cws.validate_row_settings, cws.validate_instructor, cws.effect
        cws.validate_row_settings = lambda *a, **k: None
        cws.validate_instructor = lambda *a, **k: None
        cws.effect = lambda *a, **k: None
        try:
            created = cws.create_sessions(s, cls, [Row()])
        finally:
            cws.validate_row_settings, cws.validate_instructor, cws.effect = orig_validate, orig_inst, orig_effect
        sid = created[0].id
        s.commit()
        assert base.id != sid
    with maker() as s:
        pin = get_session_protocol(s, sid)
        assert pin is not None and pin.protocol == PROTOCOL_V2


def test_복제_회차는_pin되고_템플릿은_pin되지_않는다(maker, world):
    from app.services import session_service as ss

    with maker() as s:
        src = s.get(SessionModel, world.session_id)
        clone = ss._clone_session_config(src, host_uuid=world.host_id, organization_id=None, is_template=False,
                                         title="복제", scheduled_at=None, db=s)
        tmpl = ss._clone_session_config(src, host_uuid=world.host_id, organization_id=None, is_template=True,
                                        title="템플릿", scheduled_at=None, db=s)
        s.commit()
        cid, tid = clone.id, tmpl.id
    with maker() as s:
        assert get_session_protocol(s, cid).protocol == PROTOCOL_V2
        assert get_session_protocol(s, tid) is None


# ---------------- (3) 계약 문구 ----------------

def test_스키마_description이_시간축과_renew_필수를_명시한다():
    metric = json.loads((CONTRACTS / "metric.schema.json").read_text(encoding="utf-8"))
    props = next(v for k, v in _walk(metric) if k == "window_start_us")
    assert "capture.reanchor" in props["description"] and "monotonic_us" in props["description"]
    cmd = (CONTRACTS / "command.schema.json").read_text(encoding="utf-8")
    assert "lease 유지 필수" in cmd and "같은 시간축" in cmd


def _walk(node):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "window_start_us" and isinstance(v, dict):
                yield k, v
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def test_서버_환산식은_reanchor_monotonic_us_기준이다(maker, world):
    now = datetime.now(timezone.utc)
    st = CaptureStream(anchor_server_at=now, anchor_monotonic_us=5_000_000, clock_uncertain=False)

    class W:
        window_start_us, window_end_us = 4_000_000, 5_000_000

    s0, e0, anchored = li._window_server_times(st, W(), now)
    assert anchored and e0 == now and s0 == now - timedelta(seconds=1)


# ---------------- 리포트가 v2 저장 지표를 읽는다 ----------------

def test_v2로_저장된_창은_play_group_id가_stream_id이고_리포트_통계_입력으로_읽힌다(maker, world):
    from app.models.eeg_feature import EEGFeatureWindow
    from app.services.class_report_stats_service import compute_class_stats

    with maker() as s:
        cps.seed_live_state(s, world.session_id)
    now = datetime.now(timezone.utc)
    r = _start(maker, world, now=now)
    sid = r.result["stream_id"]
    _anchor(maker, sid, at=now, mono_us=0)
    _ingest(maker, world, _batch(*[_env(world, r, n) for n in (1, 2, 3)]), now=now + timedelta(seconds=3))
    with maker() as s:
        rows = s.execute(sa.select(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id)).scalars().all()
        assert len(rows) == 3 and {str(x.play_group_id) for x in rows} == {sid}
        assert all(x.focus_index is not None for x in rows)
        stats = compute_class_stats(s, s.get(SessionModel, world.session_id))  # v2 행으로 예외 없이 계산된다
        assert isinstance(stats, dict)
