"""SDD-244 T04 — 세 신호 raw v2 presign/ACK (verify A01~A03, A11 일부, A13 격리).

실제 S3는 쓰지 않는다. 스토리지 검증은 monkeypatch(모의)이며 실제 객체 저장소 증거가 아니다.
"""
import base64
import copy
import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from app.services import storage_service
from tests.test_sdd027_rollup_raw_report import _create_group_class, _db, _join_guest, _register

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "specs/sdd-244-biosignal-raw-pipeline/contracts/fixtures"
HEADERS = json.loads((FIX / "raw-v2.json").read_text())
GOLDEN = json.loads((FIX / "raw-golden.json").read_text())
SIGNALS = ("eeg", "ppg", "acc")
STREAM = "11111111-1111-4111-8111-111111111111"
SEG = "22222222-2222-4222-8222-222222222222"


def _meta(signal: str, index: int = 0, *, stream: str = STREAM, segment: str = SEG, checksum: str | None = None):
    header = copy.deepcopy(next(h for h in HEADERS if h["signal_type"] == signal))
    header["stream_id"] = stream
    header["segment_id"] = segment
    header["chunk_index"] = index
    data = (FIX / f"{signal}-raw-v2.bin").read_bytes()
    return {
        "chunk_alias": f"RAW-{signal.upper()}-{stream[:4]}-{segment[:4]}-{index:06d}",
        "header": header,
        "checksum": checksum or hashlib.sha256(data).hexdigest(),
        "size_bytes": len(data),
    }


