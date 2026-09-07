"""SDD-023 — LINK BAND 실연동: EEG feature ingestion (백엔드) QA

검증 항목:
- POST /sessions/{id}/features 5초 배치 → EEGFeatureWindow 저장 (게스트/로그인 참가자)
- participant 검증: 비참가자 403, 게스트 participant_id 경로
- live-metrics 가 최신 윈도우 실값(두뇌휴식도/연결상태/신호품질) 반영
- 게스트 by-code state 실데이터 반영
- 중복 초 인덱스 멱등, null 보존(0 치환 금지)
"""

from app.services import email_verify_service
from tests.conftest import create_test_org

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str, role: str = "counselor", org_code: str | None = None) -> dict:
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": f"{role}-{email.split('@')[0]}",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    if role == "counselor":
        payload["org_code"] = org_code if org_code is not None else create_test_org()
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    return {"id": body["user"]["id"], "h": {"Authorization": f"Bearer {body['access_token']}"}}


def _create_group_class(client, headers: dict, **overrides) -> dict:
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


def _feature(second_offset: int, **over) -> dict:
    base = {"second_offset": second_offset}
    base.update(over)
    return base


def _batch(sec_range, **over) -> list[dict]:
    return [_feature(i, **over) for i in sec_range]


# ---------------------------------------------------------------------------
# 1. ingestion 저장
# ---------------------------------------------------------------------------


def test_01_게스트_participant_id로_5초배치_저장(client):
    counselor = _register(client, "s023c01@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "게스트A")

    features = [
        _feature(
            i,
            timestamp=1_700_000_000_000 + i * 1000,
            delta_power=1.0, theta_power=2.0, alpha_power=3.0, beta_power=4.0, gamma_power=5.0,
            total_power=15.0,
            focus_index=0.6 + i * 0.01,
            relaxation_index=0.5 + i * 0.02,
            stress_index=0.3,
            meditation_level=0.7,
            attention_level=0.65,
            cognitive_load=0.4,
            emotional_stability=0.55,
            hemispheric_balance=0.1,
            signal_quality=0.9,
        )
        for i in range(5)
    ]
    res = client.post(f"/api/v1/sessions/{cls['id']}/features", json={"participant_id": pid, "features": features})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["session_id"] == cls["id"]
    assert body["saved"] == 5


def test_02_로그인_참가자_JWT로_업로드(client):
    counselor = _register(client, "s023c02@test.com")
    cls = _create_group_class(client, counselor["h"])
    member = _register(client, "s023m02@test.com", role="client")
    # 로그인 참가자로 참여 → user_id 기반 참가자 행 생성
    client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={}, headers=member["h"])

    # participant_id 없이 인증 토큰만으로 업로드
    res = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"features": _batch(range(3), relaxation_index=0.5, signal_quality=0.9)},
        headers=member["h"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["saved"] == 3


# ---------------------------------------------------------------------------
# 2. participant 검증 (403)
# ---------------------------------------------------------------------------


def test_03_비참가자_인증사용자_업로드_403(client):
    counselor = _register(client, "s023c03@test.com")
    other = _register(client, "s023o03@test.com", role="client")  # 세션에 참여하지 않은 사용자
    cls = _create_group_class(client, counselor["h"])

    res = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"features": _batch(range(2), relaxation_index=0.5)},
        headers=other["h"],
    )
    assert res.status_code == 403, res.text


def test_04_인증도_participant_id도_없으면_403(client):
    counselor = _register(client, "s023c04@test.com")
    cls = _create_group_class(client, counselor["h"])

    res = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"features": _batch(range(2), relaxation_index=0.5)},
    )
    assert res.status_code == 403, res.text


def test_05_존재하지않는_participant_id_403(client):
    counselor = _register(client, "s023c05@test.com")
    cls = _create_group_class(client, counselor["h"])
    import uuid as _uuid

    res = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": str(_uuid.uuid4()), "features": _batch(range(2))},
    )
    assert res.status_code == 403, res.text


# ---------------------------------------------------------------------------
# 3. live-metrics 실데이터 반영
# ---------------------------------------------------------------------------


