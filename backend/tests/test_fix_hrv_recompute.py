"""RMSSD 과대 산출 수정 — 저장값 재산출 도구 검증 (specs/fix-rmssd-overestimate/verify.md V6').

로컬 SQLite 인메모리 + 합성 PPG raw v2 청크 + 실제 Rust 코어 엔진(example)로
dry-run 무변경 · apply 덮어쓰기 · rollback 정확 복원 · 멱등 · 원시 없음 미변경 · 운영 가드를 확인한다.
엔진 바이너리가 없으면 건너뛴다: cd packages/measurement-core && cargo build --release --example recompute_ppg_hrv
"""
import hashlib
import json
import math
import struct
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services import hrv_recompute_service as svc

ENGINE_BIN = svc.default_engine_bin()
pytestmark = pytest.mark.skipif(not ENGINE_BIN.exists(), reason="재산출 엔진 바이너리 없음(cargo build --release --example recompute_ppg_hrv)")

BASE_UTC_US = 1_800_000_000_000_000
SEG_ID = "00000000-0000-4000-8000-0000000000aa"
STREAM_ID = "00000000-0000-4000-8000-0000000000bb"


def _signal(seconds: int, seed: int = 5) -> list[tuple[int, int]]:
    """무작위 RR(평균 64bpm) + 딕로틱 노치 파형 합성 PPG (red, ir) 24bit ADC."""
    import random
    rnd = random.Random(seed)
    beats, t = [], 0.3
    while t < seconds + 2:
        beats.append(t)
        t += (937.0 + rnd.gauss(0, 20)) / 1000.0
    out = []
    for i in range(seconds * 50):
        ts, v = i / 50, 0.0
        for b in beats:
            if b > ts:
                break
            d = ts - b
            if d < 0.9:
                v += math.exp(-((d - 0.12) / 0.06) ** 2) + 0.35 * math.exp(-((d - 0.38) / 0.09) ** 2)
        out.append((int(80000 + 2000 * v + rnd.gauss(0, 30)), int(100000 + 3000 * v + rnd.gauss(0, 30))))
    return out


def _chunk(samples: list[tuple[int, int]], first_index: int, chunk_index: int) -> tuple[bytes, dict]:
    n = len(samples)
    rows = b"".join(struct.pack("<II", r, i) for r, i in samples)
    pkts, pmap, off = b"", [], 0
    per = 10
    for k in range(0, n, per):
        part = samples[k:k + per]
        tick = int((first_index + k + len(part)) * 655.36) % (2 ** 32)
        wire = struct.pack(">I", tick) + b"".join(r.to_bytes(3, "big") + i.to_bytes(3, "big") for r, i in part)
        pkts += wire
        pmap.append({"packet_seq": k // per, "byte_offset": off, "byte_length": len(wire), "first_sample_index": first_index + k,
                     "sample_count": len(part), "tick_raw": str(tick), "tick_unwrapped": str(tick),
                     "received_utc_us": str(BASE_UTC_US + (first_index + k) * 20000), "received_monotonic_us": str(2_000_000 + (first_index + k) * 20000),
                     "header_anchor": "last_sample", "clock_segment_id": SEG_ID, "malformed_reason": None})
        off += len(wire)
    pm = b"".join(json.dumps(p, separators=(",", ":")).encode() + b"\n" for p in pmap)
    header = {
        "schema_version": "mb-biosignal-raw-v2", "signal_type": "ppg", "stream_id": STREAM_ID, "segment_id": SEG_ID,
        "chunk_index": chunk_index,
        "parser_profile": {"firmware": "unknown", "device_model": "LINK-BAND-2.0-synthetic", "profile_id": "mb-web-clock-v1", "version": "1",
                           "parameters_hash": "a" * 64, "platform": "synthetic", "verification": "synthetic_only",
                           "packet_endian": "mixed", "tick_hz": 32768, "tick_bits": 32, "header_anchor": "last_sample"},
        "rate": {"numerator": 50, "denominator": 1}, "observed_rate": None, "observed_rate_window_us": None,
        "observed_rate_reason": "synthetic_not_device_measurement", "channels": ["red", "ir"], "units": ["ADC_count", "ADC_count"],
        "scale": [1.0, 1.0], "sample_count": n, "packet_count": len(pmap), "first_sample_index": first_index,
        "end_sample_index_exclusive": first_index + n, "time_basis": "host_estimated",
        "anchor": {"sample_index": first_index, "utc_us": str(BASE_UTC_US + first_index * 20000), "monotonic_us": str(2_000_000 + first_index * 20000),
                   "relative_us": str(first_index * 20000), "device_tick_raw": "65536", "device_tick_unwrapped": "65536",
                   "clock_segment_id": SEG_ID, "uncertainty_us": None, "rule": "anchor_plus_index_delta_over_rate"},
        "sections": [{"name": "samples", "offset": 0, "length": len(rows), "row_stride": 8, "encoding": "ppg-u32-u32-le"},
                     {"name": "packets", "offset": len(rows), "length": len(pkts), "row_stride": 0, "encoding": "bytes"},
                     {"name": "packet_map", "offset": len(rows) + len(pkts), "length": len(pm), "row_stride": 0, "encoding": "utf8-jsonl"}],
    }
    enc = json.dumps(header, separators=(",", ":")).encode()
    return b"MBRAW002" + struct.pack("<I", len(enc)) + enc + rows + pkts + pm, header


