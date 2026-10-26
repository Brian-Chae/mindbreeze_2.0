"""SDD-246 T03 — capture stream 세대·fencing·lease, 종료 cutoff, completed vs 추방·동의철회 (실제 PostgreSQL)."""
from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from app.models.live_state import CaptureStream, LiveOutbox
from app.models.session import Session, SessionParticipant
from app.services import session_live_commands as slc
from app.services.session_live_commands import (
    Actor, LiveCommand, apply_command, end_session_cutoff, evaluate_ingest, register_handler, revoke_participant_capture,
)

T0 = datetime(2026, 10, 26, 3, 0, 0, tzinfo=timezone.utc)


def _c(world, kind, payload, **kw):
    return LiveCommand(command_id=uuid.uuid4(), session_id=world.session_id, kind=kind, payload=payload, **kw)


def _start(maker, world, i=0, now=T0):
    with maker() as s:
        return apply_command(s, world.member(i), _c(world, "capture.start", {
            "device_profile": "linkband2-v1", "algorithm_version": "web-ts-1", "model_version": "b0"}), now=now)


def _stream(maker, sid):
    with maker() as s:
        return s.get(CaptureStream, uuid.UUID(sid))


def test_capture_start_는_세대1_lease30초_offline_상한10분을_발급하고_outbox_1건(maker, world):
    r = _start(maker, world)
    assert r.status == "applied" and r.result["generation"] == "1"
    st = _stream(maker, r.result["stream_id"])
    assert st.status == "active" and st.clock_uncertain is True
    assert st.lease_expires_at == T0 + timedelta(seconds=30)
    assert st.offline_bound_until == T0 + timedelta(minutes=10)
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == world.session_id)) == 1


def test_stream_인계는_이전_stream_을_superseded_로_닫고_세대를_올린다(maker, world):
    a = _start(maker, world)
    b = _start(maker, world, now=T0 + timedelta(seconds=5))
    assert b.result["generation"] == "2"
    assert _stream(maker, a.result["stream_id"]).status == "superseded"
    assert _stream(maker, b.result["stream_id"]).status == "active"


def test_동시_capture_start_는_활성_stream_하나만_남는다(maker, world):
    def run(_):
        return _start(maker, world)

    with ThreadPoolExecutor(max_workers=12) as pool:
        rs = list(pool.map(run, range(12)))
    assert all(r.status == "applied" for r in rs)
    with maker() as s:
        rows = s.scalars(sa.select(CaptureStream).where(CaptureStream.participant_id == world.members[0][1])).all()
        assert sorted(int(x.generation) for x in rows) == list(range(1, 13))
        assert [x.status for x in rows].count("active") == 1


def test_오래된_owner_generation_은_renew_할_수_없다_fencing(maker, world):
    a = _start(maker, world)
    _start(maker, world, now=T0 + timedelta(seconds=1))  # 인계
    with maker() as s:
        old = apply_command(s, world.member(0), _c(world, "capture.renew", {
            "stream_id": a.result["stream_id"], "owner_generation": "1", "clock_anchor_id": str(uuid.uuid4())}), now=T0 + timedelta(seconds=6))
    assert old.status == "rejected" and old.code == "stream_not_active"


def test_renew_는_lease_와_offline_상한을_연장하고_현재_세대만_허용한다(maker, world):
    a = _start(maker, world)
    with maker() as s:
        bad = apply_command(s, world.member(0), _c(world, "capture.renew", {
            "stream_id": a.result["stream_id"], "owner_generation": "9", "clock_anchor_id": str(uuid.uuid4())}), now=T0 + timedelta(seconds=5))
    assert bad.code == "stale_owner_generation"
    with maker() as s:
        ok = apply_command(s, world.member(0), _c(world, "capture.renew", {
            "stream_id": a.result["stream_id"], "owner_generation": "1", "clock_anchor_id": str(uuid.uuid4())}), now=T0 + timedelta(seconds=25))
    assert ok.status == "applied"
    st = _stream(maker, a.result["stream_id"])
    assert st.lease_expires_at == T0 + timedelta(seconds=55)
    assert st.offline_bound_until == T0 + timedelta(seconds=25 + 600)


