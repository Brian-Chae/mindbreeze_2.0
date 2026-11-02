"""[FIX] 코드 입장 게스트(user 없음) — 입장 자격 → live actor → live:metric 투영 → 호스트 조회/REST 저장까지 (PG + Redis 실제)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models.session import SessionParticipant
from app.services import class_participation_service as cps
from app.services import entry_credential_service as ecs
from app.services import live_ingest_service as li
from app.services import session_live_outbox as ob
from app.services import session_service
from app.services.session_live_commands import apply_command
from app.services.session_live_state import Scope
from tests.sdd246.ingest.test_live_ingest_pg import HASH, MET, _anchor, _batch
from tests.sdd246.transport.conftest import make_cmd


def _guest(maker, world) -> tuple[uuid.UUID, str]:
    with maker() as s:
        p = SessionParticipant(session_id=world.session_id, user_id=None, guest_name="게스트", eeg_collection_consented=True)
        s.add(p)
        s.flush()
        s.refresh(p)
        token, _ = ecs.issue(p)
        pid = p.id
        s.commit()
    return pid, token


def test_게스트_입장자격으로_live_actor를_얻고_지표가_호스트_화면에_투영된다(maker, world):
    with maker() as s:
        cps.seed_live_state(s, world.session_id)
    pid, cred = _guest(maker, world)
    with maker() as s:
        actor = cps.resolve_live_actor(s, world.session_id, None, cred)  # user_id 없음(무토큰 소켓) + entry_credential
    assert actor is not None and actor.role == "member" and actor.participant_id == pid

    now = datetime.now(timezone.utc)
    with maker() as s:
        r = apply_command(s, actor, make_cmd(world, "capture.start", {"device_profile": "linkband2-v1", "algorithm_version": "web-ts-1", "model_version": "b0"}), now=now)
    assert r.status == "applied"
    _anchor(maker, r.result["stream_id"], at=now, mono_us=0)

    env = {"session_id": str(world.session_id), "participant_id": str(pid), "stream_id": r.result["stream_id"],
           "stream_generation": r.result["generation"], "sequence": "1", "window_start_us": "0", "window_end_us": "1000000",
           "observed_at_ms": 1760000000000, "clock_anchor_id": str(uuid.uuid4()), "clock_uncertainty_ms": 12.5,
           "device_profile_version": "linkband2-v1", "algorithm_version": "web-ts-1", "model_version": "b0", "feature_hash": HASH,
           "contact": {"fp1": "contact", "fp2": "contact"}, "sqi": 0.9, "metrics": {"focus_raw": MET(1.5), "relaxation_raw": MET(0.3)}}
    with maker() as s:
        out = li.ingest_metrics(s, actor, world.session_id, _batch(env), now=now)
    assert out.response["acks"][0]["status"] == "projected" and out.projected
    with maker() as s:
        ob.drain(s, cps.get_live_redis(), world.session_id)
        host = ob.snapshot_ready(s, cps.get_live_redis(), world.session_id, Scope("host"))
        mine = ob.snapshot_ready(s, cps.get_live_redis(), world.session_id, Scope("member", pid))
    assert str(pid) in host["metrics"]["entities"], "호스트(코치) 화면에 게스트 지표 포함"
    assert str(pid) in mine["metrics"]["entities"], "본인 화면에도 게스트 지표 포함"

    # REST features/batch 정본 저장(게스트 X-Entry-Credential 경로)과 live-metrics 조회에 게스트 포함
    with maker() as s:
        p = s.get(SessionParticipant, pid)
        from app.schemas.session_live_ingest import parse_metric_batch
        li.store_batch(s, p, world.session_id, parse_metric_batch(_batch(env)))
    with maker() as s:
        out = session_service.get_live_metrics(str(world.session_id), str(world.host_id), s)
    ids = {str(m["participant_id"]) for m in out["metrics"]}
    assert str(pid) in ids


def test_잘못된_입장자격은_live_actor를_얻지_못한다(maker, world):
    pid, cred = _guest(maker, world)
    with maker() as s:
        assert cps.resolve_live_actor(s, world.session_id, None, cred + "x") is None
        assert cps.resolve_live_actor(s, world.session_id, None, None) is None