@pytest.fixture
def env():
    from app.core.database import Base
    import app.models  # noqa: F401
    from app.models.eeg_feature import EEGFeatureWindow
    from app.models.record import EEGRawChunk
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng)
    db = sessionmaker(bind=eng)()
    sid, pid_raw, pid_noraw = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store: dict[str, bytes] = {}
    sig = _signal(120)
    for ci, start in enumerate(range(0, len(sig), 1500)):
        payload, header = _chunk(sig[start:start + 1500], start, ci)
        key = f"biosignal-raw/{sid}/{pid_raw}/{STREAM_ID}/{SEG_ID}/ppg/{ci:08d}.bin"
        store[key] = payload
        db.add(EEGRawChunk(session_id=sid, participant_id=pid_raw, stream_id=STREAM_ID, chunk_index=ci, signal_type="ppg", segment_id=SEG_ID,
                           sample_rate=50, channel_count=2, unit="ADC_count", schema_version="mb-biosignal-raw-v2",
                           checksum=hashlib.sha256(payload).hexdigest(), size_bytes=len(payload), object_key=key,
                           upload_status="uploaded", header=header, first_sample_index=start, sample_count=len(sig[start:start + 1500])))
    # 서비스가 저장했을 법한 '과대' 값 — 1초 간격 윈도우, 60~119초(30초 이후부터 값이 있다)
    for w in range(40, 118):
        ts_ms = (BASE_UTC_US + w * 1_000_000 + 19_980_000 * 0) / 1000.0 + 20  # 틱(50샘플 배수) 직후 시각과 일치하도록 아래서 맞춘다
        for pid in (pid_raw, pid_noraw):
            db.add(EEGFeatureWindow(session_id=sid, participant_id=pid, play_group_id="pg1", window_index=w, quality="valid",
                                    device_timestamp_ms=BASE_UTC_US / 1000.0 + (w * 50 - 1) * 20.0,
                                    rmssd=117.0, sdnn=79.0, lf_power=1.0, hf_power=2.0, lf_hf_ratio=0.5, heart_rate=64.0, focus_index=0.5))
    db.commit()
    yield db, sid, pid_raw, pid_noraw, store
    db.close()


