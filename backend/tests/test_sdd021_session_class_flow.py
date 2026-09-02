"""SDD-021 — 클래스 시작 프로세스 1.0 패리티 (백엔드) QA

검증 항목:
- 클래스 시작 조건: 그룹 수업 active 참가자 0명 거부 / 1명 허용 / 대기열 제외
- 호스트 전용 live-metrics API (뇌파 값 placeholder)
- 게스트 by-code 상태 조회 (대기→명상→완료 전이 감지)
"""

from app.services import email_verify_service
from tests.conftest import create_test_org

VALID_PASSWORD = "Passw0rd!"


def _consents() -> dict:
    return {"tos": True, "privacy": True, "sensitive": True}


def _register(client, email: str, role: str = "counselor", org_code: str | None = None) -> dict:
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": f"{role}-{email.split('@')[0]}",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    if role == "counselor":
        payload["org_code"] = org_code if org_code is not None else create_test_org()
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body["access_token"]
    return {
        "id": body["user"]["id"],
        "token": token,
        "h": {"Authorization": f"Bearer {token}"},
    }


def _create_group_class(client, headers: dict, **overrides) -> dict:
    """그룹 명상 클래스 생성 (즉석, 코드 발급)."""
    payload = {
        "type": "meditation",
        "duration_min": 30,
        "title": "그룹 명상 클래스",
        "participant_mode": "group",
        "max_participants": 10,
    }
    payload.update(overrides)
    res = client.post("/api/v1/sessions", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _join_guest(client, code: str, name: str) -> str:
    res = client.post(f"/api/v1/sessions/by-code/{code}/join", json={"name": name})
    assert res.status_code == 200, res.text
    return res.json()["participant_id"]


# ---------------------------------------------------------------------------
# 1. 클래스 시작 조건 (그룹 수업 active 참가자 1명 이상)
# ---------------------------------------------------------------------------


def test_01_그룹_클래스_참가자0명_시작거부(client):
    counselor = _register(client, "s021c01@test.com")
    cls = _create_group_class(client, counselor["h"])

    res = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    assert res.status_code in (400, 409), res.text
    assert "참가자" in res.json()["detail"]


def test_02_그룹_클래스_참가자1명_시작허용(client):
    counselor = _register(client, "s021c02@test.com")
    cls = _create_group_class(client, counselor["h"])
    _join_guest(client, cls["access_code"], "게스트A")

    res = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "in_progress"


def test_03_대기열_제외하고_active만_카운트(client):
    """정원(max=1)을 초과한 초대는 대기열이 되고, active 1명이면 시작할 수 있다."""
    counselor = _register(client, "s021c03@test.com")
    cls = _create_group_class(client, counselor["h"], max_participants=1)
    m1 = _register(client, "s021m03a@test.com", role="client")
    m2 = _register(client, "s021m03b@test.com", role="client")
    # 첫 초대는 active, 두 번째는 정원 초과로 대기열
    client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": m1["id"]}, headers=counselor["h"])
    r2 = client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": m2["id"]}, headers=counselor["h"])
    assert r2.json()["waitlist_count"] == 1

    # active 1명(m1) 이므로 시작 허용 (대기열 m2 는 카운트에서 제외)
    res = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "in_progress"


def test_04_1대1_세션은_참가자0명이어도_시작허용_회귀방지(client):
    """1:1 세션은 기존 상태전이 동작을 유지한다 (참가자 검증 미적용)."""
    counselor = _register(client, "s021c04@test.com")
    payload = {"type": "clinical", "duration_min": 50, "title": "1:1 상담", "participant_mode": "one_on_one"}
    cls = client.post("/api/v1/sessions", json=payload, headers=counselor["h"]).json()

    res = client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "in_progress"


# ---------------------------------------------------------------------------
# 2. 호스트 전용 live-metrics API
# ---------------------------------------------------------------------------


def test_05_live_metrics_참가자표시_및_placeholder(client):
    counselor = _register(client, "s021c05@test.com")
    cls = _create_group_class(client, counselor["h"])
    _join_guest(client, cls["access_code"], "모니터게스트")

    res = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["session_id"] == cls["id"]
    assert body["access_code"] == cls["access_code"]
    assert len(body["metrics"]) == 1

    m = body["metrics"][0]
    assert m["display_name"] == "모니터게스트"
    assert m["is_guest"] is True
    assert m["band_connected"] is False
    # 뇌파 값은 이번 단계에서 null placeholder
    assert m["band_battery"] is None
    assert m["avg_efficiency"] is None
    assert m["current_efficiency"] is None
    assert m["last_eeg_at"] is None
    assert m["device_status"] == "unknown"
    assert m["upload_status"] == "idle"
    assert m["seat_number"] is None

    assert body["summary"]["participant_count"] == 1
    assert body["summary"]["contact_fail_count"] == 0


def test_06_live_metrics_로그인참가자_표시이름(client):
    counselor = _register(client, "s021c06@test.com")
    cls = _create_group_class(client, counselor["h"])
    member = _register(client, "s021m06@test.com", role="client")
    client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"]
    )

    res = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"])
    assert res.status_code == 200, res.text
    m = res.json()["metrics"][0]
    assert m["is_guest"] is False
    assert m["user_id"] == member["id"]
    assert m["display_name"] == "client-s021m06"