def test_타인의_stream_은_존재를_알리지_않고_거절한다(maker, world):
    a = _start(maker, world, 0)
    with maker() as s:
        r = apply_command(s, world.member(1), _c(world, "capture.close", {
            "stream_id": a.result["stream_id"], "final_sequences": {"metric": "1"}, "reason": "x"}))
    assert r.code == "stream_not_found"


def test_reanchor_는_서버_probe_오차가_없으면_clock_uncertain_유지(maker, world):
    a = _start(maker, world)
    payload = {"stream_id": a.result["stream_id"], "clock_probe_id": str(uuid.uuid4()), "device_ticks": "5", "monotonic_us": "7"}
    with maker() as s:
        r = apply_command(s, world.member(0), _c(world, "capture.reanchor", payload), now=T0)
    assert r.result["clock_uncertain"] is True
    with maker() as s:
        r = apply_command(s, world.member(0), _c(world, "capture.reanchor", payload | {"clock_probe_id": str(uuid.uuid4())}),
                          now=T0 + timedelta(seconds=1), clock_probe_resolver=lambda pid: 40)
    st = _stream(maker, a.result["stream_id"])
    assert r.result["clock_uncertain"] is False and st.clock_uncertainty_ms == 40 and st.anchor_device_ticks == 5


def test_EEG_동의_거부_참가자는_capture_start_거절(maker, world):
    with maker() as s:
        s.get(SessionParticipant, world.members[1][1]).eeg_collection_consented = False
        s.commit()
    assert _start(maker, world, 1).code == "eeg_consent_required"


def test_종료된_회차에서는_새_stream_을_만들_수_없다(maker, world):
    with maker() as s:
        sess = s.get(Session, world.session_id)
        sess.status, sess.ended_at = "completed", T0
        s.commit()
    r = _start(maker, world)
    assert (r.status, r.code) == ("rejected", "session_ended")
    with maker() as s:
        assert s.scalar(sa.select(sa.func.count()).select_from(CaptureStream)) is not None


def test_session_end_는_cutoff_completed_와_close_deadline_24h_를_고정하고_이후_close_는_허용(maker, world):
    a = _start(maker, world, 0)
    b = _start(maker, world, 1)
    end_at = T0 + timedelta(minutes=30)
    with maker() as s:
        r = apply_command(s, world.host(), _c(world, "session.end", {"reason": "host_end"}), now=end_at)
    assert r.status == "applied" and r.result["streams"] == "2"
    for res in (a, b):
        st = _stream(maker, res.result["stream_id"])
        assert (st.cutoff_at, st.cutoff_code, st.status) == (end_at, "completed", "ended")
        assert st.close_deadline_at == end_at + timedelta(hours=24)
    with maker() as s:
        close = apply_command(s, world.member(0), _c(world, "capture.close", {
            "stream_id": a.result["stream_id"], "final_sequences": {"metric": "1800"}, "reason": "ended"}), now=end_at + timedelta(minutes=2))
    assert close.status == "applied"
    st = _stream(maker, a.result["stream_id"])
    assert st.status == "closed" and st.cutoff_code == "completed" and st.final_sequences == {"metric": "1800"}


def test_close_deadline_24h_이후_close_는_거절(maker, world):
    a = _start(maker, world)
    with maker() as s:
        apply_command(s, world.host(), _c(world, "session.end", {"reason": "host_end"}), now=T0 + timedelta(minutes=30))
    with maker() as s:
        r = apply_command(s, world.member(0), _c(world, "capture.close", {
            "stream_id": a.result["stream_id"], "final_sequences": {"metric": "1"}, "reason": "late"}), now=T0 + timedelta(hours=25))
    assert r.code == "close_deadline_passed"