def _vals(db, pid):
    from app.models.eeg_feature import EEGFeatureWindow
    return {w.window_index: (w.rmssd, w.sdnn, w.lf_power, w.hf_power, w.lf_hf_ratio, w.heart_rate, w.focus_index)
            for w in db.execute(select(EEGFeatureWindow).where(EEGFeatureWindow.participant_id == pid)).scalars()}


def _run(db, sid, store, apply, backup=None):
    return svc.run(db, session_ids=[sid], reader=store.get, engine=svc.run_rust_engine, apply=apply, backup_path=backup)


def test_dry_run_changes_nothing_and_reports(env):
    db, sid, p_raw, p_no, store = env
    before = _vals(db, p_raw), _vals(db, p_no)
    st = _run(db, sid, store, apply=False)
    assert (_vals(db, p_raw), _vals(db, p_no)) == before
    rep = st.report()
    print('DRY-RUN-REPORT', json.dumps(rep, ensure_ascii=False))
    assert rep["participants"] == 2 and rep["participants_no_raw"] == 1
    assert rep["windows_changed"] > 20
    assert rep["medians"]["rmssd"]["before"] == 117.0
    assert 10 < rep["medians"]["rmssd"]["after"] < 60   # 합성 신호(RR σ≈20ms → RMSSD ≈ 28ms)


def test_apply_overwrites_in_place_and_leaves_no_raw_and_other_columns(env, tmp_path):
    db, sid, p_raw, p_no, store = env
    no_before, raw_before = _vals(db, p_no), _vals(db, p_raw)
    st = _run(db, sid, store, apply=True, backup=tmp_path / "b.jsonl")
    assert st.windows_changed > 20
    assert _vals(db, p_no) == no_before                       # 원시 없는 참가자는 그대로
    raw_after = _vals(db, p_raw)
    changed = [w for w in raw_after if raw_after[w] != raw_before[w]]
    assert len(changed) == st.windows_changed
    for w in changed:
        assert raw_after[w][0] < 80 and raw_after[w][0] != 117.0   # rmssd 갱신
        assert raw_after[w][5] == 64.0 and raw_after[w][6] == 0.5  # heart_rate·focus_index 등 다른 컬럼 불변
    assert (tmp_path / "b.jsonl").read_text().count("\n") == st.windows_changed


def test_idempotent_second_apply_changes_zero_rows(env, tmp_path):
    db, sid, p_raw, p_no, store = env
    _run(db, sid, store, apply=True, backup=tmp_path / "b1.jsonl")
    snap = _vals(db, p_raw)
    st2 = _run(db, sid, store, apply=True, backup=tmp_path / "b2.jsonl")
    assert st2.windows_changed == 0 and _vals(db, p_raw) == snap


def test_rollback_restores_exact_original(env, tmp_path):
    db, sid, p_raw, p_no, store = env
    orig = _vals(db, p_raw)
    _run(db, sid, store, apply=True, backup=tmp_path / "b.jsonl")
    assert _vals(db, p_raw) != orig
    res = svc.rollback(db, tmp_path / "b.jsonl")
    assert res["rows_restored"] > 20 and res["rows_missing"] == 0
    assert _vals(db, p_raw) == orig


def test_no_new_columns_or_tables_for_versions():
    from app.core.database import Base
    import app.models  # noqa: F401
    cols = {c.name for c in Base.metadata.tables["eeg_feature_windows"].columns}
    assert not any(("_v2" in c or "recomputed" in c or "legacy" in c) for c in cols)
    assert not [t for t in Base.metadata.tables if "hrv" in t and "version" in t]


def test_cli_blocks_apply_in_production_without_confirm(monkeypatch, tmp_path):
    root = Path(__file__).resolve().parents[1]
    code = ("import sys; sys.path.insert(0,'.'); import scripts.recompute_ppg_hrv as m; "
            "from app.config import settings; settings.environment='production'; "
            "sys.exit(m.main(['--apply','--backup-dir','%s']))" % tmp_path)
    r = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True)
    assert r.returncode == 2 and "confirm-production" in r.stderr
