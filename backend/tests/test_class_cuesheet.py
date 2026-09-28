"""진행 큐시트(타임라인 대본) QA.

- Session.cuesheet (JSONB: [{label, duration_min, note}])
- SessionCreate/UpdateRequest 노출, SessionResponse 노출
- 복제/템플릿 저장 시 큐시트 승계
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
        "max_participants": 12,
        "location_type": "online",
        "participant_mode": "group",
        "linkband_mode": "optional",
    }
    payload.update(overrides)
    return payload


# 명상 클래스 흐름 예시 — 도입 호흡 → 바디스캔 → 마무리
CUESHEET = [
    {"label": "도입 호흡", "duration_min": 5, "note": "4-7-8 호흡으로 몸 이완"},
    {"label": "바디스캔", "duration_min": 20, "note": "발끝에서 머리까지 천천히"},
    {"label": "마무리", "duration_min": 5, "note": "느린 심호흡 후 눈 뜨기"},
]


# ── 생성 ────────────────────────────────────────────────────────────────


def test_01_생성시_큐시트가_저장되고_응답에_노출된다(client):
    host = _register(client, "cue01@test.com")
    res = client.post(
        "/api/v1/sessions",
        json=_payload(cuesheet=CUESHEET),
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert "cuesheet" in body
    assert body["cuesheet"] == CUESHEET

    fetched = client.get(f"/api/v1/sessions/{body['id']}", headers=host["auth"]).json()
    assert fetched["cuesheet"] == CUESHEET


def test_02_미작성이면_빈_배열로_내려온다(client):
    host = _register(client, "cue02@test.com")
    body = client.post("/api/v1/sessions", json=_payload(), headers=host["auth"]).json()
    assert body["cuesheet"] == []


def test_03_목록에도_큐시트가_포함된다(client):
    host = _register(client, "cue03@test.com")
    created = client.post(
        "/api/v1/sessions", json=_payload(cuesheet=CUESHEET), headers=host["auth"]
    ).json()
    listed = client.get("/api/v1/sessions", headers=host["auth"]).json()
    row = next(s for s in listed["sessions"] if s["id"] == created["id"])
    assert row["cuesheet"] == CUESHEET
    assert all("cuesheet" in s for s in listed["sessions"])


def test_04_메모는_생략_가능하다(client):
    host = _register(client, "cue04@test.com")
    body = client.post(
        "/api/v1/sessions",
        json=_payload(cuesheet=[{"label": "호흡", "duration_min": 3}]),
        headers=host["auth"],
    ).json()
    assert body["cuesheet"] == [{"label": "호흡", "duration_min": 3, "note": None}]


# ── 검증 ────────────────────────────────────────────────────────────────


def test_05_라벨이_비면_422(client):
    host = _register(client, "cue05@test.com")
    res = client.post(
        "/api/v1/sessions",
        json=_payload(cuesheet=[{"label": "", "duration_min": 5}]),
        headers=host["auth"],
    )
    assert res.status_code == 422


def test_06_목표시간이_0이하면_422(client):
    host = _register(client, "cue06@test.com")
    res = client.post(
        "/api/v1/sessions",
        json=_payload(cuesheet=[{"label": "바디스캔", "duration_min": 0}]),
        headers=host["auth"],
    )
    assert res.status_code == 422


def test_07_단계는_30개까지(client):
    host = _register(client, "cue07@test.com")
    steps = [{"label": f"단계 {i}", "duration_min": 1} for i in range(31)]
    res = client.post(
        "/api/v1/sessions",
        json=_payload(cuesheet=steps),
        headers=host["auth"],
    )
    assert res.status_code == 422


# ── 수정 ────────────────────────────────────────────────────────────────


def test_08_수정으로_큐시트를_통째_교체한다(client):
    host = _register(client, "cue08@test.com")
    created = client.post(
        "/api/v1/sessions", json=_payload(cuesheet=CUESHEET), headers=host["auth"]
    ).json()

    updated_steps = [{"label": "자애 명상", "duration_min": 30, "note": "메타 명상"}]
    res = client.put(
        f"/api/v1/sessions/{created['id']}",
        json={"cuesheet": updated_steps},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["cuesheet"] == updated_steps


def test_09_수정에서_큐시트를_생략하면_유지된다(client):
    host = _register(client, "cue09@test.com")
    created = client.post(
        "/api/v1/sessions", json=_payload(cuesheet=CUESHEET), headers=host["auth"]
    ).json()

    res = client.put(
        f"/api/v1/sessions/{created['id']}",
        json={"title": "제목만 변경"},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["cuesheet"] == CUESHEET


def test_10_빈_배열로_수정하면_큐시트가_비워진다(client):
    host = _register(client, "cue10@test.com")
    created = client.post(
        "/api/v1/sessions", json=_payload(cuesheet=CUESHEET), headers=host["auth"]
    ).json()

    res = client.put(
        f"/api/v1/sessions/{created['id']}",
        json={"cuesheet": []},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["cuesheet"] == []


# ── 복제 · 템플릿 ───────────────────────────────────────────────────────


def test_11_복제하면_큐시트도_따라온다(client):
    host = _register(client, "cue11@test.com")
    src = client.post(
        "/api/v1/sessions",
        json=_payload(scheduled_at=_future(120), cuesheet=CUESHEET),
        headers=host["auth"],
    ).json()

    dup = client.post(f"/api/v1/sessions/{src['id']}/duplicate", headers=host["auth"]).json()
    assert dup["cuesheet"] == CUESHEET


def test_12_템플릿으로_저장해도_큐시트가_남는다(client):
    host = _register(client, "cue12@test.com")
    src = client.post(
        "/api/v1/sessions", json=_payload(cuesheet=CUESHEET), headers=host["auth"]
    ).json()
    tpl = client.post(
        f"/api/v1/sessions/{src['id']}/save-as-template", headers=host["auth"]
    ).json()
    assert tpl["is_template"] is True
    assert tpl["cuesheet"] == CUESHEET


def test_13_타인_클래스_수정은_403(client):
    host = _register(client, "cue13@test.com")
    other = _register(client, "cue13b@test.com")
    created = client.post(
        "/api/v1/sessions", json=_payload(cuesheet=CUESHEET), headers=host["auth"]
    ).json()
    res = client.put(
        f"/api/v1/sessions/{created['id']}",
        json={"cuesheet": []},
        headers=other["auth"],
    )
    assert res.status_code == 403
