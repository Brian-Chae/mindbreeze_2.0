"""SDD-246 T09 — 분할 복구 자식 alias 의 manifest 판정(seal/manifest 검증)과 사후 close, 실제 PostgreSQL.

부모(과대) 객체는 서버가 거절해 행이 없다. 자식이 같은 순번 범위를 덮어야 complete 이고, 하나라도 빠지면 FEATMISSING 구멍으로 pending 이다.
"""
from __future__ import annotations

import hashlib
import uuid

import pytest

from app.schemas.biosignal import ArtifactAckRequest, ArtifactPresignRequest, EventsRequest
from app.services import biosignal_artifact_service, biosignal_manifest_service, storage_service

STREAM = "11111111-1111-4111-8111-111111111111"
SEG = "22222222-2222-4222-8222-222222222222"


@pytest.fixture(autouse=True)
def _store(monkeypatch):
    monkeypatch.setattr(storage_service, "verify_object_sha256", lambda *a, **k: (True, "v1"))
    monkeypatch.setattr(storage_service, "download_bytes", lambda *_: None)


def _child(alias: str, seq: int, first: int, last: int):
    data = alias.encode()
    return {"artifact_alias": alias, "artifact_kind": "feature", "stream_id": STREAM, "segment_id": SEG, "signal": "eeg", "sequence": 1_000_000 + seq,
            "first_sequence": first, "last_sequence": last, "row_count": last - first + 1, "schema_version": "feature-v1",
            "checksum": hashlib.sha256(data).hexdigest(), "size_bytes": len(data)}


def _upload(maker, world, metas):
    uid, pid = str(world.members[0][0]), str(world.members[0][1])
    with maker() as s:
        res = biosignal_artifact_service.presign(str(world.session_id), ArtifactPresignRequest.model_validate({"participant_id": pid, "chunks": metas}), s, current_user_id=uid)
        ack = {"participant_id": pid, "chunks": [{"artifact_id": c["artifact_id"], "checksum": c["checksum"], "size_bytes": c["size_bytes"]} for c in res["chunks"]]}
        out = biosignal_artifact_service.ack(str(world.session_id), ArtifactAckRequest.model_validate(ack), s, current_user_id=uid)
    assert out["failed"] == 0


def _close(maker, world, metas, last_feature: int):
    uid, pid = str(world.members[0][0]), str(world.members[0][1])
    intent = {"event_type": "close_intent", "intent_id": str(uuid.uuid4()),
              "expected_artifacts": [{"kind": "feature", "alias": m["artifact_alias"], "sha256": m["checksum"]} for m in metas],
              "streams": [{"stream_id": STREAM, "segment_id": SEG, "signal": "eeg", "last_chunk_sequence": None, "last_feature_sequence": last_feature, "received_samples": 0}],
              "snapshots": [], "last_gap_sequence": None, "end_reason": "session_ended", "closed_at_us": "100"}
    with maker() as s:
        return biosignal_manifest_service.record_events(str(world.session_id), EventsRequest.model_validate({"participant_id": pid, "events": [intent]}), s, current_user_id=uid)


def test_자식_alias가_부모_순번_범위를_모두_덮으면_complete(maker, world):
    kids = [_child("FEATURES-BIG-P000", 0, 0, 4), _child("FEATURES-BIG-P001", 1, 5, 9)]
    _upload(maker, world, kids)
    res = _close(maker, world, kids, 9)
    assert res["close_state"] == "complete" and res["missing_artifacts"] == []


def test_자식_하나가_빠지면_순번_구멍으로_pending(maker, world):
    kids = [_child("FEATURES-BIG-P000", 0, 0, 4), _child("FEATURES-BIG-P001", 1, 5, 9)]
    _upload(maker, world, kids[:1])
    res = _close(maker, world, kids[:1], 9)
    assert res["close_state"] == "pending_upload"
    assert any(m["alias"] == "FEATMISSING-eeg-5-9" for m in res["missing_artifacts"])


def test_늦게_올라온_자식_ACK가_새_manifest_revision으로_complete에_수렴(maker, world):
    kids = [_child("FEATURES-BIG-P000", 0, 0, 4), _child("FEATURES-BIG-P001", 1, 5, 9)]
    _upload(maker, world, kids[:1])
    first = _close(maker, world, kids, 9)
    assert first["close_state"] == "pending_upload"
    _upload(maker, world, kids[1:])  # 종료 이후 사후 전송: ACK 가 refresh_if_closing 으로 새 revision 을 만든다
    uid, pid = str(world.members[0][0]), str(world.members[0][1])
    with maker() as s:
        m = biosignal_manifest_service.get_manifest(world.session_id, world.members[0][1], None, s)
    assert m.close_state == "complete"
    with maker() as s:
        from app.models.biosignal import BiosignalManifestRevision
        revs = s.query(BiosignalManifestRevision).filter_by(session_id=world.session_id, participant_id=world.members[0][1]).count()
    assert revs >= 2  # 이전 revision 은 불변으로 남는다


def test_부모_alias에_다른_바이트를_덮을_수_없다(maker, world):
    from fastapi import HTTPException

    a = _child("FEATURES-BIG-P000", 0, 0, 4)
    _upload(maker, world, [a])
    other = {**a, "checksum": hashlib.sha256(b"different").hexdigest(), "size_bytes": 9}
    with pytest.raises(HTTPException) as e:
        _upload(maker, world, [other])
    assert e.value.status_code == 409
