"""SDD-244 T04 PG — biosignal_service 를 실제 PG 제약 위에서 실행한다(부모 FK 는 replica 모드로 생략).

세션/참여자 인가는 SQLite API 테스트(tests/test_sdd244_ingest.py)가 검증한다. 여기서는 PG unique·CHECK·
savepoint 경합 경로와 멱등/충돌/ACK 수렴을 확인한다. 스토리지 검증은 모의이며 실제 객체 저장소 증거가 아니다.
"""
from __future__ import annotations

import copy
import hashlib
import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi import HTTPException

pytestmark = pytest.mark.pg

FIX = Path(__file__).parents[3] / "specs/sdd-244-biosignal-raw-pipeline/contracts/fixtures"
HEADERS = json.loads((FIX / "raw-v2.json").read_text())


@pytest.fixture
def svc(pg_session, monkeypatch):
    from app.services import biosignal_service, eeg_raw_service, storage_service

    pg_session.execute(sa.text("SET LOCAL session_replication_role = replica"))
    sid = uuid.uuid4()
    participant = SimpleNamespace(id=uuid.uuid4(), user_id=None)
    monkeypatch.setattr(eeg_raw_service, "_get_session", lambda s, db: (sid, None))
    monkeypatch.setattr(biosignal_service, "resolve_participant", lambda *a, **k: participant)
    monkeypatch.setattr(storage_service, "verify_object_sha256", lambda *a, **k: (True, "v1"))
    return SimpleNamespace(mod=biosignal_service, db=pg_session, sid=sid, pid=participant.id)


def _req(signal="eeg", index=0, checksum=None, alias=None):
    from app.schemas.biosignal import PresignRequest

    header = copy.deepcopy(next(h for h in HEADERS if h["signal_type"] == signal))
    header["chunk_index"] = index
    data = (FIX / f"{signal}-raw-v2.bin").read_bytes()
    return PresignRequest.model_validate({"chunks": [{
        "chunk_alias": alias or f"RAW-{signal.upper()}-{index}", "header": header,
        "checksum": checksum or hashlib.sha256(data).hexdigest(), "size_bytes": len(data),
    }]})


def test_멱등_충돌_ack_수렴(svc):
    first = svc.mod.presign_raw("x", _req(), svc.db)["chunks"][0]
    again = svc.mod.presign_raw("x", _req(), svc.db)["chunks"][0]
    assert first["chunk_id"] == again["chunk_id"]
    with pytest.raises(HTTPException) as exc:
        svc.mod.presign_raw("x", _req(checksum="f" * 64), svc.db)
    assert exc.value.status_code == 409 and exc.value.detail["code"] == "chunk_identity_conflict"
    from app.schemas.biosignal import AckRequest
    ack = AckRequest.model_validate({"chunks": [{"chunk_id": first["chunk_id"], "checksum": first["checksum"], "size_bytes": first["size_bytes"]}]})
    out = svc.mod.ack_raw("x", ack, svc.db)
    assert out["acked"] == 1 and out["chunks"][0]["upload_status"] == "uploaded"
    assert svc.mod.ack_raw("x", ack, svc.db)["acked"] == 0  # 재ACK 수렴
    count = svc.db.execute(sa.text("SELECT count(*) FROM eeg_raw_chunks WHERE session_id=:s"), {"s": svc.sid}).scalar()
    assert count == 1


def test_세_신호_같은_index와_stream_segment_원장(svc):
    for signal in ("eeg", "ppg", "acc"):
        svc.mod.presign_raw("x", _req(signal), svc.db)
    rows = svc.db.execute(sa.text("SELECT signal_type, count(*) FROM eeg_raw_chunks WHERE session_id=:s GROUP BY 1"), {"s": svc.sid}).all()
    assert {r[0]: r[1] for r in rows} == {"eeg": 1, "ppg": 1, "acc": 1}
    assert svc.db.execute(sa.text("SELECT count(*) FROM biosignal_segments s JOIN biosignal_streams t ON t.id=s.stream_pk WHERE t.session_id=:s"), {"s": svc.sid}).scalar() == 3


def test_manifest_revision_후발_ack는_새_revision_기존_불변(svc):
    from app.schemas.biosignal import AckRequest, EventsRequest
    from app.services import biosignal_manifest_service as man

    first = svc.mod.presign_raw("x", _req(), svc.db)["chunks"][0]
    intent = {
        "event_type": "close_intent", "intent_id": str(uuid.uuid4()), "closed_at_us": "9000000",
        "expected_artifacts": [{"kind": "raw", "alias": first["chunk_alias"], "sha256": first["checksum"]}],
        "streams": [], "snapshots": [], "last_gap_sequence": None, "end_reason": "user_ended",
    }
    out = man.record_events("x", EventsRequest.model_validate({"events": [intent]}), svc.db)
    assert out["close_state"] == "pending_upload" and out["manifest_revision"] == 1
    snap1 = svc.db.execute(sa.text("SELECT content_sha256 FROM biosignal_manifest_revisions WHERE session_id=:s AND revision=1"), {"s": svc.sid}).scalar()
    ack = AckRequest.model_validate({"chunks": [{"chunk_id": first["chunk_id"], "checksum": first["checksum"], "size_bytes": first["size_bytes"]}]})
    svc.mod.ack_raw("x", ack, svc.db)
    rows = svc.db.execute(sa.text("SELECT revision, close_state, content_sha256 FROM biosignal_manifest_revisions WHERE session_id=:s ORDER BY revision"), {"s": svc.sid}).all()
    assert [(r[0], r[1]) for r in rows] == [(1, "pending_upload"), (2, "complete")] and rows[0][2] == snap1
    assert svc.db.execute(sa.text("SELECT revision FROM biosignal_manifest_current WHERE session_id=:s"), {"s": svc.sid}).scalar() == 2
    # 같은 상태 재판정은 새 revision 을 만들지 않는다
    man.refresh(svc.db, svc.sid, svc.pid)
    assert svc.db.execute(sa.text("SELECT count(*) FROM biosignal_manifest_revisions WHERE session_id=:s"), {"s": svc.sid}).scalar() == 2