def test_07_live_metrics_host외_접근차단_403(client):
    counselor = _register(client, "s021c07@test.com")
    other = _register(client, "s021o07@test.com")
    cls = _create_group_class(client, counselor["h"])

    res = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=other["h"])
    assert res.status_code == 403


def test_08_live_metrics_대기열_제외(client):
    """대기열 참가자는 모니터링 테이블에서 제외된다."""
    counselor = _register(client, "s021c08@test.com")
    cls = _create_group_class(client, counselor["h"], max_participants=1)
    # 로그인 사용자 초대로 대기열을 발생시킨다
    m1 = _register(client, "s021m08a@test.com", role="client")
    m2 = _register(client, "s021m08b@test.com", role="client")
    client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": m1["id"]}, headers=counselor["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/invite", json={"user_id": m2["id"]}, headers=counselor["h"])

    res = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"])
    assert res.status_code == 200, res.text
    # active 1명(m1)만 노출, m2 는 대기열이라 제외
    assert len(res.json()["metrics"]) == 1


# ---------------------------------------------------------------------------
# 3. 게스트 by-code 상태 조회 (대기 → 명상 → 완료 전이)
# ---------------------------------------------------------------------------


def test_09_게스트_state_대기중(client):
    counselor = _register(client, "s021c09@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "대기게스트")

    res = client.get(f"/api/v1/sessions/by-code/{cls['access_code']}/state?participant_id={pid}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["session_id"] == cls["id"]
    assert body["in_progress"] is False
    assert body["ended"] is False
    assert body["participant_state"] == "READY"


def test_10_게스트_state_시작후_명상전이(client):
    counselor = _register(client, "s021c10@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "명상게스트")
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])

    res = client.get(f"/api/v1/sessions/by-code/{cls['access_code']}/state?participant_id={pid}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["in_progress"] is True
    assert body["participant_state"] == "STARTED"


def test_11_게스트_state_종료후_완료(client):
    counselor = _register(client, "s021c11@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "완료게스트")
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"])

    res = client.get(f"/api/v1/sessions/by-code/{cls['access_code']}/state?participant_id={pid}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["in_progress"] is False
    assert body["ended"] is True
    assert body["participant_state"] == "COMPLETED"


def test_12_게스트_state_participant_id_없이도_세션상태조회(client):
    counselor = _register(client, "s021c12@test.com")
    cls = _create_group_class(client, counselor["h"])

    res = client.get(f"/api/v1/sessions/by-code/{cls['access_code']}/state")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "ready"
    assert body["participant_state"] is None


def test_13_게스트_state_잘못된_코드_404(client):
    res = client.get("/api/v1/sessions/by-code/ZZZZZZ/state")
    assert res.status_code == 404
