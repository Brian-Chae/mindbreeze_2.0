"""SDD-062 게스트 성별·생년월일 저장 계약."""

from tests.entry_helpers import guest_body
from datetime import date
from uuid import UUID

from app.models.session import SessionParticipant
from tests.test_sdd015_class_code import _create_class, _db, _open_class, _register


def test_guest_gender_birth_saved_and_serialized(client):
    host = _register(client, "sdd062-host@test.com")
    session = _create_class(client, host["h"])
    _open_class(client, session, host["h"])
    response = client.post(
        "/api/v1/sessions/enter",
        json=guest_body(session["access_code"], "게스트", gender="female", birth_date="1990-02-03"),
    )
    assert response.status_code == 200, response.text
    # SDD-209: 입장 응답의 참여자 목록에는 성별·생년월일을 싣지 않는다(PII). 저장 값은 DB 로 확인한다.
    guest = response.json()["session"]["participants"][0]
    assert guest["gender"] is None
    assert guest["birth_date"] is None

    db = _db()
    try:
        saved = db.get(SessionParticipant, UUID(response.json()["participant_id"]))
        assert saved.gender == "female"
        assert saved.birth_date == date(1990, 2, 3)
    finally:
        db.close()


def test_guest_gender_birth_omitted_is_rejected(client):
    # SDD-209(B5a): 비회원 입장은 성별·생년월일이 필수다(누락 → 422, 참여자 미생성).
    host = _register(client, "sdd062-null@test.com")
    session = _create_class(client, host["h"])
    _open_class(client, session, host["h"])
    for missing in ("gender", "birth_date"):
        body = guest_body(session["access_code"], "게스트")
        body.pop(missing)
        assert client.post("/api/v1/sessions/enter", json=body).status_code == 422
    db = _db()
    try:
        assert db.query(SessionParticipant).count() == 0
    finally:
        db.close()


def test_guest_invalid_gender_or_birth_date_rejected(client):
    host = _register(client, "sdd062-invalid@test.com")
    session = _create_class(client, host["h"])
    _open_class(client, session, host["h"])
    url = "/api/v1/sessions/enter"
    for payload in (
        guest_body(session["access_code"], "게스트", gender="unknown"),
        guest_body(session["access_code"], "게스트", birth_date="1990-02-31"),
    ):
        response = client.post(url, json=payload)
        assert response.status_code == 422, response.text
