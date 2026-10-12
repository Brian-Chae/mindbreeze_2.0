"""SDD-191 — API 권한·검증·격리 QA.

verify.md 시나리오: TS13(권한/검증), TS12(격리), TS6/TS8 계약 필드 대조.
"""

from tests import agent_helpers as H

RISK_TEXT_HIGH = "요즘 죽고 싶다는 생각이 계속 들어요."
PREFIX = "/api/v1/agent/counselor"


def _pair(client, prefix: str, *, enabled: bool = False):
    counselor = H.register_counselor(f"{prefix}-c@test.com", name="김상담")
    member = H.register_client(client, f"{prefix}-m@test.com", name="박내담")
    H.link_client(counselor["id"], member["id"])
    H.agree_consent(client, member["h"])
    if enabled:
        H.set_checkin_enabled(counselor["id"], member["id"], True)
    return counselor, member


# ── 내담자 — 안부 설정 ────────────────────────────────────────────


def test_TS13_상담사가_켜지_않으면_available_이_false_다(client):
    _, member = _pair(client, "api-pref-a")

    body = client.get("/api/v1/agent/checkin-prefs", headers=member["h"]).json()

    assert body == {"available": False, "paused": False}


def test_TS13_상담사가_켜면_available_이_true_가_된다(client):
    _, member = _pair(client, "api-pref-b", enabled=True)

    body = client.get("/api/v1/agent/checkin-prefs", headers=member["h"]).json()

    assert body["available"] is True
    assert body["paused"] is False


def test_TS13_일시중지_설정이_저장되고_되돌릴_수_있다(client):
    _, member = _pair(client, "api-pref-c", enabled=True)

    res = client.put(
        "/api/v1/agent/checkin-prefs", json={"paused": True}, headers=member["h"]
    )
    assert res.status_code == 200, res.text
    assert res.json()["paused"] is True
    assert client.get("/api/v1/agent/checkin-prefs", headers=member["h"]).json()["paused"] is True

    res = client.put(
        "/api/v1/agent/checkin-prefs", json={"paused": False}, headers=member["h"]
    )
    assert res.json()["paused"] is False


def test_TS13_prefs_PUT_형식을_검증한다(client):
    _, member = _pair(client, "api-pref-d", enabled=True)

    assert (
        client.put(
            "/api/v1/agent/checkin-prefs", json={"paused": "yes please"}, headers=member["h"]
        ).status_code
        == 422
    )
    assert (
        client.put("/api/v1/agent/checkin-prefs", json={}, headers=member["h"]).status_code == 422
    )


def test_TS13_상담사_토큰으로는_내담자_안부_설정에_접근할_수_없다(client):
    counselor, _ = _pair(client, "api-pref-e")

    assert (
        client.get("/api/v1/agent/checkin-prefs", headers=counselor["h"]).status_code == 403
    )
    assert (
        client.put(
            "/api/v1/agent/checkin-prefs", json={"paused": True}, headers=counselor["h"]
        ).status_code
        == 403
    )


# ── 상담사 — 안부 스위치 ──────────────────────────────────────────


def test_TS13_담당_내담자_목록에_켜짐_여부가_나온다(client):
    counselor, member = _pair(client, "api-sw-a")

    body = client.get(f"{PREFIX}/checkin/clients", headers=counselor["h"]).json()

    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["client_id"] == member["id"]
    assert item["client_name"] == "박내담"
    assert item["enabled"] is False
    assert item["last_checkin_at"] is None
    assert item["open_risk_count"] == 0


