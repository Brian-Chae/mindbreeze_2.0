"""SDD-244 T06 — gap 이벤트·close intent·manifest revision (verify A08 일부, A04 gap).

스토리지 검증은 모의다. close intent 의 실제 원장 대조(expected set·순번·hash)는 서버가 수행한다.
"""
import hashlib
import json

import pytest

from app.schemas.biosignal import ManifestRevision
from app.services import storage_service
from tests.test_sdd027_rollup_raw_report import _create_group_class, _db, _join_guest, _register
from tests.test_sdd244_ingest import FIX, GOLDEN, SEG, STREAM, _ack, _ack_items, _meta, _presign

GAP0 = "55555555-5555-4555-8555-555555555550"
GAP1 = "55555555-5555-4555-8555-555555555551"
INTENT = "66666666-6666-4666-8666-666666666660"


@pytest.fixture
def ctx(client):
    counselor = _register(client, f"s244t06{id(client)}@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "종료게스트")
    return {"client": client, "sid": cls["id"], "pid": pid, "code": cls["access_code"]}


@pytest.fixture(autouse=True)
def storage(monkeypatch):
    state = {"verify": (True, "v1")}
    monkeypatch.setattr(storage_service, "verify_object_sha256", lambda *a, **k: state["verify"])
    monkeypatch.setattr(storage_service, "download_bytes", lambda key: None)
    return state


def _events(c, events):
    return c["client"].post(f"/api/v1/sessions/{c['sid']}/biosignal-events", json={"participant_id": c["pid"], "events": events})


def _manifest(c, revision=None, pid=None):
    params = {"participant_id": pid or c["pid"]}
    if revision:
        params["revision"] = revision
    return c["client"].get(f"/api/v1/sessions/{c['sid']}/biosignal-manifest", params=params)


def _gap(seq, event_id=GAP0, **over):
    body = {
        "event_type": "gap", "event_id": event_id, "sequence": seq, "discovered_at_us": "5000000", "signal": "eeg",
        "stream_id": STREAM, "segment_id": SEG, "start_us": "1000000", "end_us": "4000000", "reason": "ble_disconnect",
        "observed_or_estimated": "observed", "expected_samples": 750, "received_samples": 0, "reconnect_count": 1,
    }
    body.update(over)
    return body


def _upload(c, signals=("eeg",), index=0):
    metas = [_meta(s, index) for s in signals]
    presigned = _presign(c, metas).json()["chunks"]
    _ack(c, _ack_items(presigned))
    return metas, presigned


def _intent(raws, *, last_chunk=0, received=4, last_gap=None, lost=None, intent_id=INTENT, extra=None):
    body = {
        "event_type": "close_intent", "intent_id": intent_id, "closed_at_us": "9000000",
        "expected_artifacts": [{"kind": "raw", "alias": m["chunk_alias"], "sha256": m["checksum"]} for m in raws] + (extra or []),
        "streams": [{"stream_id": STREAM, "segment_id": SEG, "signal": "eeg", "last_chunk_sequence": last_chunk,
                     "last_feature_sequence": None, "received_samples": received}],
        "snapshots": [], "last_gap_sequence": last_gap, "end_reason": "user_ended",
    }
    if lost:
        body["lost_artifacts"] = lost
    return body


def test_gap는_멱등이고_같은_id_다른_내용은_conflict(ctx):
    r1 = _events(ctx, [_gap(0)]).json()["events"][0]
    assert r1["status"] == "recorded"
    assert _events(ctx, [_gap(0)]).json()["events"][0]["status"] == "duplicate"
    assert _events(ctx, [_gap(0, end_us="4000001")]).json()["events"][0]["status"] == "conflict"
    from app.models.biosignal import BiosignalGapEvent
    db = _db()
    try:
        assert db.query(BiosignalGapEvent).count() == 1
    finally:
        db.close()


def test_gap_불명_손실량을_0으로_받지_않는다(ctx):
    res = _events(ctx, [_gap(0, observed_or_estimated="unknown", expected_samples=0)])
    assert res.status_code == 422


def test_모두_검증되면_complete_revision1(ctx):
    metas, _ = _upload(ctx, ("eeg",))
    res = _events(ctx, [_gap(0), _intent(metas, last_gap=0)])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["close_state"] == "complete" and body["manifest_revision"] == 1 and body["missing_artifacts"] == []
    manifest = _manifest(ctx).json()
    assert manifest["latest_revision"] == 1
    m = ManifestRevision.model_validate(manifest["manifest"])  # G1 계약 검증(complete 규칙 포함)
    assert m.close_state == "complete" and m.policy_recheck_required is True
    eeg = next(s for s in m.signals if s.signal == "eeg")
    assert eeg.acked_samples == 4 and eeg.availability == "available"
    assert next(s for s in m.signals if s.signal == "ppg").availability == "not_collected"
    assert [g.reason for g in m.gaps] == ["ble_disconnect"] and m.gaps[0].expected_samples == 750
    # 공개 manifest 에 내부 UUID/object key 가 없다
    text = json.dumps(manifest["manifest"])
    assert STREAM not in text and ctx["pid"] not in text and ctx["sid"] not in text and "biosignal-raw/" not in text


def test_미확정_항목이_있으면_pending_upload이고_후발_ACK는_새_revision(ctx):
    metas = [_meta("eeg", 0)]
    presigned = _presign(ctx, metas).json()["chunks"]  # ACK 전
    res = _events(ctx, [_intent(metas)]).json()
    assert res["close_state"] == "pending_upload" and res["manifest_revision"] == 1
    assert [a["alias"] for a in res["missing_artifacts"]] == [metas[0]["chunk_alias"]]
    first = _manifest(ctx, 1).json()["manifest"]
    assert _ack(ctx, _ack_items(presigned)).status_code == 200  # 후발 ACK
    latest = _manifest(ctx).json()
    assert latest["latest_revision"] == 2 and latest["manifest"]["close_state"] == "complete"
    assert _manifest(ctx, 1).json()["manifest"] == first  # 기존 revision 불변
    assert first["close_state"] == "pending_upload"


def test_close_intent_재전송은_멱등이고_새_revision을_만들지_않는다(ctx):
    metas, _ = _upload(ctx)
    _events(ctx, [_intent(metas)])
    again = _events(ctx, [_intent(metas)]).json()
    assert again["events"][0]["status"] == "duplicate" and again["manifest_revision"] == 1
    changed = _events(ctx, [_intent(metas, received=5)]).json()
    assert changed["events"][0]["status"] == "conflict"


def test_raw만_ACK되고_다른_expected가_없으면_complete가_아니다(ctx):
    metas, _ = _upload(ctx)
    extra = [{"kind": "feature", "alias": "FEAT-X", "sha256": "c" * 64}]
    res = _events(ctx, [_intent(metas, extra=extra)]).json()
    assert res["close_state"] == "pending_upload"
    assert [(a["kind"], a["alias"]) for a in res["missing_artifacts"]] == [("feature", "FEAT-X")]


def test_수신_순번_구멍과_gap_순번_누락은_complete가_아니다(ctx):
    metas, _ = _upload(ctx, index=0)
    _upload(ctx, index=2)
    res = _events(ctx, [_gap(0), _intent(metas, last_chunk=2, last_gap=1)]).json()
    assert res["close_state"] == "pending_upload"
    aliases = {a["alias"] for a in res["missing_artifacts"]}
    assert "RAWMISSING-eeg-1" in aliases and "GAPMISSING-1" in aliases


def test_lost_artifact_선언은_partial(ctx):
    metas = [_meta("eeg", 0)]
    _presign(ctx, metas)  # 업로드 못 함
    lost = [{"kind": "raw", "alias": metas[0]["chunk_alias"], "reason": "local_write_failed"}]
    res = _events(ctx, [_intent(metas, lost=lost)]).json()
    assert res["close_state"] == "partial"
    m = ManifestRevision.model_validate(_manifest(ctx).json()["manifest"])
    assert next(s for s in m.signals if s.signal == "eeg").availability in ("lost", "available")


def test_close_intent_없으면_unknown(ctx):
    _upload(ctx)
    manifest = _manifest(ctx).json()
    assert manifest["latest_revision"] == 1 and manifest["manifest"]["close_state"] == "unknown"
    assert manifest["manifest"]["close_intent"] is None


def test_manifest_다른_참여자_자격으로는_거절(client, ctx):
    _upload(ctx)
    other = _join_guest(client, ctx["code"], "남의게스트")
    stolen = {"X-Entry-Credential": client.credential(other)}
    res = client.get(f"/api/v1/sessions/{ctx['sid']}/biosignal-manifest", params={"participant_id": ctx["pid"]}, headers=stolen)
    assert res.status_code in (401, 403)  # 타인의 manifest 조회 불가
    body = {"participant_id": ctx["pid"], "events": [_gap(0)]}
    assert client.post(f"/api/v1/sessions/{ctx['sid']}/biosignal-events", json=body, headers=stolen).status_code in (401, 403)
    assert _manifest(ctx).status_code == 200  # 본인 자격으로는 조회된다


# ── 서버 남은 결함(B 리뷰 인계): lost 선언과 feature/indices 순번·참조·공개 목록 ──────────────

def _stream_seq(body, feature=None):
    body["streams"][0]["last_feature_sequence"] = feature
    return body


def test_lost_선언한_feature_순번_구멍은_pending에_남지_않는다(ctx):
    metas, _ = _upload(ctx)
    first = _events(ctx, [_stream_seq(_intent(metas), feature=1)]).json()
    assert first["close_state"] == "pending_upload"
    holes = [a for a in first["missing_artifacts"] if a["kind"] == "feature"]
    assert [h["alias"] for h in holes] == ["FEATMISSING-eeg-0-1"]
    # 서버가 알려 준 구멍 항목을 그대로 loss 로 선언 → partial
    retry = _stream_seq(_intent(metas, intent_id="99999999-9999-4999-8999-999999999999"), feature=1)
    retry["closed_at_us"] = "9500000"
    retry["lost_artifacts"] = [{"kind": "feature", "alias": "FEATMISSING-eeg-0-1", "reason": "local_write_failed"}]
    res = _events(ctx, [retry]).json()
    assert res["close_state"] == "partial" and not res["missing_artifacts"]


def test_lost_선언한_indices_순번_구멍도_partial(ctx):
    metas, _ = _upload(ctx)
    body = _intent(metas)
    body["snapshots"] = [{"stream_id": STREAM, "view_instance_id": "44444444-4444-4444-8444-444444444444", "last_snapshot_sequence": 0}]
    assert _events(ctx, [body]).json()["close_state"] == "pending_upload"
    retry = _intent(metas, intent_id="99999999-9999-4999-8999-999999999999")
    retry["closed_at_us"] = "9500000"
    retry["snapshots"] = body["snapshots"]
    retry["lost_artifacts"] = [{"kind": "indices", "alias": "IDXMISSING-0-0", "reason": "not_rendered"}]
    res = _events(ctx, [retry]).json()
    assert res["close_state"] == "partial" and not res["missing_artifacts"]


def test_presign_이전_loss도_공개_manifest에_lost로_실린다(ctx):
    metas, _ = _upload(ctx)
    body = _stream_seq(_intent(metas), feature=0)
    body["lost_artifacts"] = [{"kind": "feature", "alias": "FEATMISSING-eeg-0-0", "reason": "local_write_failed"},
                              {"kind": "normalization", "alias": "NORM-NEVER", "reason": "local_write_failed"}]
    assert _events(ctx, [body]).json()["close_state"] == "partial"
    m = ManifestRevision.model_validate(_manifest(ctx).json()["manifest"])
    lost = {a.artifact_id_alias: a for a in m.artifacts if a.availability == "lost"}
    assert set(lost) == {"FEATMISSING-eeg-0-0", "NORM-NEVER"}
    assert all(a.unavailable_reason == "local_write_failed" and a.ack_state == "unavailable" and a.sha256 is None for a in lost.values())
    # 실제 업로드된 raw 는 그대로 available
    assert any(a.artifact_kind == "raw" and a.availability == "available" for a in m.artifacts)


def test_행이_있는_lost_feature는_순번을_채운_것으로_본다(ctx):
    from tests.test_sdd244_artifacts import _art, _post
    metas, _ = _upload(ctx)
    feat = _art("feature", "FEAT-EEG-0", b"zz", signal="eeg", segment_id=SEG, sequence=0)
    assert _post(ctx, "biosignal-artifacts/presign", {"chunks": [feat]}).status_code == 200  # ACK 못 한 채 유실
    body = _stream_seq(_intent(metas, extra=[{"kind": "feature", "alias": "FEAT-EEG-0", "sha256": feat["checksum"]}]), feature=0)
    assert _events(ctx, [body]).json()["close_state"] == "pending_upload"
    retry = _stream_seq(_intent(metas, intent_id="99999999-9999-4999-8999-999999999999",
                                extra=[{"kind": "feature", "alias": "FEAT-EEG-0", "sha256": feat["checksum"]}]), feature=0)
    retry["closed_at_us"] = "9500000"
    retry["lost_artifacts"] = [{"kind": "feature", "alias": "FEAT-EEG-0", "reason": "local_write_failed"}]
    res = _events(ctx, [retry]).json()
    assert res["close_state"] == "partial" and not res["missing_artifacts"], res


# ── 네이티브(raw·feature)와 JS(indices·normalization)가 각자 보낸 close intent 는 합집합으로 판정한다 ──────

def test_서로_다른_주체의_close_intent는_합집합으로_평가한다(ctx):
    metas, _ = _upload(ctx, ("eeg", "ppg"))
    eeg_only = _intent([metas[0]])
    ppg_only = _intent([metas[1]], intent_id="99999999-9999-4999-8999-999999999999")
    ppg_only["closed_at_us"] = "9500000"
    ppg_only["streams"][0]["signal"] = "ppg"
    first = _events(ctx, [eeg_only]).json()
    assert first["close_state"] == "pending_upload"  # 아직 ppg 는 목록 밖 → 미확정
    res = _events(ctx, [ppg_only]).json()
    assert res["close_state"] == "complete" and not res["missing_artifacts"], res
    m = ManifestRevision.model_validate(_manifest(ctx).json()["manifest"])
    assert {s.signal for s in m.close_intent.streams} == {"eeg", "ppg"}
    assert len(m.close_intent.expected_artifacts) == 2


def test_ACC_실측_rate가_있으면_청크_종료_시각이_실측으로_계산된다(ctx):
    import copy
    from app.models.record import EEGRawChunk
    meta = _meta("acc", 0)
    base = copy.deepcopy(meta)
    h = meta["header"]
    h["observed_rate"] = {"numerator": 26, "denominator": 1}
    h["observed_rate_window_us"] = 10_000_000
    h["observed_rate_reason"] = None
    assert _presign(ctx, [meta]).status_code == 200
    assert _presign(ctx, [_meta("acc", 1)]).status_code == 200
    db = _db()
    try:
        rows = {r.chunk_index: r for r in db.query(EEGRawChunk).filter(EEGRawChunk.signal_type == "acc").all()}
        n = base["header"]["sample_count"]
        span_obs = rows[0].end_ms - rows[0].start_ms
        span_nom = rows[1].end_ms - rows[1].start_ms
        assert span_obs > span_nom  # 26Hz 가 30Hz 보다 같은 샘플 수에 더 긴 시간
        assert abs(span_obs - (n - 1) / 26 * 1000) < 1e-6
    finally:
        db.close()