@pytest.fixture
def ctx(client):
    counselor = _register(client, f"s244a{id(client)}@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "원데이터게스트")
    return {"client": client, "sid": cls["id"], "pid": pid, "h": counselor["h"], "code": cls["access_code"]}


def _presign(c, chunks, **kw):
    body = {"participant_id": kw.get("pid", c["pid"]), "chunks": chunks}
    return c["client"].post(f"/api/v1/sessions/{c['sid']}/biosignal-raw/presign", json=body)


def _ack(c, items, **kw):
    body = {"participant_id": kw.get("pid", c["pid"]), "chunks": items}
    return c["client"].post(f"/api/v1/sessions/{c['sid']}/biosignal-raw/ack", json=body)


def _ack_items(presigned):
    return [{"chunk_id": p["chunk_id"], "checksum": p["checksum"], "size_bytes": p["size_bytes"]} for p in presigned]


@pytest.fixture
def verified(monkeypatch):
    """스토리지 검증 모의: 기본은 성공(True, version-1)."""
    state = {"result": (True, "ver-1")}
    monkeypatch.setattr(storage_service, "verify_object_sha256", lambda *a, **k: state["result"])
    return state


def test_a01_세_신호가_같은_stream_index에서_충돌하지_않는다(ctx):
    res = _presign(ctx, [_meta(s) for s in SIGNALS])
    assert res.status_code == 200, res.text
    chunks = res.json()["chunks"]
    assert [c["signal_type"] for c in chunks] == list(SIGNALS)
    assert len({c["chunk_id"] for c in chunks}) == 3
    for c in chunks:
        assert c["object_key"].startswith(f"biosignal-raw/{ctx['sid']}/{res.json()['participant_id']}/{STREAM}/{SEG}/{c['signal_type']}/00000000-")
        assert c["object_key"].endswith(f"-{c['checksum']}.bin")
        assert c["upload_status"] == "pending"
        assert c["upload_headers"]["x-amz-checksum-sha256"] == base64.b64encode(bytes.fromhex(c["checksum"])).decode()
        assert c["upload_headers"]["x-amz-server-side-encryption"] == "AES256"
        assert c["upload_url"]


def test_a03_동일_payload_재발급은_멱등(ctx):
    a = _presign(ctx, [_meta("eeg")]).json()["chunks"][0]
    b = _presign(ctx, [_meta("eeg")]).json()["chunks"][0]
    assert a["chunk_id"] == b["chunk_id"] and a["object_key"] == b["object_key"]
    from app.models.record import EEGRawChunk
    db = _db()
    try:
        assert db.query(EEGRawChunk).filter(EEGRawChunk.session_id == ctx["sid"]).count() == 1
    finally:
        db.close()


def test_a03_같은_identity_다른_payload는_409이고_기존_행_보존(ctx):
    first = _presign(ctx, [_meta("eeg")]).json()["chunks"][0]
    res = _presign(ctx, [_meta("ppg", 0), _meta("eeg", 0, checksum="f" * 64)])
    assert res.status_code == 409, res.text
    detail = res.json()["detail"]
    assert detail["code"] == "chunk_identity_conflict"
    assert detail["conflicts"][0]["existing_checksum"] == first["checksum"]
    assert detail["conflicts"][0]["attempted_checksum"] == "f" * 64
    from app.models.record import EEGRawChunk
    db = _db()
    try:
        rows = db.query(EEGRawChunk).filter(EEGRawChunk.session_id == ctx["sid"]).all()
        assert len(rows) == 1  # 충돌 요청 전체 미반영(ppg도 만들지 않음)
        assert rows[0].checksum == first["checksum"]
    finally:
        db.close()


def test_alias_충돌과_응답_매핑(ctx):
    a = _presign(ctx, [_meta("eeg")]).json()["chunks"][0]
    assert a["chunk_alias"] == "RAW-EEG-1111-2222-000000"
    other = _meta("eeg", 1)
    other["chunk_alias"] = a["chunk_alias"]  # 다른 identity가 같은 alias를 쓰면 거절
    res = _presign(ctx, [other])
    assert res.status_code == 409 and res.json()["detail"]["code"] == "alias_conflict"


def test_a03_다른_segment는_같은_index를_가진다(ctx):
    a = _presign(ctx, [_meta("eeg", 0)]).json()["chunks"][0]
    b = _presign(ctx, [_meta("eeg", 0, segment="33333333-3333-4333-8333-333333333333")]).json()["chunks"][0]
    assert a["chunk_id"] != b["chunk_id"]


def test_a02_ack는_검증_성공_항목만_uploaded(ctx, verified):
    p = _presign(ctx, [_meta(s) for s in SIGNALS]).json()["chunks"]
    res = _ack(ctx, _ack_items(p))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["acked"] == 3 and body["failed"] == 0
    for item in body["chunks"]:
        assert item["upload_status"] == "uploaded"
        assert item["verified_at_us"] and item["failure_reason"] is None
        assert item["object_version_id"] == "ver-1"
    # 재ACK 멱등
    again = _ack(ctx, _ack_items(p)).json()
    assert again["acked"] == 0 and [c["upload_status"] for c in again["chunks"]] == ["uploaded"] * 3
    # presign 재요청: 이미 uploaded → URL 없음
    re = _presign(ctx, [_meta("eeg")]).json()["chunks"][0]
    assert re["upload_status"] == "uploaded" and re["upload_url"] is None


@pytest.mark.parametrize("result,reason", [((False, None), "object_verification_failed"), ((None, None), "verification_unavailable")])
def test_a02_검증_실패나_불가는_uploaded가_아니다(ctx, verified, result, reason):
    verified["result"] = result
    p = _presign(ctx, [_meta("eeg")]).json()["chunks"]
    body = _ack(ctx, _ack_items(p)).json()
    item = body["chunks"][0]
    assert item["upload_status"] == "failed" and item["failure_reason"] == reason
    assert item["verified_at_us"] is None
    assert body["acked"] == 0 and body["failed"] == 1 and body["file_count"] == 0
    # 복구 후 재ACK는 성공할 수 있다
    verified["result"] = (True, "v")
    assert _ack(ctx, _ack_items(p)).json()["chunks"][0]["upload_status"] == "uploaded"


def test_a02_ack_checksum_size_불일치는_failed(ctx, verified):
    p = _presign(ctx, [_meta("eeg")]).json()["chunks"]
    items = _ack_items(p)
    items[0]["checksum"] = "e" * 64
    item = _ack(ctx, items).json()["chunks"][0]
    assert item["upload_status"] == "failed" and item["failure_reason"] == "ack_metadata_mismatch"
    assert item["checksum"] == p[0]["checksum"]  # 등록값 유지(덮어쓰기 불가)


def test_a02_다른_참여자_청크_ack는_404(client, ctx, verified):
    p = _presign(ctx, [_meta("eeg")]).json()["chunks"]
    other = _join_guest(client, ctx["code"], "다른게스트")
    res = _ack(ctx, _ack_items(p), pid=other)
    assert res.status_code == 404


def test_a11_자격_없으면_거절(ctx):
    res = ctx["client"].post(f"/api/v1/sessions/{ctx['sid']}/biosignal-raw/presign", json={"chunks": [_meta("eeg")]})
    assert res.status_code in (401, 403)


def test_스키마_검증_header_불일치_422_배치상한(ctx):
    bad = _meta("eeg")
    bad["header"]["sample_count"] = 5
    assert _presign(ctx, [bad]).status_code == 422
    assert _presign(ctx, [_meta("eeg", i) for i in range(101)]).status_code == 422
    tiny = _meta("eeg")
    tiny["size_bytes"] = 10
    assert _presign(ctx, [tiny]).status_code == 422


def test_a13_v1_eeg_raw는_v2_행을_건드리지_않는다(ctx, verified):
    p = _presign(ctx, [_meta("eeg"), _meta("ppg")]).json()["chunks"]
    c, sid = ctx["client"], ctx["sid"]
    # v1 presign이 같은 stream/index를 써도 v2 행을 재사용하지 않는다
    v1 = c.post(f"/api/v1/sessions/{sid}/eeg-raw/presign", json={"participant_id": ctx["pid"], "chunks": [{"stream_id": STREAM, "chunk_index": 0}]})
    assert v1.status_code == 200
    assert v1.json()["chunks"][0]["chunk_id"] not in {x["chunk_id"] for x in p}
    # v1 ack로 v2 청크 id를 확정/변조할 수 없다
    res = c.post(f"/api/v1/sessions/{sid}/eeg-raw/ack", json={"participant_id": ctx["pid"], "chunks": [{"chunk_id": p[0]["chunk_id"], "checksum": "x"}]})
    assert res.status_code == 404


def test_a13_file_count는_eeg_신호만_집계하고_ppg_단독은_record_없음(ctx, verified):
    ppg = _presign(ctx, [_meta("ppg")]).json()["chunks"]
    body = _ack(ctx, _ack_items(ppg)).json()
    assert body["eeg_record_id"] is None and body["file_count"] == 0
    eeg = _presign(ctx, [_meta("eeg"), _meta("acc")]).json()["chunks"]
    body = _ack(ctx, _ack_items(eeg)).json()
    assert body["eeg_record_id"] is not None and body["file_count"] == 1


def test_capabilities(ctx):
    res = ctx["client"].get(f"/api/v1/sessions/{ctx['sid']}/biosignal-capabilities", params={"participant_id": ctx["pid"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert "mb-biosignal-raw-v2" in body["raw_schemas"] and body["max_batch"] == 100
    assert {s["signal"] for s in body["signals"]} == set(SIGNALS)
    assert all(s["upload_allowed"] for s in body["signals"])
    assert body["upload_immutability"] == "checksum_bound" and body["legacy_eeg_raw"] is True


# ── 스토리지: 서명 헤더 바인딩 / 검증 로직(오프라인, 더미 자격증명) ─────────────────────


def _fake_creds(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "aws_access_key_id", "AKIAFAKEFAKEFAKE12")
    monkeypatch.setattr(settings, "aws_secret_access_key", "x" * 40)


def test_presigned_put은_sha256_헤더를_서명에_바인딩한다(monkeypatch):
    _fake_creds(monkeypatch)
    digest = hashlib.sha256(b"abc").hexdigest()
    url, headers = storage_service.generate_presigned_put_checksummed("k/1.bin", checksum_sha256_hex=digest)
    signed = parse_qs(urlparse(url).query)["X-Amz-SignedHeaders"][0].split(";")
    assert "x-amz-checksum-sha256" in signed and "x-amz-server-side-encryption" in signed and "content-type" in signed
    assert headers["x-amz-checksum-sha256"] == base64.b64encode(bytes.fromhex(digest)).decode()


class _FakeClient:
    def __init__(self, head, body=b""):
        self._head, self._body = head, body

    def head_object(self, **kw):
        if isinstance(self._head, Exception):
            raise self._head
        return self._head

    def get_object(self, **kw):
        import io
        return {"Body": io.BytesIO(self._body)}


def test_verify_object_sha256_분기(monkeypatch):
    _fake_creds(monkeypatch)
    data = b"hello-bytes"
    digest = hashlib.sha256(data).hexdigest()
    b64 = base64.b64encode(hashlib.sha256(data).digest()).decode()

    def use(client):
        monkeypatch.setattr(storage_service, "_s3_client", lambda: client)

    use(_FakeClient({"ContentLength": len(data), "ChecksumSHA256": b64, "VersionId": "v9"}))
    assert storage_service.verify_object_sha256("k", expected_size=len(data), expected_sha256_hex=digest) == (True, "v9")
    use(_FakeClient({"ContentLength": len(data), "ChecksumSHA256": base64.b64encode(b"\0" * 32).decode()}))
    assert storage_service.verify_object_sha256("k", expected_size=len(data), expected_sha256_hex=digest)[0] is False
    use(_FakeClient({"ContentLength": 3, "ChecksumSHA256": b64}))
    assert storage_service.verify_object_sha256("k", expected_size=len(data), expected_sha256_hex=digest)[0] is False
    # 저장소 체크섬이 없으면 서버가 스트리밍으로 읽어 SHA-256을 직접 계산한다(ETag는 쓰지 않는다)
    use(_FakeClient({"ContentLength": len(data), "ETag": '"abc"'}, body=data))
    assert storage_service.verify_object_sha256("k", expected_size=len(data), expected_sha256_hex=digest)[0] is True
    use(_FakeClient({"ContentLength": len(data), "ETag": '"abc"'}, body=b"x" * len(data)))
    assert storage_service.verify_object_sha256("k", expected_size=len(data), expected_sha256_hex=digest)[0] is False
    use(_FakeClient(RuntimeError("boom")))
    assert storage_service.verify_object_sha256("k", expected_size=1, expected_sha256_hex=digest)[0] is False


def test_자격증명_없으면_검증불가_None():
    assert storage_service.verify_object_sha256("k", expected_size=1, expected_sha256_hex="0" * 64) == (None, None)
