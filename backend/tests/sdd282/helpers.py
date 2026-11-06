"""SDD-282 시험 공용 — 파일(feature 산출물) 합성·적재 보조."""
from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import uuid
from pathlib import Path

from app.models.biosignal import BiosignalArtifact
from app.models.live_state import CaptureStream
from tests.sdd246.ingest.test_live_ingest_pg import MET, _env, _start

SCRIPTS = Path(__file__).parents[3] / "scripts"
BASE_MS = 1_760_000_000_000
_STRIP = ("session_id", "participant_id", "stream_id", "stream_generation", "clock_anchor_id", "clock_uncertainty_ms",
          "device_profile_version", "algorithm_version", "model_version")


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def start_stream(maker, world, i=0):
    r = _start(maker, world, i)
    assert r.status == "applied", (r.status, getattr(r, "result", None), getattr(r, "code", None))
    return r


def window(world, started, seq, i=0, *, h=None, invalid=False):
    """store_batch 에 그대로 넣을 수 있는 MetricWindow 원본(+ 값이 seq 마다 달라지게)."""
    metrics = {"focus_raw": MET(1.0 + seq / 100), "relaxation_raw": MET(0.3 + seq / 1000),
               "alpha_power": {**MET(2.5 + seq), "unit": "power_raw"}}
    if invalid:
        metrics = {k: {**v, "value": None, "validity": "invalid"} for k, v in metrics.items()}
    w = _env(world, started, seq, i=i, h=h or hashlib.sha256(f"{i}-{seq}".encode()).hexdigest(), metrics=metrics)
    w["observed_at_ms"] = BASE_MS + seq * 1000
    w["sqi"] = 0.9 if not invalid else 0.2
    return w


def file_row(win: dict) -> dict:
    """운영 업로드 파일의 행 형태 — stream/버전 필드는 없다."""
    return {k: v for k, v in win.items() if k not in _STRIP}


class FakeStore:
    """S3 대역: object_key → bytes."""

    def __init__(self):
        self.objs: dict[str, bytes] = {}

    def __call__(self, key):
        return self.objs.get(key)


def put_artifact(maker, store: FakeStore, world, i, rows: list[dict], *, seq_no: int, status="uploaded",
                 corrupt_checksum=False, stream_id=None):
    blob = gzip.compress(("\n".join(json.dumps(r) for r in rows)).encode())
    key = f"test/{world.session_id}/{i}/feature-{seq_no}.jsonl.gz"
    store.objs[key] = blob
    seqs = [int(r["sequence"]) for r in rows]
    with maker() as s:
        s.add(BiosignalArtifact(
            session_id=world.session_id, participant_id=world.members[i][1], artifact_alias=f"a{uuid.uuid4().hex[:12]}",
            artifact_kind="feature", signal="eeg", stream_id=stream_id, sequence=seq_no, first_sequence=min(seqs),
            last_sequence=max(seqs), row_count=len(rows), content_encoding="gzip", schema_version="feature-v1",
            checksum=("0" * 64) if corrupt_checksum else hashlib.sha256(blob).hexdigest(), size_bytes=len(blob),
            retention_class="feature", object_key=key, upload_status=status))
        s.commit()


def stream_of(maker, started) -> CaptureStream:
    with maker() as s:
        return s.get(CaptureStream, uuid.UUID(started.result["stream_id"]))
