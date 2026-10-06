"""MB2 상(上) 기능 오류 4건 회귀 테스트 (5차).

[1] EEG-RAW-02 — eeg_raw_service.ack_upload 가 S3 업로드 확정 전 객체 존재·크기를 HEAD 로
    검증한다. 실패(객체 없음/크기 불일치)면 upload_status='failed' 로 마킹하고 file_count 에서
    제외한다. 자격증명 미설정(스텁) 환경은 검증을 건너뛰어 기존 흐름을 유지한다.
[2] EEG-RAW-01 — storage_service.generate_presigned_put 이 자격증명 설정 환경에서 서명 실패를
    스텁 URL 로 조용히 폴백하지 않고 StorageSigningError 로 전파한다(미설정은 스텁 허용).
[3] EEG-QRY-01 — eeg_feature_windows (session_id, participant_id, created_at) 복합 인덱스를
    alembic 마이그레이션으로 추가하고 기존 체인 헤드에 연결한다.
[4] INFRA-01 — deploy-dev.yml 이 export 전용 워커를 tar 번들·설치·재시작에 포함한다.
    (export-beat 는 전체 beat 중복 실행이므로 설치하지 않는다 — INFRA-08 후속.)
"""

import sys
import types
from pathlib import Path

import pytest

from tests.test_sdd027_rollup_raw_report import (
    _create_group_class,
    _db,
    _join_guest,
    _presign,
    _register,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_ROOT = Path(__file__).resolve().parents[1]


# ─────────────────────────────────────────────────────────────────────────────
# [1] EEG-RAW-02 — ack S3 HEAD 검증
# ─────────────────────────────────────────────────────────────────────────────


def _force_s3(monkeypatch, *, head=None, error=None):
    """자격증명을 설정하고 S3 클라이언트를 HEAD 응답/예외로 대체한다."""
    from app.services import storage_service

    class _FakeClient:
        def head_object(self, **_kw):
            if error is not None:
                raise error
            return head if head is not None else {"ContentLength": 0}

    monkeypatch.setattr(storage_service, "_s3_client", lambda: _FakeClient())
    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "test-key")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "test-secret")


def _ack(client, sid, participant_id, chunks):
    return client.post(
        f"/api/v1/sessions/{sid}/eeg-raw/ack",
        json={"participant_id": participant_id, "chunks": chunks},
    )


def _chunk_status(chunk_id):
    from app.models.record import EEGRawChunk

    db = _db()
    try:
        return db.query(EEGRawChunk).filter(EEGRawChunk.id == chunk_id).first()
    finally:
        db.close()


def test_eeg_raw_02_ack_객체없음_failed(client, monkeypatch):
    counselor = _register(client, "raw02-missing@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "실종게스트")
    presigned = _presign(client, cls["id"], pid, [0]).json()["chunks"]

    _force_s3(monkeypatch, error=RuntimeError("NoSuchKey"))
    res = _ack(client, cls["id"], pid,
               [{"chunk_id": presigned[0]["chunk_id"], "size_bytes": 1024}])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["acked"] == 0
    assert body["failed"] == 1
    assert body["file_count"] == 0
    assert body["eeg_record_id"] is None

    chunk = _chunk_status(presigned[0]["chunk_id"])
    assert chunk.upload_status == "failed"


def test_eeg_raw_02_ack_크기불일치_failed(client, monkeypatch):
    counselor = _register(client, "raw02-size@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "크기게스트")
    presigned = _presign(client, cls["id"], pid, [0]).json()["chunks"]

    # HEAD 는 999 바이트를 보고하나 ack 는 1024 바이트를 주장 → 불일치 → failed.
    _force_s3(monkeypatch, head={"ContentLength": 999})
    res = _ack(client, cls["id"], pid,
               [{"chunk_id": presigned[0]["chunk_id"], "size_bytes": 1024}])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["acked"] == 0
    assert body["failed"] == 1
    assert body["file_count"] == 0

    chunk = _chunk_status(presigned[0]["chunk_id"])
    assert chunk.upload_status == "failed"


def test_eeg_raw_02_ack_검증성공_uploaded(client, monkeypatch):
    counselor = _register(client, "raw02-ok@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "정상게스트")
    presigned = _presign(client, cls["id"], pid, [0, 1]).json()["chunks"]

    _force_s3(monkeypatch, head={"ContentLength": 1024})
    res = _ack(client, cls["id"], pid,
               [{"chunk_id": c["chunk_id"], "size_bytes": 1024} for c in presigned])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["acked"] == 2
    assert body["failed"] == 0
    assert body["file_count"] == 2
    assert body["eeg_record_id"] is not None

    for c in presigned:
        assert _chunk_status(c["chunk_id"]).upload_status == "uploaded"


def test_eeg_raw_02_ack_크기미제공은_존재만검증(client, monkeypatch):
    """size_bytes 미제공 시 HEAD 는 존재만 확인하고 uploaded 로 확정한다."""
    counselor = _register(client, "raw02-nosize@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "무크기게스트")
    presigned = _presign(client, cls["id"], pid, [0]).json()["chunks"]

    _force_s3(monkeypatch, head={"ContentLength": 777})
    res = _ack(client, cls["id"], pid, [{"chunk_id": presigned[0]["chunk_id"]}])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["acked"] == 1
    assert body["failed"] == 0
    assert body["file_count"] == 1


def test_eeg_raw_02_자격증명미설정_검증건너뜀(client, monkeypatch):
    """스텁(자격증명 미설정) 환경은 HEAD 검증 없이 기존대로 uploaded 로 확정한다."""
    from app.services import storage_service

    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "")

    counselor = _register(client, "raw02-stub@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "스텁게스트")
    presigned = _presign(client, cls["id"], pid, [0]).json()["chunks"]

    res = _ack(client, cls["id"], pid, [{"chunk_id": presigned[0]["chunk_id"]}])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["acked"] == 1
    assert body["failed"] == 0
    assert body["file_count"] == 1


def test_verify_object_자격증명미설정_None(monkeypatch):
    from app.services import storage_service

    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "")
    assert storage_service.verify_object("eeg-raw/x/y/0.bin") is None


# ─────────────────────────────────────────────────────────────────────────────
# [2] EEG-RAW-01 — presigned 서명 실패 시 스텁 폴백 금지
# ─────────────────────────────────────────────────────────────────────────────


def test_eeg_raw_01_자격증명미설정_스텁허용(monkeypatch):
    from app.services import storage_service

    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "")
    url = storage_service.generate_presigned_put("eeg-raw/x/y/0.bin")
    assert url.startswith("https://")
    assert url.endswith("?stub=1")


def test_eeg_raw_01_서명실패_예외전파(monkeypatch):
    from app.services import storage_service

    fake = types.ModuleType("boto3")

    def _boom(*_a, **_k):
        raise RuntimeError("signing failed")

    fake.client = _boom
    monkeypatch.setitem(sys.modules, "boto3", fake)
    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "test-key")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "test-secret")

    with pytest.raises(storage_service.StorageSigningError):
        storage_service.generate_presigned_put("eeg-raw/x/y/0.bin")


