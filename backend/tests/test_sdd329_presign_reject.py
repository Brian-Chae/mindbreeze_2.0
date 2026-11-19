"""SDD-329 C: raw presign 403 — 권한 유지(403·비 429), 사유 구조화 로그(개인정보 없음), 반복 거절 단축."""
import fakeredis
import pytest

from app.models.user import User
from app.services import raw_presign_guard as guard
from tests.sdd237_helpers import auth_for, build_class_world, make_user
from tests.test_sdd027_rollup_raw_report import _db
from tests.test_sdd244_ingest import _meta


@pytest.fixture
def fake_redis(monkeypatch):
    r = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(guard, "_redis", lambda: r)
    return r


@pytest.fixture
def world(client):
    with _db() as db:
        w = build_class_world(db, members=1)
        host_id = str(w["host"].id)
        outsider = make_user(db, role="client", name="타인")
        db.commit()
        member = db.get(User, w["participants"][0].user_id)
        return {"sid": str(w["session"].id), "pid": str(w["participants"][0].id), "host_h": w["auth"],
                "out_h": auth_for(outsider), "mem_h": auth_for(member), "host_id": host_id,
                "out_id": str(outsider.id)}


def _eeg(client, w, h, pid=None):
    return client.post(f"/api/v1/sessions/{w['sid']}/eeg-raw/presign", headers=h,
                       json={"participant_id": pid or w["pid"], "chunks": [{"stream_id": "s1", "chunk_index": 0, "start_ms": 0, "end_ms": 1000, "size_bytes": 10, "sample_count": 250}]})


def test_비참가자는_계속_403이고_429가_아니다(client, world, fake_redis):
    for _ in range(6):
        res = _eeg(client, world, world["out_h"])
        assert res.status_code in (401, 403), res.text
        assert res.status_code != 429


def test_거절_사유는_구조화_로그에_남고_원문_식별자는_없다(client, world, fake_redis, caplog):
    with caplog.at_level("WARNING"):
        _eeg(client, world, world["out_h"])
    lines = [r.getMessage() for r in caplog.records if "[presign-reject]" in r.getMessage()]
    assert lines, "거절 로그 없음"
    line = lines[0]
    assert "reason=" in line and "kind=eeg" in line and world["sid"] in line
    assert world["out_id"] not in line and world["out_id"][:8] not in line or guard._hash8(world["out_id"]) in line
    assert "subject=" + guard._hash8(world["out_id"]) in line


def test_반복_거절은_DB_조회_없이_단축된다(client, world, fake_redis, monkeypatch):
    from app.services import eeg_raw_service, session_service

    for _ in range(guard.SHORT_CIRCUIT_AFTER):
        assert _eeg(client, world, world["out_h"]).status_code in (401, 403)
    calls = {"n": 0}
    real = session_service.resolve_upload_participant

    def spy(*a, **k):
        calls["n"] += 1
        return real(*a, **k)

    monkeypatch.setattr(session_service, "resolve_upload_participant", spy)
    res = _eeg(client, world, world["out_h"])
    assert res.status_code in (401, 403)
    assert calls["n"] == 0, "반복 거절인데 권한 판정(DB 조회)을 다시 탔다"


def test_초기_거절_몇번은_단축하지_않고_원경로가_판정(client, world, fake_redis, monkeypatch):
    from app.services import session_service

    calls = {"n": 0}
    real = session_service.resolve_upload_participant
    monkeypatch.setattr(session_service, "resolve_upload_participant", lambda *a, **k: (calls.__setitem__("n", calls["n"] + 1), real(*a, **k))[1])
    _eeg(client, world, world["out_h"])
    _eeg(client, world, world["out_h"])
    assert calls["n"] == 2


def test_정상_참가자는_영향_없음(client, world, fake_redis):
    for _ in range(5):
        _eeg(client, world, world["out_h"])  # 타인이 반복 거절돼도
    res = client.post(f"/api/v1/sessions/{world['sid']}/biosignal-raw/presign", headers=world["mem_h"],
                      json={"participant_id": world["pid"], "chunks": [_meta("eeg")]})
    assert res.status_code == 200, res.text


def test_Redis_장애면_기존_동작(client, world, monkeypatch):
    def boom():
        raise ConnectionError("down")

    monkeypatch.setattr(guard, "_redis", boom)
    res = _eeg(client, world, world["out_h"])
    assert res.status_code in (401, 403)


def test_사유_분류():
    assert guard.reason_code("대기열 참가자는 EEG 데이터를 업로드할 수 없습니다") == "waitlisted"
    assert guard.reason_code("본인 참여자만 요청할 수 있습니다") == "not_owner"
    assert guard.reason_code("세션 참가자만 요청할 수 있습니다") == "not_participant"
    assert guard.reason_code({"code": "archive_rejected"}) == "archive_rejected"
    assert guard.reason_code("기타") == "forbidden_other"
