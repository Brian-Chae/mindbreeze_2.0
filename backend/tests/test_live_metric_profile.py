"""호스트 라이브 지표의 회원 프로필·게스트 개인정보 계약."""

import json
from datetime import date
from uuid import UUID

import pytest

from app.models.client_profile import ClientProfile
from app.models.session import SessionParticipant
from app.services.session_service import get_live_metrics
from tests.test_sdd015_class_code import _db
from tests.test_sdd021_session_class_flow import _create_group_class, _register


@pytest.mark.parametrize("override", [False, True])
def test_member_profile_and_participant_precedence(client, override):
    host = _register(client, "profile-host@test.com")
    session = _create_group_class(client, host["h"])
    member = _register(client, "profile-member@test.com", role="client")
    joined = client.post(
        f"/api/v1/sessions/by-code/{session['access_code']}/join",
        json={}, headers=member["h"],
    )
    assert joined.status_code == 200, joined.text
    with _db() as db:
        profile = ClientProfile(user_id=UUID(member["id"]))
        db.add(profile)
        profile.gender = "female"
        profile.birth_date = date(2001, 10, 3)
        profile.concerns = ["수면", "스트레스"]
        if override:
            participant = db.get(SessionParticipant, UUID(joined.json()["participant_id"]))
            participant.gender = "other"
            participant.birth_date = date(2000, 1, 2)
        db.commit()
        # 소켓 스냅샷도 사용하는 서비스 반환값에서 date는 JSON 안전해야 한다.
        metric = get_live_metrics(session["id"], host["id"], db)["metrics"][0]
        assert json.loads(json.dumps(metric))["birth_date"] == (
            "2000-01-02" if override else "2001-10-03"
        )
    response = client.get(f"/api/v1/sessions/{session['id']}/live-metrics", headers=host["h"])
    assert response.status_code == 200, response.text
    metric = response.json()["metrics"][0]
    assert metric["gender"] == ("other" if override else "female")
    assert metric["birth_date"] == ("2000-01-02" if override else "2001-10-03")
    assert metric["concerns"] == ["수면", "스트레스"]


def test_guest_and_member_without_profile(client):
    host = _register(client, "missing-host@test.com")
    session = _create_group_class(client, host["h"])
    member = _register(client, "missing-member@test.com", role="client")
    url = f"/api/v1/sessions/by-code/{session['access_code']}/join"
    assert client.post(url, json={}, headers=member["h"]).status_code == 200
    assert client.post(url, json={"name": "게스트", "gender": "male", "birth_date": "1990-02-03"}).status_code == 200
    with _db() as db:
        db.query(ClientProfile).filter_by(user_id=UUID(member["id"])).delete()
        db.commit()
    response = client.get(f"/api/v1/sessions/{session['id']}/live-metrics", headers=host["h"])
    assert response.status_code == 200, response.text
    metrics = response.json()["metrics"]
    member_metric = next(m for m in metrics if not m["is_guest"])
    guest_metric = next(m for m in metrics if m["is_guest"])
    assert (member_metric["gender"], member_metric["birth_date"], member_metric["concerns"]) == (None, None, [])
    assert (guest_metric["gender"], guest_metric["birth_date"], guest_metric["concerns"]) == ("male", "1990-02-03", [])
