"""SDD-308 3차: 실제 로컬 PG/Redis에서 입장과 32초 측정을 함께 검증한다.

명시 실행: python -m tests.sdd308.test_s5_measurement <pytest 인자>
이 진입점은 기존 PG/Redis fixture의 정리 삭제를 교체하여 합성 증거를 보존한다.
기본 테스트에서는 무거운 측정 시험을 생략하고 S308_MEASURE=1일 때만 실행한다.
HTTP/소켓 서버를 띄우지 않는 서비스 통합 시험이며 실제 네트워크 p95와 구분한다.
"""
from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url


def preserved_pg_url():
    """기존 DB에 접근하지 않고 UUID 시험 DB를 만들고 종료 후에도 보존한다."""
    url = make_url(os.environ.get("SDD246_PG_ADMIN_URL", "postgresql://localhost/postgres"))
    assert url.host in {"localhost", "127.0.0.1", "::1", None}
    admin = sa.create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            conn.execute(sa.text("select 1"))
    except Exception as exc:  # noqa: BLE001 — CI 등 로컬 PG 없는 환경은 sdd246 fixture 와 같이 skip
        admin.dispose()
        pytest.skip(f"로컬 PostgreSQL 에 연결할 수 없다: {exc.__class__.__name__}")
    name = f"sdd308c_{uuid.uuid4().hex[:16]}"
    with admin.connect() as conn:
        conn.execute(sa.text(f'CREATE DATABASE "{name}"'))
    target = url.set(database=name, drivername="postgresql").render_as_string(hide_password=False)
    proc = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
                          cwd=Path(__file__).parents[2], env={**os.environ, "DATABASE_URL": target},
                          capture_output=True, text=True)
    assert proc.returncode == 0, "로컬 합성 DB migration 실패(로그의 비밀값 방지를 위해 출력 생략)"
    print(f"PRESERVED_PG_DATABASE={name}", flush=True)
    yield target
    admin.dispose()


def preserved_live(redis_url, prefix):
    from app.services.live_redis.client import LiveRedis

    live = LiveRedis.from_url(redis_url, prefix=prefix)
    yield live
    live.r.close()


class PreserveEvidence:
    """명시 runner에서만 기존 fixture의 삭제 teardown을 보존 teardown으로 교체한다."""

    @pytest.hookimpl(trylast=True)
    def pytest_collection_modifyitems(self, session, config, items):
        manager = session._fixturemanager
        for fixture in manager._arg2fixturedefs.get("pg_url", []):
            fixture.func = preserved_pg_url
        for fixture in manager._arg2fixturedefs.get("live", []):
            fixture.func = preserved_live


    def pytest_terminal_summary(self, terminalreporter, exitstatus, config):
        target = os.environ.get("S308_REGRESSION_RESULT")
        if not target:
            return
        from app.services import session_live_ledger
        source = Path(session_live_ledger.__file__)
        report = {"exitstatus": int(exitstatus), "ledger_source_path": str(source),
                  "ledger_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                  "counts": {key: len(value) for key, value in terminalreporter.stats.items() if key},
                  "failed": [entry.nodeid for entry in terminalreporter.stats.get("failed", [])],
                  "errors": [entry.nodeid for entry in terminalreporter.stats.get("error", [])]}
        Path(target).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


@pytest.fixture(scope="session")
def pg_url():
    yield from preserved_pg_url()


def _p95(values):
    return sorted(values)[max(0, math.ceil(len(values) * 0.95) - 1)] if values else None