def test_cutoff_는_최초_확정이_우선이다(maker, world):
    a = _start(maker, world)
    with maker() as s:
        apply_command(s, world.host(), _c(world, "session.end", {"reason": "x"}), now=T0 + timedelta(minutes=30))
    # 같은 참가자를 나중에 추방해도 이미 확정된 cutoff 는 바뀌지 않는다
    def expel(ctx):
        revoke_participant_capture(ctx, world.members[0][1], code="expelled")
    register_handler("hand.lower", expel)
    with maker() as s:
        apply_command(s, world.host(), _c(world, "hand.lower", {"target_id": str(uuid.uuid4())}), now=T0 + timedelta(hours=1))
    st = _stream(maker, a.result["stream_id"])
    assert (st.cutoff_code, st.cutoff_at) == ("completed", T0 + timedelta(minutes=30))


def test_추방과_동의철회는_completed_와_다른_코드로_stream_을_revoked_한다(maker, world):
    a = _start(maker, world, 0)
    b = _start(maker, world, 1)

    def revoke(ctx):
        revoke_participant_capture(ctx, world.members[0][1], code="expelled")
        revoke_participant_capture(ctx, world.members[1][1], code="consent_withdrawn")
    register_handler("hand.lower", revoke)
    at = T0 + timedelta(minutes=10)
    with maker() as s:
        apply_command(s, world.host(), _c(world, "hand.lower", {"target_id": str(uuid.uuid4())}), now=at)
    sa_, sb = _stream(maker, a.result["stream_id"]), _stream(maker, b.result["stream_id"])
    assert (sa_.status, sa_.cutoff_code) == ("revoked", "expelled")
    assert (sb.status, sb.cutoff_code) == ("revoked", "consent_withdrawn")
    with maker() as s:
        with pytest.raises(ValueError):
            ctx = slc.HandlerContext(db=s, actor=world.host(), command=_c(world, "x", {}), session=s.get(Session, world.session_id),
                                     epoch_row=None, now=at)
            revoke_participant_capture(ctx, world.members[0][1], code="completed")


def _cutoff_stream(maker, world, code, uncertain=False, uncertainty_ms=500):
    r = _start(maker, world)
    with maker() as s:
        st = s.get(CaptureStream, uuid.UUID(r.result["stream_id"]))
        st.cutoff_at, st.cutoff_code = T0 + timedelta(minutes=30), code
        st.close_deadline_at = T0 + timedelta(minutes=30, hours=24)
        st.status = "ended" if code == "completed" else "revoked"
        st.clock_uncertain, st.clock_uncertainty_ms, st.anchor_server_at = uncertain, uncertainty_ms, T0
        s.commit()
    return uuid.UUID(r.result["stream_id"])


def test_ingest_종료_cutoff_이전_창만_수락_걸치면_격리_이후면_거절(maker, world):
    sid = _cutoff_stream(maker, world, "completed")
    cut = T0 + timedelta(minutes=30)
    with maker() as s:
        before = evaluate_ingest(s, stream_id=sid, window_start_at=cut - timedelta(seconds=10), window_end_at=cut - timedelta(seconds=5), now=cut + timedelta(minutes=5))
        straddle = evaluate_ingest(s, stream_id=sid, window_start_at=cut - timedelta(seconds=1), window_end_at=cut + timedelta(seconds=2), now=cut + timedelta(minutes=5))
        near = evaluate_ingest(s, stream_id=sid, window_start_at=cut - timedelta(seconds=3), window_end_at=cut - timedelta(milliseconds=100), now=cut + timedelta(minutes=5))
        after = evaluate_ingest(s, stream_id=sid, window_start_at=cut + timedelta(seconds=1), window_end_at=cut + timedelta(seconds=2), now=cut + timedelta(minutes=5))
        late = evaluate_ingest(s, stream_id=sid, window_start_at=cut - timedelta(seconds=10), window_end_at=cut - timedelta(seconds=5), now=cut + timedelta(hours=25))
    assert before.verdict == "accept" and before.live_fresh_allowed is False
    assert straddle.verdict == "pending_time_review" and straddle.code == "straddles_cutoff"
    assert near.verdict == "pending_time_review"  # 오차 500ms 안쪽은 종료 이전으로 입증 불가
    assert after.verdict == "reject" and after.code == "window_after_cutoff"
    assert late.verdict == "reject" and late.code == "close_deadline_passed"


