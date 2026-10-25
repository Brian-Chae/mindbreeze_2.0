"""SDD-246 T09 — archive presign/ACK 의 종료 cutoff 게이트, ACK 유실 복구, live 신선도 불변 (실제 PostgreSQL).

스토리지 검증은 모의다(실제 S3 증거 아님). evaluate_ingest(T03)가 판정 기준이다.
"""
from __future__ import annotations

import copy
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from fastapi import HTTPException

from app.models.live_state import CaptureStream, LiveOutbox
from app.schemas.biosignal import AckRequest, ArtifactPresignRequest, PresignRequest
from app.services import biosignal_artifact_service, biosignal_service, storage_service
from app.services.session_live_commands import apply_command, LiveCommand, end_session_cutoff, revoke_participant_capture  # noqa: F401

ROOT = Path(__file__).resolve().parents[4]
FIX = ROOT / "specs/sdd-244-biosignal-raw-pipeline/contracts/fixtures"
HEADERS = json.loads((FIX / "raw-v2.json").read_text())
T0 = datetime(2026, 10, 26, 3, 0, 0, tzinfo=timezone.utc)
STREAM = "11111111-1111-4111-8111-111111111111"
SEG = "22222222-2222-4222-8222-222222222222"


def _raw_meta(first_sample: int, mono0: int = 2_000_000, index: int = 0, count: int = 4):
    """250Hz EEG 창(fixture 와 같은 4샘플): header.anchor.monotonic_us(sample 0)=mono0 → 창 [first, first+4) 의 단조시각이 결정된다."""
    header = copy.deepcopy(next(h for h in HEADERS if h["signal_type"] == "eeg"))
    header.update(stream_id=STREAM, segment_id=SEG, chunk_index=index, first_sample_index=first_sample,
                  end_sample_index_exclusive=first_sample + count, sample_count=count)
    header["anchor"]["monotonic_us"] = str(mono0)
    data = (FIX / "eeg-raw-v2.bin").read_bytes()
    return {"chunk_alias": f"RAW-EEG-{index:06d}", "header": header, "checksum": hashlib.sha256(data + bytes([index])).hexdigest(),
            "size_bytes": len(data)}


def _art_meta(alias: str, mono: tuple[int, int] | None, seq: int = 0):
    data = alias.encode()
    meta = {"artifact_alias": alias, "artifact_kind": "feature", "stream_id": STREAM, "segment_id": SEG, "signal": "eeg",
            "sequence": seq, "row_count": 1, "schema_version": "feature-v1", "checksum": hashlib.sha256(data).hexdigest(),
            "size_bytes": len(data)}
    if mono is not None:
        meta["monotonic_range"] = {"from_us": str(mono[0]), "to_us": str(mono[1])}
    return meta


def _start_stream(maker, world, *, anchor_mono=2_000_000, uncertainty_ms=50, certain=True, now=T0):
    from app.services.session_live_commands import apply_command, LiveCommand

    with maker() as s:
        r = apply_command(s, world.member(0), LiveCommand(command_id=uuid.uuid4(), session_id=world.session_id, kind="capture.start", payload={
            "device_profile": "linkband2-v1", "algorithm_version": "web-ts-1", "model_version": "b0"}), now=now)
        sid = uuid.UUID(r.result["stream_id"])
        st = s.get(CaptureStream, sid)
        st.anchor_server_at, st.anchor_monotonic_us = now, anchor_mono
        st.clock_uncertainty_ms, st.clock_uncertain = uncertainty_ms, not certain
        s.commit()
    return sid


def _cutoff(maker, world, kind: str, at: datetime):
    from app.services.session_live_commands import apply_command, LiveCommand

    with maker() as s:
        if kind == "completed":
            apply_command(s, world.host(), LiveCommand(command_id=uuid.uuid4(), session_id=world.session_id, kind="session.end", payload={"reason": "host_end"}), now=at)
        else:
            from app.services import session_live_commands as slc

            def h(ctx):
                slc.revoke_participant_capture(ctx, world.members[0][1], code=kind)
                ctx.entity_version = 1
                ctx.result = {}

            slc.register_handler("session.end", h)  # 고립 시험: 레지스트리는 conftest 가 복원한다
            apply_command(s, world.host(), LiveCommand(command_id=uuid.uuid4(), session_id=world.session_id, kind="session.end", payload={"reason": "x"}), now=at)