def test_TS13_켜기_끄기가_즉시_반영된다(client):
    counselor, member = _pair(client, "api-sw-b")

    res = client.put(
        f"{PREFIX}/checkin/clients/{member['id']}",
        json={"enabled": True},
        headers=counselor["h"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["enabled"] is True
    assert client.get("/api/v1/agent/checkin-prefs", headers=member["h"]).json()["available"]

    res = client.put(
        f"{PREFIX}/checkin/clients/{member['id']}",
        json={"enabled": False},
        headers=counselor["h"],
    )
    assert res.json()["enabled"] is False


def test_TS13_담당이_아닌_내담자_켜기는_404_다(client):
    counselor, _ = _pair(client, "api-sw-c")
    other_member = H.register_client(client, "api-sw-c-other@test.com", name="최내담")

    res = client.put(
        f"{PREFIX}/checkin/clients/{other_member['id']}",
        json={"enabled": True},
        headers=counselor["h"],
    )
    assert res.status_code == 404, res.text


def test_TS13_내담자_토큰으로는_상담사_API_에_접근할_수_없다(client):
    _, member = _pair(client, "api-sw-d")

    for method, path in (
        ("get", f"{PREFIX}/checkin/clients"),
        ("get", f"{PREFIX}/risk-signals"),
        ("get", f"{PREFIX}/clients/{member['id']}/profile"),
        ("get", f"{PREFIX}/clients/{member['id']}/checkins"),
    ):
        res = getattr(client, method)(path, headers=member["h"])
        assert res.status_code == 403, f"{path}: {res.status_code}"


def test_TS13_enable_PUT_형식을_검증한다(client):
    counselor, member = _pair(client, "api-sw-e")

    res = client.put(
        f"{PREFIX}/checkin/clients/{member['id']}", json={}, headers=counselor["h"]
    )
    assert res.status_code == 422, res.text


# ── 상담사 — 프로파일 PATCH 검증 ─────────────────────────────────


def _profile_item_id(client, counselor: dict, member: dict) -> str:
    """프로파일 항목 1건을 직접 심어 id 를 돌려준다(검증 테스트용)."""
    from app.models.agent import AgentProfileItem

    conn = H.db()
    try:
        item = AgentProfileItem(
            client_id=H._uuid(member["id"]),
            counselor_id=H._uuid(counselor["id"]),
            category="sleep",
            text="잠들기까지 오래 걸린다고 이야기함",
            status="ai_estimate",
            evidence=[],
        )
        conn.add(item)
        conn.commit()
        return str(item.id)
    finally:
        conn.close()


def test_TS13_profile_PATCH_text_300자_초과는_422_다(client):
    counselor, member = _pair(client, "api-pf-a")
    item_id = _profile_item_id(client, counselor, member)

    res = client.patch(
        f"{PREFIX}/profile-items/{item_id}",
        json={"text": "가" * 301},
        headers=counselor["h"],
    )
    assert res.status_code == 422, res.text

    res = client.patch(
        f"{PREFIX}/profile-items/{item_id}",
        json={"text": "가" * 300},
        headers=counselor["h"],
    )
    assert res.status_code == 200, res.text


def test_TS13_profile_PATCH_빈_본문은_400_이고_잘못된_status_는_422_다(client):
    counselor, member = _pair(client, "api-pf-b")
    item_id = _profile_item_id(client, counselor, member)

    assert (
        client.patch(
            f"{PREFIX}/profile-items/{item_id}", json={}, headers=counselor["h"]
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"{PREFIX}/profile-items/{item_id}",
            json={"status": "ai_estimate"},
            headers=counselor["h"],
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"{PREFIX}/profile-items/{item_id}", json={"text": "   "}, headers=counselor["h"]
        ).status_code
        == 422
    )


# ── 상담사 — 체크인 요약 조회 ────────────────────────────────────


def test_TS13_체크인_요약_목록은_요약만_담는다(client):
    counselor, member = _pair(client, "api-ck-a", enabled=True)
    H.run_checkin_sweep(now=H.kst_at(10, 0))
    secret = "사촌 결혼식에서 크게 다퉜어요"
    for i in range(6):
        H.send_client_message(client, member["h"], secret if i == 0 else f"비슷해요 {i}")

    res = client.get(f"{PREFIX}/clients/{member['id']}/checkins", headers=counselor["h"])

    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert len(items) == 1
    assert set(items[0]) == {"id", "client_id", "started_at", "closed_at", "summary", "mood_direction"}
    assert secret not in res.text


def test_TS12_다른_상담사는_체크인_요약을_볼_수_없다(client):
    _, member = _pair(client, "api-ck-b", enabled=True)
    other = H.register_counselor("api-ck-b-other@test.com", name="이상담")
    H.run_checkin_sweep(now=H.kst_at(10, 0))

    res = client.get(f"{PREFIX}/clients/{member['id']}/checkins", headers=other["h"])
    assert res.status_code == 404, res.text


def test_TS12_상담사_목록에는_담당_내담자만_들어온다(client):
    counselor, member = _pair(client, "api-iso-a")
    other_counselor, other_member = _pair(client, "api-iso-b")

    mine = client.get(f"{PREFIX}/checkin/clients", headers=counselor["h"]).json()["items"]
    theirs = client.get(
        f"{PREFIX}/checkin/clients", headers=other_counselor["h"]
    ).json()["items"]

    assert [i["client_id"] for i in mine] == [member["id"]]
    assert [i["client_id"] for i in theirs] == [other_member["id"]]


def test_미처리_위험_신호_수가_목록에_반영된다(client):
    counselor, member = _pair(client, "api-iso-c")
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    items = client.get(f"{PREFIX}/checkin/clients", headers=counselor["h"]).json()["items"]
    assert items[0]["open_risk_count"] == 1

    signal_id = H.risk_signals(counselor["id"])[0]["id"]
    client.post(f"{PREFIX}/risk-signals/{signal_id}/handled", headers=counselor["h"])

    items = client.get(f"{PREFIX}/checkin/clients", headers=counselor["h"]).json()["items"]
    assert items[0]["open_risk_count"] == 0
