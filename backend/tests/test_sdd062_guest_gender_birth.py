"""SDD-062 게스트 성별·생년월일 저장 계약."""

from datetime import date
from uuid import UUID

from app.models.session import SessionParticipant
from tests.test_sdd015_class_code import _create_class, _db, _register


def test_guest_gender_birth_saved_and_serialized(client):
    host = _register(client, "sdd062-host@test.com")
    session = _create_class(client, host["h"])
    response = client.post(
        f"/api/v1/sessions/by-code/{session['access_code']}/join",
        json={"name": "게스트", "gender": "female", "birth_date": "1990-02-03"},
    )
    assert response.status_code == 200, response.text
    guest = response.json()["session"]["participants"][0]
    assert guest["gender"] == "female"
    assert guest["birth_date"] == "1990-02-03"

    db = _db()
    try:
        saved = db.get(SessionParticipant, UUID(response.json()["participant_id"]))
        assert saved.gender == "female"
        assert saved.birth_date == date(1990, 2, 3)
    finally:
        db.close()


def test_guest_gender_birth_omitted_stays_null(client):
    host = _register(client, "sdd062-null@test.com")
    session = _create_class(client, host["h"])
    response = client.post(
        f"/api/v1/sessions/by-code/{session['access_code']}/join",
        json={"name": "게스트"},
    )
    assert response.status_code == 200, response.text
    guest = response.json()["session"]["participants"][0]
    assert guest["gender"] is None
    assert guest["birth_date"] is None


def test_guest_invalid_gender_or_birth_date_rejected(client):
    host = _register(client, "sdd062-invalid@test.com")
    session = _create_class(client, host["h"])
    url = f"/api/v1/sessions/by-code/{session['access_code']}/join"
    for payload in (
        {"name": "게스트", "gender": "unknown"},
        {"name": "게스트", "birth_date": "1990-02-31"},
    ):
        response = client.post(url, json=payload)
        assert response.status_code == 422, response.text
