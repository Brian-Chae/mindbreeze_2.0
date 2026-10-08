"""SDD-190 — 디바이스 토큰 API QA.

verify.md 시나리오: TS1(등록·upsert·소유자 이전·platform 422), TS2(해지·타인 토큰 404·401)
+ Edge(같은 사용자 다기기, 동일 토큰 다계정) + Security Review(소유자 검증).
"""

from tests import agent_helpers as H

BASE = "/api/v1/devices"


def _rows(token: str) -> list:
    """토큰으로 device_tokens 행 직접 조회 — upsert 로 행이 늘지 않는지 확인용."""
    from app.models.device_token import DeviceToken

    conn = H.db()
    try:
        return (
            conn.query(DeviceToken)
            .filter(DeviceToken.token == token)
            .all()
        )
    finally:
        conn.close()


# ── TS1: 등록 ────────────────────────────────────────────────


def test_TS1_토큰을_등록하고_재등록은_upsert_된다(client):
    user = H.register_counselor("dev-ts1-c@test.com")
    token = "fcm-token-ts1"

    res = client.post(
        BASE,
        json={"token": token, "platform": "android", "app_version": "1.0.0", "device_label": "픽셀7"},
        headers=user["h"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["token"] == token
    assert body["platform"] == "android"
    first_id = body["id"]

    rows = _rows(token)
    assert len(rows) == 1
    first_seen = rows[0].last_seen_at

    # 같은 토큰 재등록 → 행 1개 유지, id 동일, last_seen_at 갱신
    res = client.post(
        BASE,
        json={"token": token, "platform": "android", "app_version": "1.1.0"},
        headers=user["h"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["id"] == first_id

    rows = _rows(token)
    assert len(rows) == 1
    assert rows[0].app_version == "1.1.0"
    assert rows[0].last_seen_at >= first_seen


def test_TS1_잘못된_platform_은_422(client):
    user = H.register_counselor("dev-ts1b-c@test.com")

    res = client.post(
        BASE, json={"token": "fcm-token-ts1b", "platform": "windows"}, headers=user["h"]
    )
    assert res.status_code == 422, res.text


def test_TS1_동일_토큰을_다른_사용자가_등록하면_소유자가_이전된다(client):
    owner = H.register_counselor("dev-ts1c-a@test.com")
    new_owner = H.register_counselor("dev-ts1c-b@test.com")
    token = "fcm-token-ts1c"

    assert client.post(BASE, json={"token": token, "platform": "ios"}, headers=owner["h"]).status_code == 200
    # 기기 양도·계정 전환 — 행은 1개, user_id 만 바뀐다
    assert client.post(BASE, json={"token": token, "platform": "ios"}, headers=new_owner["h"]).status_code == 200

    rows = _rows(token)
    assert len(rows) == 1
    assert str(rows[0].user_id) == new_owner["id"]
    assert rows[0].revoked_at is None

    # 이전 소유자는 더 이상 이 토큰을 해지할 수 없다
    assert client.delete(f"{BASE}/{token}", headers=owner["h"]).status_code == 404


def test_Edge_같은_사용자_다기기는_각각_등록된다(client):
    user = H.register_counselor("dev-multi-c@test.com")
    from app.services import device_service

    for idx, platform in enumerate(["android", "ios"]):
        res = client.post(
            BASE,
            json={"token": f"fcm-token-multi-{idx}", "platform": platform},
            headers=user["h"],
        )
        assert res.status_code == 200, res.text

    conn = H.db()
    try:
        active = device_service.list_active_tokens(conn, user["id"])
        assert sorted(row.platform for row in active) == ["android", "ios"]
    finally:
        conn.close()


# ── TS2: 해지 ────────────────────────────────────────────────


def test_TS2_본인_토큰_해지는_소프트_해지로_발송_대상에서_빠진다(client):
    user = H.register_counselor("dev-ts2-c@test.com")
    from app.services import device_service

    token = "fcm-token-ts2"
    assert client.post(BASE, json={"token": token, "platform": "android"}, headers=user["h"]).status_code == 200

    res = client.delete(f"{BASE}/{token}", headers=user["h"])
    assert res.status_code == 204, res.text

    rows = _rows(token)
    assert len(rows) == 1  # 행은 남는다
    assert rows[0].revoked_at is not None

    conn = H.db()
    try:
        assert device_service.list_active_tokens(conn, user["id"]) == []
    finally:
        conn.close()

    # 재등록하면 해지가 풀린다
    assert client.post(BASE, json={"token": token, "platform": "android"}, headers=user["h"]).status_code == 200
    assert _rows(token)[0].revoked_at is None


def test_TS2_타인_토큰_해지는_404_비로그인은_401(client):
    owner = H.register_counselor("dev-ts2b-a@test.com")
    other = H.register_counselor("dev-ts2b-b@test.com")
    token = "fcm-token-ts2b"

    assert client.post(BASE, json={"token": token, "platform": "ios"}, headers=owner["h"]).status_code == 200

    assert client.delete(f"{BASE}/{token}", headers=other["h"]).status_code == 404
    assert client.delete(f"{BASE}/{token}").status_code == 401
    assert client.post(BASE, json={"token": "x", "platform": "ios"}).status_code == 401

    # 미등록 토큰도 404
    assert client.delete(f"{BASE}/no-such-token", headers=owner["h"]).status_code == 404
