"""클래스 종료 후(회원 completed)에도 기기에 남은 raw 사본을 업로드·ACK 할 수 있어야 하고, live-metrics 가 sdnn 을 돌려준다."""
import pytest

from app.models.class_program import ClassMember
from tests.sdd237_helpers import auth_for, build_class_world
from tests.test_sdd027_rollup_raw_report import _db
from tests.test_sdd244_ingest import _meta
from app.services import storage_service
from app.models.user import User


@pytest.fixture
def ended_world(client):
    with _db() as db:
        world = build_class_world(db, members=1)
        member_user = db.get(User, world["participants"][0].user_id)
        for m in db.query(ClassMember).all():
            m.status = "completed"
        db.commit()
        return {"sid": str(world["session"].id), "pid": str(world["participants"][0].id),
                "h": auth_for(member_user), "host_h": world["auth"]}


def test_종료된_클래스_회원도_v2_raw_presign_ack_가능(client, ended_world, monkeypatch):
    monkeypatch.setattr(storage_service, "verify_object_sha256", lambda *a, **k: (True, "v1"))
    w = ended_world
    res = client.post(f"/api/v1/sessions/{w['sid']}/biosignal-raw/presign", headers=w["h"],
                      json={"participant_id": w["pid"], "chunks": [_meta("eeg")]})
    assert res.status_code == 200, res.text
    chunk = res.json()["chunks"][0]
    ack = client.post(f"/api/v1/sessions/{w['sid']}/biosignal-raw/ack", headers=w["h"],
                      json={"participant_id": w["pid"], "chunks": [{"chunk_id": chunk["chunk_id"], "checksum": chunk["checksum"], "size_bytes": chunk["size_bytes"]}]})
    assert ack.status_code == 200, ack.text
    assert ack.json()["chunks"][0]["upload_status"] == "uploaded"


def test_live_metrics_응답에_sdnn_필드(client, ended_world):
    w = ended_world
    res = client.get(f"/api/v1/sessions/{w['sid']}/live-metrics", headers=w["host_h"])
    assert res.status_code == 200, res.text
    assert all("sdnn" in m for m in res.json()["metrics"])
