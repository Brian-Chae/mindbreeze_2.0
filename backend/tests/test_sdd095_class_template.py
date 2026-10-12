"""SDD-095 클래스 템플릿 · 복제 QA.

- Session.is_template (템플릿 저장본)
- POST /sessions/{id}/duplicate (호스트 전용 복제)
- POST /sessions/{id}/save-as-template
- GET /sessions/templates
"""

from datetime import datetime, timedelta, timezone

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str, role: str = "counselor") -> dict:
    from app.services import email_verify_service
    from tests.conftest import create_test_org, post_register

    payload = {
        "org_code": create_test_org(),
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = post_register(client, role, payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {
        "id": body["user"]["id"],
        "access_token": token,
        "auth": {"Authorization": f"Bearer {token}"},
    }


def _future(minutes: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _payload(**overrides):
    payload = {
        "type": "meditation",
        "duration_min": 40,
        "title": "주간 명상 수업",
        "notes": "매주 같은 진행 안내문",
        "max_participants": 12,
        "location_type": "online",
        "participant_mode": "group",
        "linkband_mode": "optional",
        "record_audio": True,
        "record_video": False,
    }
    payload.update(overrides)
    return payload


# ── 템플릿 저장 (is_template) ──────────────────────────────────────────────


def test_01_템플릿으로_저장하면_코드와_일정이_없다(client):
    host = _register(client, "tpl01@test.com")
    res = client.post(
        "/api/v1/sessions",
        json=_payload(is_template=True),
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["is_template"] is True
    assert body["access_code"] is None
    assert body["scheduled_at"] is None
    assert body["status"] == "ready"
    # 템플릿은 실제 진행 대상이 아니므로 WebRTC 룸·채팅방도 만들지 않는다
    assert body["webrtc_room_id"] is None
    assert body.get("chat_room_id") is None


def test_02_템플릿은_일반_클래스_목록에서_제외되고_템플릿_목록에_나온다(client):
    host = _register(client, "tpl02@test.com")
    template = client.post(
        "/api/v1/sessions", json=_payload(is_template=True), headers=host["auth"]
    ).json()
    real = client.post(
        "/api/v1/sessions",
        json=_payload(scheduled_at=_future(120), title="실제 클래스"),
        headers=host["auth"],
    ).json()

    listed = client.get("/api/v1/sessions", headers=host["auth"]).json()
    ids = {s["id"] for s in listed["sessions"]}
    assert real["id"] in ids
    assert template["id"] not in ids

    templates = client.get("/api/v1/sessions/templates", headers=host["auth"]).json()
    tpl_ids = {s["id"] for s in templates["sessions"]}
    assert template["id"] in tpl_ids
    assert real["id"] not in tpl_ids
    assert templates["total"] == 1


def test_03_템플릿_목록은_본인_것만_보인다(client):
    host = _register(client, "tpl03@test.com")
    other = _register(client, "tpl03b@test.com")
    client.post("/api/v1/sessions", json=_payload(is_template=True), headers=host["auth"])

    mine = client.get("/api/v1/sessions/templates", headers=host["auth"]).json()
    theirs = client.get("/api/v1/sessions/templates", headers=other["auth"]).json()
    assert mine["total"] == 1
    assert theirs["total"] == 0


def test_04_기존_클래스를_템플릿으로_저장(client):
    host = _register(client, "tpl04@test.com")
    s = client.post(
        "/api/v1/sessions",
        json=_payload(scheduled_at=_future(90), title="원본 클래스"),
        headers=host["auth"],
    ).json()
    res = client.post(f"/api/v1/sessions/{s['id']}/save-as-template", headers=host["auth"])
    assert res.status_code == 201, res.text
    tpl = res.json()
    assert tpl["is_template"] is True
    assert tpl["id"] != s["id"]
    assert tpl["title"] == "원본 클래스"
    # 원본은 그대로 남는다
    assert client.get(f"/api/v1/sessions/{s['id']}", headers=host["auth"]).status_code == 200


# ── 복제 (duplicate) ───────────────────────────────────────────────────────


def test_05_복제하면_유형설정만_복사되고_코드와_회차는_신규발급된다(client):
    host = _register(client, "dup05@test.com")
    src = client.post(
        "/api/v1/sessions",
        json=_payload(scheduled_at=_future(120)),
        headers=host["auth"],
    ).json()
    # 채팅 on/off 같은 정책도 복제 대상인지 확인
    client.post(
        f"/api/v1/sessions/{src['id']}/chat-enabled",
        json={"enabled": True},
        headers=host["auth"],
    )

    res = client.post(f"/api/v1/sessions/{src['id']}/duplicate", headers=host["auth"])
    assert res.status_code == 201, res.text
    dup = res.json()

    assert dup["id"] != src["id"]
    # 유형 설정은 그대로
    assert dup["type"] == src["type"]
    assert dup["duration_min"] == src["duration_min"]
    assert dup["title"] == src["title"]
    assert dup["notes"] == src["notes"]
    assert dup["max_participants"] == src["max_participants"]
    assert dup["location_type"] == src["location_type"]
    assert dup["participant_mode"] == src["participant_mode"]
    assert dup["linkband_mode"] == src["linkband_mode"]
    assert dup["record_audio"] is True
    assert dup["record_video"] is False
    assert dup["chat_enabled"] is True
    # 신규 발급 항목
    assert dup["access_code"] != src["access_code"]
    assert dup["access_code"]
    assert dup["run_id"] == dup["id"]
    assert dup["webrtc_room_id"] != src["webrtc_room_id"]
    # 일정은 복사하지 않는다 → 즉석 클래스(ready)
    assert dup["scheduled_at"] is None
    assert dup["status"] == "ready"
    assert dup["is_template"] is False
    # 참여자 명단은 복사하지 않는다
    assert dup["participants"] == []
    assert dup["host_id"] == src["host_id"]


def test_06_복제시_일정을_지정하면_예약상태가_된다(client):
    host = _register(client, "dup06@test.com")
    src = client.post("/api/v1/sessions", json=_payload(), headers=host["auth"]).json()
    when = _future(240)

    res = client.post(
        f"/api/v1/sessions/{src['id']}/duplicate",
        json={"scheduled_at": when, "title": "복제본 제목"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "scheduled"
    assert body["scheduled_at"] is not None
    assert body["title"] == "복제본 제목"


def test_07_복제시_일정충돌은_409_force_면_허용(client):
    host = _register(client, "dup07@test.com")
    when = _future(300)
    src = client.post("/api/v1/sessions", json=_payload(), headers=host["auth"]).json()
    client.post(
        "/api/v1/sessions",
        json=_payload(scheduled_at=when, duration_min=60),
        headers=host["auth"],
    )

    conflict = client.post(
        f"/api/v1/sessions/{src['id']}/duplicate",
        json={"scheduled_at": when},
        headers=host["auth"],
    )
    assert conflict.status_code == 409

    forced = client.post(
        f"/api/v1/sessions/{src['id']}/duplicate",
        json={"scheduled_at": when, "force": True},
        headers=host["auth"],
    )
    assert forced.status_code == 201, forced.text


def test_08_복제시_과거_일정은_400(client):
    host = _register(client, "dup08@test.com")
    src = client.post("/api/v1/sessions", json=_payload(), headers=host["auth"]).json()
    past = (datetime.now(timezone.utc) - timedelta(minutes=90)).isoformat()
    res = client.post(
        f"/api/v1/sessions/{src['id']}/duplicate",
        json={"scheduled_at": past},
        headers=host["auth"],
    )
    assert res.status_code == 400


def test_09_템플릿에서_복제하면_실제_클래스가_된다(client):
    host = _register(client, "dup09@test.com")
    tpl = client.post(
        "/api/v1/sessions",
        json=_payload(is_template=True, custom_type_name=None),
        headers=host["auth"],
    ).json()

    res = client.post(f"/api/v1/sessions/{tpl['id']}/duplicate", headers=host["auth"])
    assert res.status_code == 201, res.text
    spawned = res.json()
    assert spawned["is_template"] is False
    assert spawned["access_code"] is not None
    assert spawned["webrtc_room_id"] is not None
    assert spawned["duration_min"] == tpl["duration_min"]
    assert spawned["max_participants"] == tpl["max_participants"]
    # 복제본은 일반 클래스 목록에 나타난다
    listed = client.get("/api/v1/sessions", headers=host["auth"]).json()
    assert spawned["id"] in {s["id"] for s in listed["sessions"]}


def test_10_커스텀_유형_이름도_복제된다(client):
    host = _register(client, "dup10@test.com")
    src = client.post(
        "/api/v1/sessions",
        json=_payload(type="custom", custom_type_name="집단상담"),
        headers=host["auth"],
    ).json()
    res = client.post(f"/api/v1/sessions/{src['id']}/duplicate", headers=host["auth"])
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["type"] == "custom"
    assert body["custom_type_name"] == "집단상담"


def test_11_타인_복제_403(client):
    host = _register(client, "dup11@test.com")
    other = _register(client, "dup11b@test.com")
    src = client.post("/api/v1/sessions", json=_payload(), headers=host["auth"]).json()
    res = client.post(f"/api/v1/sessions/{src['id']}/duplicate", headers=other["auth"])
    assert res.status_code == 403


def test_12_비로그인_복제_401(client):
    host = _register(client, "dup12@test.com")
    src = client.post("/api/v1/sessions", json=_payload(), headers=host["auth"]).json()
    res = client.post(f"/api/v1/sessions/{src['id']}/duplicate")
    assert res.status_code == 401


def test_13_없는_세션_복제_404(client):
    host = _register(client, "dup13@test.com")
    res = client.post(
        "/api/v1/sessions/00000000-0000-0000-0000-000000000000/duplicate",
        headers=host["auth"],
    )
    assert res.status_code == 404


def test_14_종료된_클래스도_복제할_수_있다(client):
    """반복 클래스 재개설의 핵심 시나리오 — 완료된 클래스 설정을 그대로 다시 시작한다."""
    host = _register(client, "dup14@test.com")
    src = client.post(
        "/api/v1/sessions",
        # 그룹 클래스는 시작 시 참가자 1명 이상이 필요하므로 1:1 로 진행한다
        json=_payload(scheduled_at=_future(30), participant_mode="one_on_one"),
        headers=host["auth"],
    ).json()
    client.post(f"/api/v1/sessions/{src['id']}/start", headers=host["auth"])
    ended = client.post(f"/api/v1/sessions/{src['id']}/end", headers=host["auth"])
    assert ended.json()["status"] == "completed"

    res = client.post(f"/api/v1/sessions/{src['id']}/duplicate", headers=host["auth"])
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "ready"
    assert body["is_template"] is False
    assert body["ended_at"] is None
    assert body["started_at"] is None


def test_15_복제본은_새_채팅방을_갖는다(client):
    host = _register(client, "dup15@test.com")
    src = client.post("/api/v1/sessions", json=_payload(), headers=host["auth"]).json()
    dup = client.post(f"/api/v1/sessions/{src['id']}/duplicate", headers=host["auth"]).json()
    assert dup["chat_room_id"] is not None
    assert dup["chat_room_id"] != src["chat_room_id"]


def test_16_응답에_항상_is_template_이_포함된다(client):
    host = _register(client, "dup16@test.com")
    created = client.post("/api/v1/sessions", json=_payload(), headers=host["auth"]).json()
    assert "is_template" in created and created["is_template"] is False
    fetched = client.get(f"/api/v1/sessions/{created['id']}", headers=host["auth"]).json()
    assert "is_template" in fetched and fetched["is_template"] is False
    listed = client.get("/api/v1/sessions", headers=host["auth"]).json()
    assert all("is_template" in s for s in listed["sessions"])