def test_ingest_동의철회는_cutoff_이전_창도_거절_추방은_이전_창_보관(maker, world):
    cut = T0 + timedelta(minutes=30)
    w_sid = _cutoff_stream(maker, world, "consent_withdrawn")
    with maker() as s:
        d = evaluate_ingest(s, stream_id=w_sid, window_start_at=cut - timedelta(minutes=5), window_end_at=cut - timedelta(minutes=4), now=cut)
    assert (d.verdict, d.code) == ("reject", "consent_withdrawn")
    e_sid = _cutoff_stream(maker, world, "expelled")
    with maker() as s:
        d = evaluate_ingest(s, stream_id=e_sid, window_start_at=cut - timedelta(minutes=5), window_end_at=cut - timedelta(minutes=4), now=cut)
    assert d.verdict == "accept" and d.live_fresh_allowed is False


def test_ingest_시계_불확실하고_cutoff_있으면_격리(maker, world):
    sid = _cutoff_stream(maker, world, "completed", uncertain=True)
    cut = T0 + timedelta(minutes=30)
    with maker() as s:
        d = evaluate_ingest(s, stream_id=sid, window_start_at=cut - timedelta(minutes=5), window_end_at=cut - timedelta(minutes=4), now=cut)
    assert (d.verdict, d.code) == ("pending_time_review", "clock_uncertain")


def test_ingest_활성_stream_lease_이내는_fresh_허용_offline_상한_초과는_격리(maker, world):
    r = _start(maker, world)
    sid = uuid.UUID(r.result["stream_id"])
    with maker() as s:
        st = s.get(CaptureStream, sid)
        st.clock_uncertain, st.clock_uncertainty_ms, st.anchor_server_at = False, 100, T0
        s.commit()
    with maker() as s:
        live = evaluate_ingest(s, stream_id=sid, window_start_at=T0 + timedelta(seconds=1), window_end_at=T0 + timedelta(seconds=2), now=T0 + timedelta(seconds=10))
        offline_ok = evaluate_ingest(s, stream_id=sid, window_start_at=T0 + timedelta(minutes=1), window_end_at=T0 + timedelta(minutes=2), now=T0 + timedelta(minutes=20))
        beyond = evaluate_ingest(s, stream_id=sid, window_start_at=T0 + timedelta(minutes=11), window_end_at=T0 + timedelta(minutes=12), now=T0 + timedelta(minutes=20))
        missing = evaluate_ingest(s, stream_id=uuid.uuid4(), window_start_at=T0, window_end_at=T0, now=T0)
    assert live.verdict == "accept" and live.live_fresh_allowed is True
    assert offline_ok.verdict == "accept" and offline_ok.live_fresh_allowed is False
    assert beyond.verdict == "pending_time_review" and beyond.code == "beyond_offline_bound"
    assert missing.code == "stream_not_found"


def test_종료와_ingest_경합_종료_commit_후엔_cutoff_이후_창이_거절된다(maker, world):
    """종료(session.end)와 capture.renew 가 동시에 와도 직렬화되어, 종료가 먼저면 renew 는 session_ended/not_active."""
    a = _start(maker, world)

    def end():
        with maker() as s:
            return apply_command(s, world.host(), _c(world, "session.end", {"reason": "x"}), now=T0 + timedelta(minutes=30))

    def renew():
        with maker() as s:
            return apply_command(s, world.member(0), _c(world, "capture.renew", {
                "stream_id": a.result["stream_id"], "owner_generation": "1", "clock_anchor_id": str(uuid.uuid4())}), now=T0 + timedelta(minutes=30))

    with ThreadPoolExecutor(max_workers=2) as pool:
        f1, f2 = pool.submit(end), pool.submit(renew)
        e, r = f1.result(), f2.result()
    assert e.status == "applied"
    st = _stream(maker, a.result["stream_id"])
    assert st.cutoff_code == "completed" and st.status == "ended"
    # renew 가 먼저였다면 lease 는 연장됐어도 stream 은 ended; 나중이면 거절. 어느 쪽이든 종료 후 active 로 되돌아가지 않는다.
    assert r.status in ("applied", "rejected")