@pytest.mark.skipif(os.environ.get("S308_MEASURE") != "1", reason="명시 실행하는 32초 로컬 측정 시험")
def test_S5_동시_입장과_측정_renew_metric_device_publish(maker, pg_engine, monkeypatch):
    from app.models.live_state import LiveOutbox, LiveSessionEpoch
    from app.services import class_participation_service as cps
    from app.services import live_ingest_service as ingest
    from app.services import session_service
    from app.services.live_redis.client import LiveRedis
    from app.services.session_live_commands import Actor, LiveCommand
    from app.ws import session_live_namespace as namespace
    from tests.sdd308.helpers import build_scene

    n = int(os.environ.get("S308_N", "100"))
    duration = max(30.0, float(os.environ.get("S308_DURATION", "32")))
    redis_url = os.environ.get("SDD246_REDIS_URL", "redis://localhost:6379/11")
    parsed = make_url(redis_url)
    assert parsed.host in {"localhost", "127.0.0.1", "::1"} and parsed.database not in {None, "", "0"}
    live = LiveRedis.from_url(redis_url, prefix=f"sdd308c:{uuid.uuid4().hex}")
    live.r.ping()
    monkeypatch.setenv("LIVE_PROTOCOL_V2", "1")
    # 외부 socket/메일 알림만 차단. 실제 publish/drain은 아래 별도 루프로 수행한다.
    for name in dir(namespace):
        if name.startswith(("emit", "publish", "broadcast")) and callable(getattr(namespace, name)):
            monkeypatch.setattr(namespace, name, lambda *args, **kwargs: None)
    monkeypatch.setattr(session_service, "_notify_promoted", lambda *args, **kwargs: None)
    # 실제 v2 presence handler를 in-process로 호출한다(네트워크 ACK 시간은 측정하지 않음).
    class PresenceSocket:
        def __init__(self):
            self.handlers = {}

        def on(self, name, namespace=None):
            def register(handler):
                self.handlers[name] = handler
                return handler
            return register

    presence_socket = PresenceSocket()
    namespace.register_v2_handlers(presence_socket, namespace._NAMESPACE)
    monkeypatch.setattr(namespace, "_v2_conns", {})
    cps.register_live_handlers()
    cps.set_live_redis(live)
    scene = build_scene(maker, n)
    with maker() as db:
        cps.seed_live_state(db, scene.session_id)
    gate = threading.Barrier(n)
    stop = threading.Event()
    counts = Counter()
    timings = {"renew": [], "entry": []}
    failures = Counter()
    diagnostics = []
    mutex = threading.Lock()
    emitted = []

    def record(key, value=1):
        with mutex:
            counts[key] += value

    def fail(exc, where):
        with mutex:
            failures[f"{where}:{type(exc).__name__}"] += 1

    def db_error(context):
        original = context.original_exception
        if getattr(original, "pgcode", None) == "40P01":
            record("deadlock")
            # PG가 직접 반환한 교착 상세: UUID 합성 데이터만 포함한다.
            with mutex:
                diagnostics.append(str(original))

    sa.event.listen(pg_engine, "handle_error", db_error)

    def command(actor, kind, payload):
        with maker() as db:
            outcome = cps.run_live_command(db, actor, LiveCommand(command_id=uuid.uuid4(), session_id=scene.session_id,
                                                                 kind=kind, payload=payload), live=live)
        ack = outcome.ack
        if ack.get("code") == "projection_pending":
            record("projection_pending")
        if not ack.get("committed"):
            raise AssertionError(f"{kind}:{ack.get('code')}")
        if outcome.result is None or outcome.result.status != "applied":
            raise AssertionError(f"{kind}:rejected")
        return outcome.result.result

    def publisher():
        while not stop.is_set():
            try:
                with maker() as db:
                    cps.publish_pending(db, live, scene.session_id, emitted.append)
            except Exception as exc:
                fail(exc, "publish")
            stop.wait(0.1)

    def member(i):
        uid, pid = scene.members[i]
        actor = Actor(actor_id=uid, role="member", participant_id=pid)
        gate.wait()
        try:
            begin = time.monotonic()
            with maker() as db:
                session_service.enter_session_as_invited(str(scene.session_id), str(uid), db,
                                                         recording_consent=True, recording_notice_version="rec-1")
            with mutex:
                timings["entry"].append(time.monotonic() - begin)
            record("entered")
            command(actor, "entry.enter", {})
            capture = command(actor, "capture.start", {"device_profile": "linkband2-v1", "algorithm_version": "web-ts-1", "model_version": "b0"})
            record("started")
            socket_id, instance_id = str(uuid.uuid4()), str(uuid.uuid4())
            namespace._v2_conns[socket_id] = namespace.V2Conn(
                sid=socket_id, user_id=uid, actor=actor, session_id=scene.session_id, state="READY")
            stream_id = capture["stream_id"]
            started = time.monotonic()
            seq = 0
            next_renew = started
            while time.monotonic() - started < duration:
                seq += 1
                tick = time.monotonic()
                if tick >= next_renew:
                    at = time.monotonic()
                    command(actor, "capture.renew", {"stream_id": stream_id, "owner_generation": int(capture["generation"]),
                                                      "clock_anchor_id": str(uuid.uuid4())})
                    with mutex:
                        timings["renew"].append(time.monotonic() - at)
                    record("renew")
                    next_renew += 10
                    presence = asyncio.run(presence_socket.handlers["live:presence"](socket_id, {
                        "instance_id": instance_id, "visibility": "foreground", "lease_generation": "1"}))
                    record("presence" if presence.get("ok") else "presence_failed")
                    with maker() as db:
                        device = ingest.ingest_device(db, actor, scene.session_id, {
                            "protocol_version": 2, "schema_version": 1, "session_id": str(scene.session_id),
                            "stream_id": stream_id, "device_seq": str(seq), "band_state": "connected",
                            "contact": {"fp1": "contact", "fp2": "contact"}, "sqi": 0.9, "battery_pct": 77, "state_reason": None})
                    record("device_accepted" if device.response.get("status") == "accepted" else "device_failed")
                metric = {"session_id": str(scene.session_id), "participant_id": str(pid), "stream_id": stream_id,
                          "stream_generation": str(capture["generation"]), "sequence": str(seq),
                          "window_start_us": str((seq - 1) * 1_000_000), "window_end_us": str(seq * 1_000_000),
                          "observed_at_ms": int(time.time() * 1000), "clock_anchor_id": str(uuid.uuid4()),
                          "clock_uncertainty_ms": 12.5, "device_profile_version": "linkband2-v1",
                          "algorithm_version": "web-ts-1", "model_version": "b0", "feature_hash": "a" * 64,
                          "contact": {"fp1": "contact", "fp2": "contact"}, "sqi": 0.9,
                          "metrics": {"focus_raw": {"value": 1.5, "unit": "index_raw", "validity": "valid", "reason": None,
                                                    "last_valid_sequence": None, "last_valid_observed_at_ms": None}}}
                with maker() as db:
                    result = ingest.ingest_metrics(db, actor, scene.session_id,
                                                   {"protocol_version": 2, "schema_version": 1, "windows": [metric]})
                record("metric_projected" if result.projected else "metric_failed")
                time.sleep(max(0, 1.0 - (time.monotonic() - tick)))
            command(actor, "capture.close", {"stream_id": stream_id, "reason": "completed", "final_sequences": {"eeg": str(seq)}})
            record("completed")
        except Exception as exc:
            fail(exc, "member")
            if getattr(exc, "status_code", None) == 500:
                record("http500")

    begun = time.monotonic()
    pub = threading.Thread(target=publisher, daemon=True)
    pub.start()
    try:
        with ThreadPoolExecutor(max_workers=n) as executor:
            list(executor.map(member, range(n)))
    finally:
        stop.set()
        pub.join(30)
        sa.event.remove(pg_engine, "handle_error", db_error)
    with maker() as db:
        cps.publish_pending(db, live, scene.session_id, emitted.append)
        epoch = db.get(LiveSessionEpoch, scene.session_id)
        revisions = list(db.scalars(sa.select(LiveOutbox.revision).where(LiveOutbox.session_id == scene.session_id)
                                   .order_by(LiveOutbox.revision)))
        revision = int(epoch.revision)
        expected_broadcast = {(str(row.event_id), audience) for row in db.scalars(
            sa.select(LiveOutbox).where(LiveOutbox.session_id == scene.session_id))
            for audience in row.audience_policy}
    actual_broadcast = {(event["event_id"], event["audience"]) for event in emitted}
    missing_broadcast = expected_broadcast - actual_broadcast
    meta = live.read_meta(scene.session_id)
    from app.services import session_live_ledger as ledger_module
    ledger_source = Path(ledger_module.__file__).read_bytes()
    summary = {"session_id": str(scene.session_id), "ledger_source_path": ledger_module.__file__,
               "ledger_sha256": hashlib.sha256(ledger_source).hexdigest(),
               "lock_epoch_has_session_lock": "SessionModel" in inspect.getsource(ledger_module.lock_epoch), "n": n, "measurement_s": duration, "elapsed_s": round(time.monotonic() - begun, 3),
               "counts": dict(counts), "failures": dict(failures),
               "renew_p95_s": _p95(timings["renew"]), "entry_p95_s": _p95(timings["entry"]),
               "outbox_count": len(revisions), "revision": revision, "applied_revision": int(meta["applied_revision"]),
               "emitted_revision": int(live.r.get(live.emitted_key(scene.session_id)) or 0),
               "broadcast_expected_pairs": len(expected_broadcast), "broadcast_actual_pairs": len(actual_broadcast),
               "broadcast_missing_pairs": len(missing_broadcast),
               "broadcast_missing_sample": sorted(missing_broadcast)[:10],
               "pg_deadlock_diagnostics": diagnostics}
    print("S308_MEASUREMENT " + json.dumps(summary, ensure_ascii=False), flush=True)
    output = os.environ.get("S308_RESULT")
    if output:
        Path(output).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    cps.set_live_redis(None)
    live.r.close()
    assert counts["deadlock"] == 0, summary
    assert not failures, summary
    assert counts["entered"] == counts["started"] == counts["completed"] == n, summary
    assert counts["http500"] == 0 and counts["projection_pending"] <= 49, summary
    assert summary["renew_p95_s"] is not None and summary["renew_p95_s"] <= 2, summary
    assert counts["renew"] >= n * 3 and counts["metric_projected"] >= n * 20, summary
    assert counts["metric_failed"] == counts["device_failed"] == counts["presence_failed"] == 0, summary
    assert counts["presence"] >= n * 3, summary
    # 방송 callback coverage는 기존 replay 경합의 별도 수치다. 워터마크 일치를 누락 0으로 간주하지 않는다.
    assert revisions == list(range(1, revision + 1)), summary
    assert summary["applied_revision"] == summary["emitted_revision"] == revision, summary


