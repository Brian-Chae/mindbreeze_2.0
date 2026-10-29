"""앱 재시작으로 고아가 된 pending 산출물 → 유예 후 abandoned 종결 + manifest 종료 (실제 PostgreSQL).

재현: 첫 연결에서 presign 한 normalization 산출물이 앱 강제 종료로 업로드되지 않아 pending 에 남고,
manifest 는 close_state=pending_upload 에 갇혔다.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.biosignal import BiosignalArtifact
from app.models.live_state import CaptureStream
from app.models.session import Session as SessionModel
from app.schemas.biosignal import ArtifactAckRequest, ArtifactPresignRequest, EventsRequest
from app.services import biosignal_artifact_service, biosignal_manifest_service, biosignal_orphan_sweep, storage_service

STREAM = "11111111-1111-4111-8111-111111111111"
SEG = "22222222-2222-4222-8222-222222222222"


@pytest.fixture(autouse=True)
def _store(monkeypatch):
    monkeypatch.setattr(storage_service, "verify_object_sha256", lambda *a, **k: (True, "v1"))
    monkeypatch.setattr(storage_service, "download_bytes", lambda *_: None)


def _meta(alias: str, seq: int):
    data = alias.encode()
    return {"artifact_alias": alias, "artifact_kind": "feature", "stream_id": STREAM, "segment_id": SEG, "signal": "eeg",
            "sequence": seq, "first_sequence": seq, "last_sequence": seq, "row_count": 1, "schema_version": "feature-v1",
            "checksum": hashlib.sha256(data).hexdigest(), "size_bytes": len(data)}


def _presign(maker, world, metas):
    uid, pid = str(world.members[0][0]), str(world.members[0][1])
    with maker() as s:
        return biosignal_artifact_service.presign(
            str(world.session_id), ArtifactPresignRequest.model_validate({"participant_id": pid, "chunks": metas}), s, current_user_id=uid)


def _ack(maker, world, res):
    uid, pid = str(world.members[0][0]), str(world.members[0][1])
    ack = {"participant_id": pid, "chunks": [{"artifact_id": c["artifact_id"], "checksum": c["checksum"], "size_bytes": c["size_bytes"]} for c in res["chunks"]]}
    with maker() as s:
        return biosignal_artifact_service.ack(str(world.session_id), ArtifactAckRequest.model_validate(ack), s, current_user_id=uid)


def _close(maker, world, metas):
    uid, pid = str(world.members[0][0]), str(world.members[0][1])
    intent = {"event_type": "close_intent", "intent_id": str(uuid.uuid4()),
              "expected_artifacts": [{"kind": "feature", "alias": m["artifact_alias"], "sha256": m["checksum"]} for m in metas],
              "streams": [{"stream_id": STREAM, "segment_id": SEG, "signal": "eeg", "last_chunk_sequence": None,
                           "last_feature_sequence": max(m["sequence"] for m in metas), "received_samples": 0}],
              "snapshots": [], "last_gap_sequence": None, "end_reason": "session_ended", "closed_at_us": "100"}
    with maker() as s:
        return biosignal_manifest_service.record_events(
            str(world.session_id), EventsRequest.model_validate({"participant_id": pid, "events": [intent]}), s, current_user_id=uid)


def _state(maker, world):
    with maker() as s:
        return biosignal_manifest_service.get_manifest(world.session_id, world.members[0][1], None, s).close_state


def _age(maker, world, *, hours: int, end_session: bool = True):
    """회차 종료 시각과 산출물 생성 시각을 과거로 돌린다."""
    past = datetime.now(timezone.utc) - timedelta(hours=hours)
    with maker() as s:
        if end_session:
            sess = s.get(SessionModel, world.session_id)
            sess.status, sess.ended_at = "completed", past
        for a in s.query(BiosignalArtifact).filter_by(session_id=world.session_id):
            a.created_at = past
        s.commit()


def _setup_orphan(maker, world):
    """feature 2개 중 하나만 업로드(앱 강제 종료로 나머지는 영영 안 옴) + close intent → pending_upload."""
    metas = [_meta("FEAT-A", 0), _meta("FEAT-B", 1)]
    _ack(maker, world, _presign(maker, world, metas[:1]))
    _presign(maker, world, metas[1:])  # presign 만 받고 업로드 못 함
    assert _close(maker, world, metas)["close_state"] == "pending_upload"
    return metas


def test_유예_안에서는_pending을_건드리지_않는다(maker, world):
    _setup_orphan(maker, world)
    _age(maker, world, hours=1)
    with maker() as s:
        out = biosignal_orphan_sweep.run_sweep(s)
    assert out["abandoned"] == 0
    assert _state(maker, world) == "pending_upload"


def test_회차가_안_끝났으면_오래된_pending도_건드리지_않는다(maker, world):
    _setup_orphan(maker, world)
    _age(maker, world, hours=72, end_session=False)
    with maker() as s:
        assert biosignal_orphan_sweep.run_sweep(s)["abandoned"] == 0
    assert _state(maker, world) == "pending_upload"


def test_유예_후_고아_pending은_abandoned로_종결되고_manifest는_partial(maker, world):
    _setup_orphan(maker, world)
    _age(maker, world, hours=30)
    with maker() as s:
        out = biosignal_orphan_sweep.run_sweep(s)
    assert out["abandoned"] == 1 and out["manifest_revisions"] == 1
    with maker() as s:
        row = s.query(BiosignalArtifact).filter_by(session_id=world.session_id, artifact_alias="FEAT-B").one()
        assert (row.upload_status, row.failure_reason) == ("failed", "abandoned_orphan")
        m = biosignal_manifest_service.get_manifest(world.session_id, world.members[0][1], None, s)
    assert m.close_state == "partial"
    # 멱등: 다시 돌려도 변화 없음
    with maker() as s:
        assert biosignal_orphan_sweep.run_sweep(s)["abandoned"] == 0
    assert _state(maker, world) == "partial"


def test_정리_후에도_늦게_도착한_업로드는_complete로_복구된다(maker, world):
    metas = _setup_orphan(maker, world)
    _age(maker, world, hours=30)
    with maker() as s:
        biosignal_orphan_sweep.run_sweep(s)
    assert _state(maker, world) == "partial"
    _ack(maker, world, _presign(maker, world, metas[1:]))  # failed→pending→uploaded
    assert _state(maker, world) == "complete"


def test_cutoff_deadline이_지난_ended_stream에_closed_at을_기록한다(maker, world):
    now = datetime.now(timezone.utc)
    with maker() as s:
        mk = lambda status, closed, deadline, cutoff=now - timedelta(days=2): CaptureStream(  # noqa: E731
            id=uuid.uuid4(), session_id=world.session_id, participant_id=world.members[0][1], owner_actor_id=uuid.uuid4(),
            generation=int(uuid.uuid4().int % 10**9), status=status, device_profile="d", algorithm_version="a", model_version="m",
            opened_at=now - timedelta(days=2), closed_at=closed, cutoff_at=cutoff, close_deadline_at=deadline)
        expired = mk("ended", None, now - timedelta(hours=1))
        fresh = mk("ended", None, now + timedelta(hours=1), cutoff=now - timedelta(minutes=5))  # cutoff 직후: 클라이언트 close 유예 안
        s.add_all([expired, fresh])
        s.commit()
        ids = (expired.id, fresh.id)
    with maker() as s:
        assert biosignal_orphan_sweep.run_sweep(s)["streams_closed"] == 1
    with maker() as s:
        e, f = s.get(CaptureStream, ids[0]), s.get(CaptureStream, ids[1])
        assert e.closed_at is not None and e.close_reason == "close_deadline_expired" and e.status == "ended"
        assert f.closed_at is None


def test_정상_종료_후_유예_안에_클라이언트_close가_없으면_closed_at을_기록한다(maker, world):
    """회원이 밴드 해제 없이 회차 종료로 떠나면 capture.close 가 오지 않는다 — 24h 를 기다리지 않고 30분 유예 뒤 기록."""
    now = datetime.now(timezone.utc)
    with maker() as s:
        mk = lambda cutoff_ago, closed: CaptureStream(  # noqa: E731
            id=uuid.uuid4(), session_id=world.session_id, participant_id=world.members[0][1], owner_actor_id=uuid.uuid4(),
            generation=int(uuid.uuid4().int % 10**9), status="ended", device_profile="d", algorithm_version="a", model_version="m",
            opened_at=now - timedelta(hours=2), closed_at=closed, cutoff_at=now - cutoff_ago,
            close_deadline_at=now - cutoff_ago + timedelta(hours=24))
        stale = mk(timedelta(minutes=40), None)
        recent = mk(timedelta(minutes=5), None)
        done = mk(timedelta(minutes=40), now - timedelta(minutes=30))
        s.add_all([stale, recent, done])
        s.commit()
        ids = (stale.id, recent.id, done.id)
    with maker() as s:
        assert biosignal_orphan_sweep.run_sweep(s)["streams_closed"] == 1
    with maker() as s:
        a, b, c = (s.get(CaptureStream, i) for i in ids)
        assert a.closed_at is not None and a.close_reason == "session_ended_no_client_close" and a.status == "ended"
        assert b.closed_at is None
        assert c.close_reason is None  # 이미 closed_at 이 있는 행은 건드리지 않는다
