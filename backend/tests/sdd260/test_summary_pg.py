"""SDD-260 S2 — features/summary · biosignal-raw/summary · verify V-A8 · V-S15 (PG + Redis 실제)."""
from __future__ import annotations

import hashlib
import time
import uuid

import pytest
import sqlalchemy as sa

from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import EEGRawChunk
from tests.sdd260.test_features_batch_pg import _auth, _post, _url, api, started  # noqa: F401
from tests.sdd246.ingest.test_live_ingest_pg import _env as _env_base


def _env(world, started, seq, **kw):
    """sequence 0 도 유효하도록 창 시각을 음수가 되지 않게 보정(앱 첫 창 = 0)."""
    e = _env_base(world, started, seq, **kw)
    e["window_start_us"], e["window_end_us"] = str(seq * 1_000_000), str(seq * 1_000_000 + 1_000_000)
    return e



def _seed(api, world, started, n=600):
    for lo in range(1, n + 1, 300):
        r = _post(api, world, [_env(world, started, k) for k in range(lo, min(lo + 300, n + 1))])
        assert r.status_code == 200 and r.json()["counts"]["rejected"] == 0


def test_V_A8_feature_summary_결측_구간과_권한(api, maker, world, started):
    # sequence 는 1 부터 시작 → 0 번 창은 없다. 0..599 를 맞추려면 0 도 필요하므로 직접 0 포함해 시드
    sid = started.result["stream_id"]
    for lo in range(0, 600, 300):
        r = _post(api, world, [_env(world, started, k) for k in range(lo, lo + 300)])
        assert r.json()["counts"]["accepted"] == 300, r.text
    with maker() as s:
        s.execute(sa.delete(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id,
                                                    EEGFeatureWindow.window_index.between(100, 159)))
        s.execute(sa.delete(EEGFeatureWindow).where(EEGFeatureWindow.session_id == world.session_id,
                                                    EEGFeatureWindow.window_index.between(400, 419)))
        s.commit()
    uid, pid = world.members[0]
    t0 = time.perf_counter()
    r = api.get(_url(world, "features/summary"), params={"participant_id": str(pid)}, headers=_auth(uid))
    dt = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_count"] == 520 and len(body["streams"]) == 1
    st = body["streams"][0]
    assert st == {"stream_id": sid, "count": 520, "min_index": 0, "max_index": 599, "contiguous_through": 99,
                  "missing_ranges": [[100, 159], [400, 419]], "truncated": False}
    assert body["updated_at"] is not None and dt < 0.2, f"summary {dt:.3f}s"
    # participant_id 생략 = 본인
    assert api.get(_url(world, "features/summary"), headers=_auth(uid)).json()["total_count"] == 520
    # 타인 403
    assert api.get(_url(world, "features/summary"), params={"participant_id": str(pid)}, headers=_auth(world.members[1][0])).status_code == 403
    # 호스트 200 (participant_id 필수)
    h = {"Authorization": _auth(world.host_id)["Authorization"]}
    assert api.get(_url(world, "features/summary"), params={"participant_id": str(pid)}, headers=h).json()["total_count"] == 520
    assert api.get(_url(world, "features/summary"), headers=h).status_code == 422
    assert api.get(_url(world, "features/summary")).status_code == 401


def test_V_A8_stream_별_분리와_contiguous와_빈_참가자(api, maker, world, started):
    from tests.sdd246.ingest.test_live_ingest_pg import _start
    second = _start(maker, world)
    _post(api, world, [_env(world, started, k) for k in (1, 2, 3)])
    _post(api, world, [_env(world, second, k) for k in (0, 1, 5)])
    uid, pid = world.members[0]
    body = api.get(_url(world, "features/summary"), headers=_auth(uid)).json()
    by = {s["stream_id"]: s for s in body["streams"]}
    a, b = by[started.result["stream_id"]], by[second.result["stream_id"]]
    assert (a["count"], a["contiguous_through"], a["missing_ranges"]) == (3, -1, [])  # 0 이 없다
    assert (b["count"], b["contiguous_through"], b["missing_ranges"]) == (3, 1, [[2, 4]])
    empty = api.get(_url(world, "features/summary"), headers=_auth(world.members[1][0])).json()
    assert empty["total_count"] == 0 and empty["streams"] == [] and empty["updated_at"] is None