@pytest.fixture
def store(monkeypatch):
    state = {"verify": (True, "v1")}
    monkeypatch.setattr(biosignal_service, "_now", lambda: T0 + timedelta(hours=1))
    monkeypatch.setattr(storage_service, "verify_object_sha256", lambda *a, **k: state["verify"])
    monkeypatch.setattr(storage_service, "download_bytes", lambda *_: None)
    return state


def _presign(maker, world, chunks, stream_id=None, **kw):
    with maker() as s:
        uid = str(world.members[0][0])
        body = {"participant_id": str(world.members[0][1]), "chunks": chunks}
        if stream_id is not None:
            body["capture_stream_id"] = str(stream_id)
        return biosignal_service.presign_raw(str(world.session_id), PresignRequest.model_validate(body), s, current_user_id=uid, **kw)


def _presign_art(maker, world, chunks, stream_id=None):
    with maker() as s:
        body = {"participant_id": str(world.members[0][1]), "chunks": chunks}
        if stream_id is not None:
            body["capture_stream_id"] = str(stream_id)
        return biosignal_artifact_service.presign(str(world.session_id), ArtifactPresignRequest.model_validate(body), s, current_user_id=str(world.members[0][0]))


def _raw_rows(maker, world):
    from app.models.record import EEGRawChunk

    with maker() as s:
        return s.scalar(sa.select(sa.func.count()).select_from(EEGRawChunk).where(EEGRawChunk.session_id == world.session_id))


def _code(exc: HTTPException) -> str:
    return exc.detail["code"]


# ── cutoff ±1창 ────────────────────────────────────────────────────────────

def test_종료_이전_창은_종료_후에도_수락되고_live_신선도를_바꾸지_않는다(maker, world, store):
    stream = _start_stream(maker, world)
    _cutoff(maker, world, "completed", T0 + timedelta(seconds=60))
    # 창 [mono 2.0s, 3.0s) → 서버시각 T0+0~1s, cutoff(T0+60s) 이전
    res = _presign(maker, world, [_raw_meta(0)], stream)
    assert res["archive_ingest"] == {"verdict": "accept", "code": None, "live_fresh_applied": False}
    assert len(res["chunks"]) == 1 and _raw_rows(maker, world) == 1


def test_cutoff를_걸친_창은_pending_time_review로_격리되고_행이_만들어지지_않는다(maker, world, store):
    stream = _start_stream(maker, world)
    _cutoff(maker, world, "completed", T0 + timedelta(seconds=60))
    # 창 sample 14_998~15_002 → 서버시각 T0+59.992s ~ T0+60.008s (cutoff 를 걸친다)
    with pytest.raises(HTTPException) as e:
        _presign(maker, world, [_raw_meta(14_998)], stream)
    assert e.value.status_code == 409 and _code(e.value) == "pending_time_review" and e.value.detail["reason"] == "straddles_cutoff"
    assert _raw_rows(maker, world) == 0


def test_cutoff_이후_창은_403으로_거절한다(maker, world, store):
    stream = _start_stream(maker, world)
    _cutoff(maker, world, "completed", T0 + timedelta(seconds=60))
    with pytest.raises(HTTPException) as e:
        _presign(maker, world, [_raw_meta(15_020)], stream)  # 서버시각 T0+60.08s (cutoff+오차 50ms 이후)
    assert e.value.status_code == 403 and e.value.detail["reason"] == "window_after_cutoff"
    assert _raw_rows(maker, world) == 0


def test_cutoff_직전_정확히_맞닿는_창과_직후_1창을_구분한다(maker, world, store):
    stream = _start_stream(maker, world, uncertainty_ms=0)
    _cutoff(maker, world, "completed", T0 + timedelta(seconds=60))
    ok = _presign(maker, world, [_raw_meta(14_996, index=0)], stream)  # 끝(배타)이 정확히 cutoff
    assert ok["archive_ingest"]["verdict"] == "accept"
    with pytest.raises(HTTPException) as e:
        _presign(maker, world, [_raw_meta(15_000, index=1)], stream)  # 시작이 cutoff → 이후 창
    assert e.value.status_code == 403