@pytest.mark.parametrize("has_class", [True, False])
@pytest.mark.parametrize("system_actor", [True, False])
def test_S5_실제_상태전이_클래스_단독회차_시스템_호스트_멱등(maker, has_class, system_actor):
    from app.models.session import Session
    from app.services import class_participation_service as cps
    from app.services.session_live_commands import Actor, LiveCommand, apply_command
    from tests.sdd308.helpers import build_scene

    scene = build_scene(maker, 1)
    if not has_class:
        with maker() as db:
            from app.models.counseling import CounselingRelationship, CounselingRelationshipCounselor
            relation = CounselingRelationship(counselor_id=scene.host_id, client_user_id=scene.members[0][0],
                                              organization_id=scene.org_id, status="active")
            db.add(relation)
            db.flush()
            db.add(CounselingRelationshipCounselor(relationship_id=relation.id, counselor_id=scene.host_id))
            db.flush()
            row = db.get(Session, scene.session_id)
            row.class_id, row.counseling_relationship_id = None, relation.id
            row.type, row.participant_mode = "clinical", "individual"
            db.commit()
    cps.register_live_handlers()
    actor = Actor.system() if system_actor else Actor(actor_id=scene.host_id, role="host")
    command = LiveCommand(command_id=uuid.uuid4(), session_id=scene.session_id,
                          kind="session.end", payload={"reason": "host_end"})
    with maker() as db:
        before = db.get(Session, scene.session_id).state_version or 0
        result = apply_command(db, actor, command)
    cps.pop_after_commit(command.command_id)  # 외부 메일/녹화 후처리는 실행하지 않는다.
    with maker() as db:
        replay = apply_command(db, actor, command)
        row = db.get(Session, scene.session_id)
        assert row.status == "completed" and row.state_version == before + 1
    assert result.status == "applied", result
    assert replay.duplicate and replay.revision == result.revision


if __name__ == "__main__":
    baseline = os.environ.get("S308_BASELINE_SRC")
    if baseline:
        sys.path.insert(0, baseline)
        import app
        assert Path(app.__file__).resolve().is_relative_to(Path(baseline).resolve())
        print("BASELINE_APP=" + app.__file__, flush=True)
    raise SystemExit(pytest.main(sys.argv[1:], plugins=[PreserveEvidence()]))