def test_06_live_metrics_실데이터_두뇌휴식도_연결상태(client):
    counselor = _register(client, "s023c06@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "모니터게스트")

    features = [_feature(i, relaxation_index=0.4 + i * 0.1, signal_quality=0.9) for i in range(3)]
    client.post(f"/api/v1/sessions/{cls['id']}/features", json={"participant_id": pid, "features": features})

    res = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"])
    assert res.status_code == 200, res.text
    m = res.json()["metrics"][0]
    # 최신 윈도우(i=2) 두뇌휴식도 = 0.6
    assert abs(m["current_efficiency"] - 0.6) < 1e-6
    # 평균 = (0.4+0.5+0.6)/3 = 0.5
    assert abs(m["avg_efficiency"] - 0.5) < 1e-6
    assert m["device_status"] == "ok"  # signal_quality 0.9 → valid → ok
    assert m["upload_status"] == "streaming"
    assert m["last_eeg_at"] is not None
    assert res.json()["summary"]["contact_fail_count"] == 0


def test_07_live_metrics_신호불량_접촉실패_집계(client):
    counselor = _register(client, "s023c07@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "불량게스트")

    # 최신 윈도우 signal_quality 0.5 → degraded → lead_off
    client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": [_feature(0, relaxation_index=0.5, signal_quality=0.5)]},
    )
    res = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"])
    body = res.json()
    assert body["metrics"][0]["device_status"] == "lead_off"
    assert body["summary"]["contact_fail_count"] == 1


def test_08_live_metrics_feature없으면_placeholder_유지(client):
    counselor = _register(client, "s023c08@test.com")
    cls = _create_group_class(client, counselor["h"])
    _join_guest(client, cls["access_code"], "미착용게스트")

    res = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"])
    m = res.json()["metrics"][0]
    assert m["current_efficiency"] is None
    assert m["avg_efficiency"] is None
    assert m["device_status"] == "unknown"
    assert m["upload_status"] == "idle"
    assert m["last_eeg_at"] is None


def test_09_null_보존_relaxation_null이면_효율_null(client):
    """relaxation_index 를 null 로 업로드하면 효율은 0 이 아니라 null 로 유지된다."""
    counselor = _register(client, "s023c09@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "널게스트")

    client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": [_feature(0, relaxation_index=None, signal_quality=0.9)]},
    )
    res = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"])
    m = res.json()["metrics"][0]
    assert m["current_efficiency"] is None
    assert m["avg_efficiency"] is None
    # 신호 자체는 수신되었으므로 device/upload 는 실값
    assert m["device_status"] == "ok"
    assert m["upload_status"] == "streaming"


# ---------------------------------------------------------------------------
# 4. 게스트 by-code state 실데이터
# ---------------------------------------------------------------------------


def test_10_게스트_state_실데이터_반영(client):
    counselor = _register(client, "s023c10@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "명상게스트")

    features = [_feature(i, relaxation_index=0.4 + i * 0.1, focus_index=0.7, signal_quality=0.95) for i in range(3)]
    client.post(f"/api/v1/sessions/{cls['id']}/features", json={"participant_id": pid, "features": features})

    res = client.get(f"/api/v1/sessions/by-code/{cls['access_code']}/state?participant_id={pid}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert abs(body["relaxation_index"] - 0.6) < 1e-6  # 최신 윈도우
    assert abs(body["focus_index"] - 0.7) < 1e-6
    assert abs(body["signal_quality"] - 0.95) < 1e-6
    assert body["band_connected"] is True
    assert body["last_eeg_at"] is not None


def test_11_게스트_state_feature없으면_null(client):
    counselor = _register(client, "s023c11@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "무데이터게스트")

    res = client.get(f"/api/v1/sessions/by-code/{cls['access_code']}/state?participant_id={pid}")
    body = res.json()
    assert body["relaxation_index"] is None
    assert body["focus_index"] is None
    assert body["signal_quality"] is None
    assert body["last_eeg_at"] is None


# ---------------------------------------------------------------------------
# 5. 멱등 (중복 초 인덱스 skip)
# ---------------------------------------------------------------------------


def test_12_중복_초인덱스_재업로드_skip(client):
    counselor = _register(client, "s023c12@test.com")
    cls = _create_group_class(client, counselor["h"])
    pid = _join_guest(client, cls["access_code"], "재업로드게스트")

    b1 = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": _batch(range(0, 5), relaxation_index=0.5, signal_quality=0.9)},
    )
    assert b1.json()["saved"] == 5

    # 3~7 재업로드 → 3,4 는 중복 skip, 5,6,7 만 저장
    b2 = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": pid, "features": _batch(range(3, 8), relaxation_index=0.5, signal_quality=0.9)},
    )
    assert b2.json()["saved"] == 3


def test_13_그룹세션_다참가자_동일초인덱스_공존(client):
    """유니크 제약이 (session, participant, window) 이므로 참가자별 동일 초 인덱스 공존."""
    counselor = _register(client, "s023c13@test.com")
    cls = _create_group_class(client, counselor["h"])
    p1 = _join_guest(client, cls["access_code"], "게스트1")
    p2 = _join_guest(client, cls["access_code"], "게스트2")

    r1 = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": p1, "features": _batch(range(3), relaxation_index=0.5, signal_quality=0.9)},
    )
    r2 = client.post(
        f"/api/v1/sessions/{cls['id']}/features",
        json={"participant_id": p2, "features": _batch(range(3), relaxation_index=0.8, signal_quality=0.9)},
    )
    assert r1.json()["saved"] == 3
    assert r2.json()["saved"] == 3

    res = client.get(f"/api/v1/sessions/{cls['id']}/live-metrics", headers=counselor["h"])
    metrics = {m["display_name"]: m for m in res.json()["metrics"]}
    assert abs(metrics["게스트1"]["current_efficiency"] - 0.5) < 1e-6
    assert abs(metrics["게스트2"]["current_efficiency"] - 0.8) < 1e-6