def test_다중_청크_중_하나라도_거절이면_전체_미반영(maker, world, store):
    stream = _start_stream(maker, world, uncertainty_ms=0)
    _cutoff(maker, world, "completed", T0 + timedelta(seconds=60))
    with pytest.raises(HTTPException):
        _presign(maker, world, [_raw_meta(0, index=0), _raw_meta(15_020, index=1)], stream)
    assert _raw_rows(maker, world) == 0


def test_offline_10분_상한_밖의_미확정_구간은_격리(maker, world, store):
    stream = _start_stream(maker, world, uncertainty_ms=0)
    # lease(30s) 만료 + offline 상한(10분) 이후로 환산되는 창: sample 150_000 → 600s
    with pytest.raises(HTTPException) as e:
        _presign(maker, world, [_raw_meta(150_000)], stream, )
    assert e.value.status_code == 409 and e.value.detail["reason"] == "beyond_offline_bound"


def test_시계_불확실_stream은_cutoff_후_모두_격리(maker, world, store):
    stream = _start_stream(maker, world, certain=False)
    _cutoff(maker, world, "completed", T0 + timedelta(seconds=60))
    with pytest.raises(HTTPException) as e:
        _presign(maker, world, [_raw_meta(0)], stream)
    assert e.value.status_code == 409 and e.value.detail["reason"] == "clock_uncertain"


# ── 권한 코드 ──────────────────────────────────────────────────────────────

def test_동의철회는_종료_이전_창이라도_거절(maker, world, store):
    stream = _start_stream(maker, world)
    _cutoff(maker, world, "consent_withdrawn", T0 + timedelta(seconds=60))
    with pytest.raises(HTTPException) as e:
        _presign(maker, world, [_raw_meta(0)], stream)
    assert e.value.status_code == 403 and e.value.detail["reason"] == "consent_withdrawn"


def test_추방은_종료_이전_창을_보관_수락하되_live는_아니다(maker, world, store):
    stream = _start_stream(maker, world)
    _cutoff(maker, world, "expelled", T0 + timedelta(seconds=60))
    res = _presign(maker, world, [_raw_meta(0)], stream)
    assert res["archive_ingest"]["verdict"] == "accept" and res["archive_ingest"]["live_fresh_applied"] is False


def test_completed_close_deadline_24h_초과는_거절(maker, world, store, monkeypatch):
    stream = _start_stream(maker, world)
    _cutoff(maker, world, "completed", T0 + timedelta(seconds=60))
    monkeypatch.setattr(biosignal_service, "_now", lambda: T0 + timedelta(hours=24, seconds=61))
    with pytest.raises(HTTPException) as e:
        _presign(maker, world, [_raw_meta(0)], stream)
    assert e.value.status_code == 403 and e.value.detail["reason"] == "close_deadline_passed"
    # 경계 직전(24h-1s)은 수락
    monkeypatch.setattr(biosignal_service, "_now", lambda: T0 + timedelta(hours=24, seconds=58))
    assert _presign(maker, world, [_raw_meta(0)], stream)["archive_ingest"]["verdict"] == "accept"


def test_타인_stream이나_없는_stream은_거절(maker, world, store):
    other = None
    with pytest.raises(HTTPException) as e:
        _presign(maker, world, [_raw_meta(0)], uuid.uuid4())
    assert e.value.status_code == 404 and _code(e.value) == "capture_stream_not_found"
    from app.services.session_live_commands import apply_command, LiveCommand

    with maker() as s:
        r = apply_command(s, world.member(1), LiveCommand(command_id=uuid.uuid4(), session_id=world.session_id, kind="capture.start", payload={
            "device_profile": "linkband2-v1", "algorithm_version": "a", "model_version": "m"}), now=T0)
        other = r.result["stream_id"]
    with pytest.raises(HTTPException) as e:
        _presign(maker, world, [_raw_meta(0)], other)
    assert e.value.status_code == 403 and _code(e.value) == "capture_stream_not_owned"


# ── 산출물(artifact) 게이트 ────────────────────────────────────────────────

def test_artifact는_monotonic_range로_판정하고_범위_없으면_cutoff_후_격리(maker, world, store):
    stream = _start_stream(maker, world, uncertainty_ms=0)
    _cutoff(maker, world, "completed", T0 + timedelta(seconds=60))
    ok = _presign_art(maker, world, [_art_meta("FEAT-OK", (2_000_000, 3_000_000), 0)], stream)
    assert ok["archive_ingest"]["verdict"] == "accept"
    with pytest.raises(HTTPException) as e:
        _presign_art(maker, world, [_art_meta("FEAT-NORANGE", None, 1)], stream)
    assert e.value.status_code == 409 and e.value.detail["reason"] == "window_unproven"
    with pytest.raises(HTTPException) as e:
        _presign_art(maker, world, [_art_meta("FEAT-LATE", (63_000_000, 64_000_000), 2)], stream)
    assert e.value.status_code == 403


