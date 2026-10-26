"""SDD-244 T05 — feature 전체 컬럼 연결, artifact(feature/raw_derived/indices/normalization/algorithm) 원장·ACK.

스토리지 읽기/검증은 모의다(실제 객체 저장소 증거 아님).
"""
import gzip
import hashlib
import json
from pathlib import Path

import pytest

from app.services import storage_service
from tests.test_sdd027_rollup_raw_report import _create_group_class, _db, _join_guest, _register

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "specs/sdd-244-biosignal-raw-pipeline/contracts/fixtures"
INDICES = json.loads((FIX / "indices-v1.json").read_text())
STREAM = "11111111-1111-4111-8111-111111111111"
VIEW = "44444444-4444-4444-8444-444444444444"


@pytest.fixture
def ctx(client):
    counselor = _register(client, f"s244t05{id(client)}@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "산출물게스트")
    return {"client": client, "sid": cls["id"], "pid": pid}


def _post(c, path, body):
    return c["client"].post(f"/api/v1/sessions/{c['sid']}/{path}", json={"participant_id": c["pid"], **body})


def _jsonl(rows, gz=False):
    raw = ("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n").encode()
    return gzip.compress(raw) if gz else raw


def _art(kind, alias, data, **over):
    meta = {
        "artifact_alias": alias, "artifact_kind": kind, "stream_id": STREAM, "segment_id": None, "signal": None,
        "view_instance_id": None, "sequence": 0, "row_count": 1, "schema_version": f"{kind}-v1",
        "checksum": hashlib.sha256(data).hexdigest(), "size_bytes": len(data),
    }
    meta.update(over)
    return meta


@pytest.fixture
def store(monkeypatch):
    """verify_object_sha256 / download_bytes 모의 — objects[key]에 넣은 바이트를 읽어 준다."""
    state = {"verify": (True, "v1"), "objects": {}}
    monkeypatch.setattr(storage_service, "verify_object_sha256", lambda *a, **k: state["verify"])
    monkeypatch.setattr(storage_service, "download_bytes", lambda key: state["objects"].get(key))
    return state


# ── 기존 feature 스칼라 연결 ────────────────────────────────────────────────


def test_feature_batch가_faa_total_neural_activity_play_group_provenance를_저장한다(ctx):
    item = {
        "second_offset": 3, "timestamp": 1234.5, "focus_index": 0.5, "faa": -0.25, "total_neural_activity": 7.5,
        "play_group_id": "PG-1", "source_feature_alias": "Featureeeg1", "algorithm_version": "eeg-algo-1",
    }
    res = ctx["client"].post(f"/api/v1/sessions/{ctx['sid']}/features", json={"participant_id": ctx["pid"], "features": [item]})
    assert res.status_code == 200 and res.json()["saved"] == 1
    from app.models.eeg_feature import EEGFeatureWindow
    db = _db()
    try:
        row = db.query(EEGFeatureWindow).filter_by(session_id=ctx["sid"]).one()
        assert (row.faa, row.total_neural_activity, row.play_group_id) == (-0.25, 7.5, "PG-1")
        assert (row.source_feature_alias, row.algorithm_version) == ("Featureeeg1", "eeg-algo-1")
    finally:
        db.close()


def test_기존_feature_멱등과_null_보존은_유지(ctx):
    item = {"second_offset": 0, "focus_index": 0.1}
    body = {"participant_id": ctx["pid"], "features": [item]}
    url = f"/api/v1/sessions/{ctx['sid']}/features"
    assert ctx["client"].post(url, json=body).json()["saved"] == 1
    assert ctx["client"].post(url, json=body).json()["saved"] == 0
    from app.models.eeg_feature import EEGFeatureWindow
    db = _db()
    try:
        row = db.query(EEGFeatureWindow).filter_by(session_id=ctx["sid"]).one()
        assert row.faa is None and row.total_neural_activity is None and row.source_feature_alias is None
    finally:
        db.close()


# ── artifact presign ───────────────────────────────────────────────────────


def test_artifact_presign_alias_매핑_멱등_충돌(ctx):
    data = _jsonl([{"a": 1}], gz=True)
    meta = _art("feature", "FEAT-EEG-0", data, signal="eeg", segment_id=STREAM, content_encoding="gzip",
                feature_id_aliases=["Featureeeg1", "Featureeeg2"], uncompressed_sha256="a" * 64)
    first = _post(ctx, "biosignal-artifacts/presign", {"chunks": [meta]})
    assert first.status_code == 200, first.text
    item = first.json()["chunks"][0]
    assert item["artifact_alias"] == "FEAT-EEG-0" and item["artifact_kind"] == "feature"
    assert item["object_key"].startswith(f"biosignal-artifacts/{ctx['sid']}/") and item["object_key"].endswith(f"-{meta['checksum']}.bin")
    assert item["upload_headers"]["x-amz-checksum-sha256"] and item["upload_status"] == "pending"
    again = _post(ctx, "biosignal-artifacts/presign", {"chunks": [meta]}).json()["chunks"][0]
    assert again["artifact_id"] == item["artifact_id"]
    # 같은 sequence 슬롯에 다른 내용 → 409
    other = _art("feature", "FEAT-EEG-0B", b"zz", signal="eeg", segment_id=STREAM)
    res = _post(ctx, "biosignal-artifacts/presign", {"chunks": [other]})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "artifact_conflict"
    # 같은 alias, 다른 슬롯 → alias_conflict
    clash = _art("feature", "FEAT-EEG-0", data, signal="eeg", segment_id=STREAM, sequence=1)
    res = _post(ctx, "biosignal-artifacts/presign", {"chunks": [clash]})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "alias_conflict"


def test_예약_alias와_raw_artifact_alias_충돌은_거절(ctx):
    data = b"x"
    for alias in ("GAPS", "RAWMISSING-eeg-0", "GAPMISSING-1"):
        assert _post(ctx, "biosignal-artifacts/presign", {"chunks": [_art("normalization", alias, data)]}).status_code == 422
    from tests.test_sdd244_ingest import _meta, _presign
    raw = _presign(ctx, [_meta("eeg")]).json()["chunks"][0]
    res = _post(ctx, "biosignal-artifacts/presign", {"chunks": [_art("normalization", raw["chunk_alias"], data)]})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "alias_conflict"
    art = _post(ctx, "biosignal-artifacts/presign", {"chunks": [_art("normalization", "NORM-ZZ", data)]})
    assert art.status_code == 200
    meta = _meta("ppg")
    meta["chunk_alias"] = "NORM-ZZ"
    assert _presign(ctx, [meta]).status_code == 409


def test_artifact_종류별_필수_scope_검증(ctx):
    data = b"x"
    bad = _art("indices", "IDX-0", data)  # indices 는 view_instance_id 필수
    assert _post(ctx, "biosignal-artifacts/presign", {"chunks": [bad]}).status_code == 422
    bad2 = _art("feature", "FEAT-0", data)  # feature 는 signal/segment 필수
    assert _post(ctx, "biosignal-artifacts/presign", {"chunks": [bad2]}).status_code == 422


# ── artifact ack ───────────────────────────────────────────────────────────


def _presign_ack(ctx, store, meta, data):
    item = _post(ctx, "biosignal-artifacts/presign", {"chunks": [meta]}).json()["chunks"][0]
    store["objects"][item["object_key"]] = data
    return item, _post(ctx, "biosignal-artifacts/ack", {"chunks": [
        {"artifact_id": item["artifact_id"], "checksum": item["checksum"], "size_bytes": item["size_bytes"]}]})


def test_artifact_ack_검증_성공과_실패(ctx, store):
    data = _jsonl([{"a": 1}])
    meta = _art("raw_derived", "WAVE-EEG-0", data, signal="eeg", segment_id=STREAM)
    item, res = _presign_ack(ctx, store, meta, data)
    body = res.json()
    assert res.status_code == 200 and body["acked"] == 1
    assert body["chunks"][0]["upload_status"] == "uploaded" and body["chunks"][0]["verified_at_us"]
    assert body["chunks"][0]["artifact_alias"] == "WAVE-EEG-0"
    # 검증 실패는 failed
    data2 = _jsonl([{"b": 2}])
    store["verify"] = (False, None)
    _, res2 = _presign_ack(ctx, store, _art("raw_derived", "WAVE-EEG-1", data2, signal="eeg", segment_id=STREAM, sequence=1), data2)
    assert res2.json()["chunks"][0]["upload_status"] == "failed" and res2.json()["failed"] == 1


def test_indices_ack가_display_snapshots를_색인하고_재ACK는_중복_없음(ctx, store):
    rows = [dict(INDICES[0], second_index=i) for i in range(3)]
    data = _jsonl(rows, gz=True)
    meta = _art("indices", "IDX-0", data, view_instance_id=VIEW, content_encoding="gzip", row_count=3,
                first_sequence=0, last_sequence=2, uncompressed_sha256=hashlib.sha256(gzip.decompress(data)).hexdigest())
    item, res = _presign_ack(ctx, store, meta, data)
    assert res.json()["chunks"][0]["indexed_rows"] == 3
    again = _post(ctx, "biosignal-artifacts/ack", {"chunks": [
        {"artifact_id": item["artifact_id"], "checksum": item["checksum"], "size_bytes": item["size_bytes"]}]})
    assert again.json()["acked"] == 0 and again.json()["chunks"][0]["upload_status"] == "uploaded"
    from app.models.biosignal import DisplaySnapshot
    db = _db()
    try:
        snaps = db.query(DisplaySnapshot).filter_by(session_id=ctx["sid"]).order_by(DisplaySnapshot.second_index).all()
        assert [s.second_index for s in snaps] == [0, 1, 2]
        s0 = snaps[0]
        assert (s0.render_status, s0.source, s0.display_match) == ("rendered", "displayed", "true")
        assert s0.view_instance_id == VIEW and s0.view_instance_alias == "View01"
        assert (s0.focus_value, s0.hrv_value) == (INDICES[0]["focus"]["value"], INDICES[0]["hrv"]["value"])
        assert s0.normalization_hash == INDICES[0]["normalization"]["params_hash"]
        want = sorted({INDICES[0][k]["source_feature_id"] for k in ("focus", "relaxation", "emotional", "bpm", "respiration", "hrv")
                       if INDICES[0][k]["source_feature_id"]})
        assert s0.source_feature_aliases == want
    finally:
        db.close()


def test_indices_ack_객체_내용이_계약_위반이면_색인하지_않고_failed(ctx, store):
    bad = dict(INDICES[0], render_status="not_rendered")  # 미렌더 초에 값 존재 → 계약 위반
    data = _jsonl([bad])
    meta = _art("indices", "IDX-BAD", data, view_instance_id=VIEW)
    _, res = _presign_ack(ctx, store, meta, data)
    item = res.json()["chunks"][0]
    assert item["upload_status"] == "failed" and item["failure_reason"] == "content_schema_invalid" and item["indexed_rows"] == 0
    from app.models.biosignal import DisplaySnapshot
    db = _db()
    try:
        assert db.query(DisplaySnapshot).count() == 0
    finally:
        db.close()


def test_normalization_ack가_content_addressed로_등록된다(ctx, store):
    snap = INDICES[0]["normalization"]
    data = _jsonl([snap])
    meta = _art("normalization", "NORM-0", data)
    _, res = _presign_ack(ctx, store, meta, data)
    assert res.json()["chunks"][0]["upload_status"] == "uploaded" and res.json()["chunks"][0]["indexed_rows"] == 1
    # 같은 모델을 다시 올려도 중복 등록되지 않는다
    data2 = _jsonl([snap, snap])
    _, res2 = _presign_ack(ctx, store, _art("normalization", "NORM-1", data2, sequence=1, row_count=2), data2)
    from app.models.biosignal import NormalizationSnapshotRow
    db = _db()
    try:
        assert db.query(NormalizationSnapshotRow).count() == 1
    finally:
        db.close()


def test_feature_alias_색인이_저장된다(ctx, store):
    data = _jsonl([{"x": 1}])
    meta = _art("feature", "FEAT-PPG-0", data, signal="ppg", segment_id=STREAM, feature_id_aliases=["Featureppg1"])
    item, _ = _presign_ack(ctx, store, meta, data)
    from app.services import biosignal_artifact_service as svc
    db = _db()
    try:
        art = svc.resolve_feature_alias(db, ctx["sid"], ctx["pid"], "Featureppg1")
        assert art is not None and str(art.id) == item["artifact_id"]
        assert svc.resolve_feature_alias(db, ctx["sid"], ctx["pid"], "Nope") is None
    finally:
        db.close()