def test_V_A8_missing_ranges_상한_200_truncated(api, maker, world, started):
    ids = list(range(0, 1000, 2))[:300]  # 0,2,4,... → 구멍 299개
    _post(api, world, [_env(world, started, k) for k in ids])
    body = api.get(_url(world, "features/summary"), headers=_auth(world.members[0][0])).json()
    st = body["streams"][0]
    assert len(st["missing_ranges"]) == 200 and st["truncated"] is True


# ---------------- 원시 summary (V-S15) ----------------

def _raw(maker, world, i, idx, status="uploaded", stream="s1", seg="g1", sig="eeg", size=100):
    with maker() as s:
        s.add(EEGRawChunk(
            session_id=world.session_id, participant_id=world.members[i][1], stream_id=stream, segment_id=seg, signal_type=sig,
            chunk_index=idx, object_key=f"k/{idx}", upload_status=status, checksum=hashlib.sha256(f"{idx}".encode()).hexdigest(),
            size_bytes=size, schema_version="mb-biosignal-raw-v2", chunk_alias=f"{sig}-{stream}-{seg}-{idx}"))
        s.commit()


def test_V_S15_원시_summary_결측_receipt_hash_권한(api, maker, world):
    for idx in (0, 1, 2, 5, 6):
        _raw(maker, world, 0, idx)
    _raw(maker, world, 0, 3, status="pending")
    _raw(maker, world, 0, 4, status="failed")
    _raw(maker, world, 0, 0, stream="s2", sig="ppg")
    uid, pid = world.members[0]
    r = api.get(_url(world, "biosignal-raw/summary"), params={"participant_id": str(pid)}, headers=_auth(uid))
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["total"], b["uploaded"], b["pending"], b["failed"]) == (8, 6, 1, 1)
    by = {(s["stream_id"], s["segment_id"], s["signal_type"]): s for s in b["streams"]}
    e = by[("s1", "g1", "eeg")]
    assert (e["uploaded"], e["pending"], e["failed"], e["min_index"], e["max_index"]) == (5, 1, 1, 0, 6)
    assert e["missing_ranges"] == [[3, 4]] and by[("s2", "g1", "ppg")]["missing_ranges"] == []
    assert sorted(b["aliases_uploaded"]) == sorted(["eeg-s1-g1-0", "eeg-s1-g1-1", "eeg-s1-g1-2", "eeg-s1-g1-5", "eeg-s1-g1-6", "ppg-s2-g1-0"])
    # receipt_hash 독립 재계산 — uploaded 청크를 (stream,segment,signal,chunk_index,checksum,size) 정렬해 | 로 이은 SHA-256
    with maker() as s:
        rows = s.execute(sa.select(EEGRawChunk.stream_id, EEGRawChunk.segment_id, EEGRawChunk.signal_type, EEGRawChunk.chunk_index,
                                   EEGRawChunk.checksum, EEGRawChunk.size_bytes)
                         .where(EEGRawChunk.session_id == world.session_id, EEGRawChunk.participant_id == pid,
                                EEGRawChunk.upload_status == "uploaded")).all()
    text = "|".join(f"{a}|{b_}|{c}|{d}|{e_}|{f}" for a, b_, c, d, e_, f in sorted(rows))
    assert b["receipt_hash"] == hashlib.sha256(text.encode()).hexdigest()
    # 권한: 타인 403, 호스트 200, 슬롯(429) 비적용
    assert api.get(_url(world, "biosignal-raw/summary"), params={"participant_id": str(pid)}, headers=_auth(world.members[1][0])).status_code == 403
    h = _auth(world.host_id)
    assert api.get(_url(world, "biosignal-raw/summary"), params={"participant_id": str(pid)}, headers=h).json()["uploaded"] == 6
    from app.api import deps
    held = [deps._archive_slots.acquire(blocking=False) for _ in range(deps.settings.archive_max_concurrent)]
    try:
        assert api.get(_url(world, "biosignal-raw/summary"), headers=_auth(uid)).status_code == 200
    finally:
        for ok in held:
            if ok:
                deps._archive_slots.release()