# ── PUT 성공 + ACK 유실 ────────────────────────────────────────────────────

def test_PUT_성공_후_ACK_유실은_재presign_재ACK로_수렴하고_행은_하나(maker, world, store):
    meta = _raw_meta(0)
    first = _presign(maker, world, [meta])["chunks"][0]  # PUT 은 성공했으나 ACK 응답이 유실됐다고 가정(ACK 미호출)
    again = _presign(maker, world, [meta])["chunks"][0]
    assert again["chunk_id"] == first["chunk_id"] and again["upload_status"] == "pending" and again["upload_url"]
    with maker() as s:
        ack = {"participant_id": str(world.members[0][1]), "chunks": [{"chunk_id": first["chunk_id"], "checksum": meta["checksum"], "size_bytes": meta["size_bytes"]}]}
        r1 = biosignal_service.ack_raw(str(world.session_id), AckRequest.model_validate(ack), s, current_user_id=str(world.members[0][0]))
        r2 = biosignal_service.ack_raw(str(world.session_id), AckRequest.model_validate(ack), s, current_user_id=str(world.members[0][0]))
    assert r1["chunks"][0]["upload_status"] == "uploaded" and r2["chunks"][0]["upload_status"] == "uploaded"
    assert r2["chunks"][0]["verified_at_us"] == r1["chunks"][0]["verified_at_us"]  # 두 번째 ACK 는 검증시각을 바꾸지 않는다
    assert _raw_rows(maker, world) == 1
    done = _presign(maker, world, [meta])["chunks"][0]
    assert done["upload_url"] is None and done["upload_status"] == "uploaded"  # 이후 presign 은 PUT 없이 완료 응답


def test_ACK는_저장소_미확인이면_uploaded가_되지_않는다(maker, world, store):
    meta = _raw_meta(0)
    item = _presign(maker, world, [meta])["chunks"][0]
    store["verify"] = (None, None)
    with maker() as s:
        r = biosignal_service.ack_raw(str(world.session_id), AckRequest.model_validate({"participant_id": str(world.members[0][1]), "chunks": [
            {"chunk_id": item["chunk_id"], "checksum": meta["checksum"], "size_bytes": meta["size_bytes"]}]}), s, current_user_id=str(world.members[0][0]))
    assert r["chunks"][0]["upload_status"] == "failed" and r["chunks"][0]["failure_reason"] == "verification_unavailable"


# ── live 불변 ──────────────────────────────────────────────────────────────

def test_늦은_backlog_presign_ACK는_capture_stream_과_live_outbox를_바꾸지_않는다(maker, world, store):
    stream = _start_stream(maker, world)
    with maker() as s:
        before = s.execute(sa.select(CaptureStream.entity_version, CaptureStream.lease_expires_at, CaptureStream.status).where(CaptureStream.id == stream)).one()
        outbox = s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == world.session_id))
    meta = _raw_meta(0)
    res = _presign(maker, world, [meta], stream)
    assert res["archive_ingest"]["live_fresh_applied"] is False
    with maker() as s:
        biosignal_service.ack_raw(str(world.session_id), AckRequest.model_validate({"participant_id": str(world.members[0][1]), "chunks": [
            {"chunk_id": res["chunks"][0]["chunk_id"], "checksum": meta["checksum"], "size_bytes": meta["size_bytes"]}]}), s, current_user_id=str(world.members[0][0]))
        after = s.execute(sa.select(CaptureStream.entity_version, CaptureStream.lease_expires_at, CaptureStream.status).where(CaptureStream.id == stream)).one()
        assert tuple(after) == tuple(before)
        assert s.scalar(sa.select(sa.func.count()).select_from(LiveOutbox).where(LiveOutbox.session_id == world.session_id)) == outbox


def test_capture_stream_id_미지정은_현행_동작_archive_ingest_없음(maker, world, store):
    res = _presign(maker, world, [_raw_meta(0)])
    assert res.get("archive_ingest") is None and len(res["chunks"]) == 1