def test_eeg_raw_01_서명성공_실제URL(monkeypatch):
    from app.services import storage_service

    fake = types.ModuleType("boto3")

    class _Client:
        def generate_presigned_url(self, _op, Params, ExpiresIn):  # noqa: N803
            return f"https://s3.example/{Params['Key']}?sig=real&x={ExpiresIn}"

    fake.client = lambda *a, **k: _Client()
    monkeypatch.setitem(sys.modules, "boto3", fake)
    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "test-key")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "test-secret")

    url = storage_service.generate_presigned_put("eeg-raw/x/y/0.bin")
    assert url.startswith("https://s3.example/")
    assert "stub=1" not in url


def test_eeg_raw_01_presign_엔드포인트_서명실패시_스텁미반환(client, monkeypatch):
    """자격증명 설정 + 서명 실패 → 엔드포인트가 스텁 URL 을 반환하지 않고 실패한다."""
    from app.services import storage_service

    fake = types.ModuleType("boto3")

    def _boom(*_a, **_k):
        raise RuntimeError("signing failed")

    fake.client = _boom
    monkeypatch.setitem(sys.modules, "boto3", fake)
    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "test-key")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "test-secret")

    counselor = _register(client, "raw01-ep@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "서명실패게스트")

    with pytest.raises(storage_service.StorageSigningError):
        _presign(client, cls["id"], pid, [0])


# ─────────────────────────────────────────────────────────────────────────────
# [3] EEG-QRY-01 — (session_id, participant_id, created_at) 복합 인덱스
# ─────────────────────────────────────────────────────────────────────────────


def test_eeg_qry_01_모델_복합인덱스_존재():
    from app.models.eeg_feature import EEGFeatureWindow

    indexes = {ix.name: ix for ix in EEGFeatureWindow.__table__.indexes}
    name = "ix_eeg_feature_window_participant_created"
    assert name in indexes
    assert [c.name for c in indexes[name].columns] == [
        "session_id", "participant_id", "created_at",
    ]


def test_eeg_qry_01_마이그레이션_헤드_단일_연결():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(_BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    script = ScriptDirectory.from_config(cfg)

    assert script.get_heads() == ["e036a0000032"]
    rev = script.get_revision("e036a0000032")
    assert rev is not None
    assert rev.down_revision == "e036a0000031"


def test_eeg_qry_01_마이그레이션_인덱스_정의():
    versions = _BACKEND_ROOT / "alembic" / "versions"
    text = None
    for f in versions.glob("*.py"):
        t = f.read_text(encoding="utf-8")
        if "ix_eeg_feature_window_participant_created" in t and "create_index" in t:
            text = t
            break
    assert text is not None
    assert "eeg_feature_windows" in text
    assert '"session_id", "participant_id", "created_at"' in text


# ─────────────────────────────────────────────────────────────────────────────
# [4] INFRA-01 — export 워커 dev 배포 설치
# ─────────────────────────────────────────────────────────────────────────────


def _deploy_text() -> str:
    return (_REPO_ROOT / ".github" / "workflows" / "deploy-dev.yml").read_text(encoding="utf-8")


def test_infra_01_번들에_export_worker_포함():
    text = _deploy_text()
    assert "backend/deploy/mindbreeze-export-worker.service" in text


def test_infra_01_export_worker_설치_및_재시작():
    text = _deploy_text()
    assert 'sudo cp "$BASE/backend/deploy/mindbreeze-export-worker.service" /etc/systemd/system/mindbreeze-export-worker.service' in text
    assert "systemctl enable mindbreeze-export-worker" in text
    assert "systemctl restart mindbreeze-export-worker" in text


def test_infra_01_export_beat_는_설치하지_않음():
    """export-beat 는 전체 beat 스케줄을 중복 실행하므로 dev 에서 설치하지 않는다(INFRA-08 후속)."""
    text = _deploy_text()
    assert "mindbreeze-export-beat.service" not in text
