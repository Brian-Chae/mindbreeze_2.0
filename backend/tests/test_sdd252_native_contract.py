"""SDD-252 — 앱 네이티브가 만든 원시/feature 산출물 메타가 서버 계약(presign 200 → ack)을 통과하는지 검증한다.

fixture 는 Android `RawChunkerTest.exportServerContractFixtures` 가 실제 코드로 내보낸 값이다
(SDD252_FIXTURE_DIR 지정 후 `./gradlew testDevDebugUnitTest --tests '*RawChunkerTest*'`). 스토리지 검증은 모의다.
"""
import copy
import json
from pathlib import Path

import pytest

from app.services import storage_service
from tests.test_sdd027_rollup_raw_report import _create_group_class, _join_guest, _register

FIX = Path(__file__).resolve().parents[2] / "specs/sdd-252-native-raw-upload/fixtures"
RAW = json.loads((FIX / "native-raw-meta.json").read_text())
FEATURE = json.loads((FIX / "native-feature-meta.json").read_text())


@pytest.fixture
def ctx(client):
    counselor = _register(client, f"s252{id(client)}@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "네이티브게스트")
    return {"client": client, "sid": cls["id"], "pid": pid}


@pytest.fixture
def verified(monkeypatch):
    monkeypatch.setattr(storage_service, "verify_object_sha256", lambda *a, **k: (True, "ver-1"))
    monkeypatch.setattr(storage_service, "download_bytes", lambda key: (FIX / "native-feature.bin").read_bytes())


def _post(c, path, body):
    return c["client"].post(f"/api/v1/sessions/{c['sid']}/{path}", json={"participant_id": c["pid"], **body})


@pytest.mark.parametrize("signal", ["eeg", "ppg", "acc"])
def test_네이티브_raw_청크가_presign과_ack를_통과한다(ctx, verified, signal):
    meta = RAW[signal]
    res = _post(ctx, "biosignal-raw/presign", {"chunks": [meta]})
    assert res.status_code == 200, res.text
    item = res.json()["chunks"][0]
    assert item["signal_type"] == signal and item["upload_status"] == "pending" and item["upload_url"]
    ack = _post(ctx, "biosignal-raw/ack", {"chunks": [{"chunk_id": item["chunk_id"], "checksum": item["checksum"], "size_bytes": item["size_bytes"]}]})
    assert ack.status_code == 200, ack.text
    out = ack.json()["chunks"][0]
    assert out["upload_status"] == "uploaded" and out["verified_at_us"]


def test_네이티브_raw_재전송은_같은_청크로_멱등이다(ctx, verified):
    first = _post(ctx, "biosignal-raw/presign", {"chunks": [RAW["eeg"]]}).json()["chunks"][0]
    second = _post(ctx, "biosignal-raw/presign", {"chunks": [RAW["eeg"]]})
    assert second.status_code == 200 and second.json()["chunks"][0]["chunk_id"] == first["chunk_id"]


def test_네이티브_feature_메타가_presign을_통과한다(ctx, verified):
    res = _post(ctx, "biosignal-artifacts/presign", {"chunks": [FEATURE]})
    assert res.status_code == 200, res.text
    assert res.json()["chunks"][0]["artifact_kind"] == "feature"


def test_구_앱의_scope_없는_feature_메타는_422로_거절된다(ctx):
    """이 거절이 SDD-252 의 원인이다. 서버 규칙은 그대로 두고 앱 메타를 고쳤음을 회귀로 고정한다."""
    legacy = copy.deepcopy(FEATURE)
    legacy["signal"] = None
    legacy["segment_id"] = None
    res = _post(ctx, "biosignal-artifacts/presign", {"chunks": [legacy]})
    assert res.status_code == 422
    assert "signal" in json.dumps(res.json(), ensure_ascii=False) and "segment_id" in json.dumps(res.json(), ensure_ascii=False)
