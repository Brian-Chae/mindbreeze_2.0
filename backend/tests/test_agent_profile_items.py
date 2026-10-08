"""SDD-191 — 상담사 전용 프로파일 QA.

verify.md 시나리오: TS6(추출·근거·확정/수정/기각·내담자 비노출), TS12(상담사 간 격리),
TS16(키워드 폴백).
"""

from unittest.mock import patch

from app.services import agent_profile
from tests import agent_helpers as H

PROFILE_TEXT = "요즘 잠을 못 자고 직장 상사 때문에 힘들어요"


def _pair(client, prefix: str):
    counselor = H.register_counselor(f"{prefix}-c@test.com", name="김상담")
    member = H.register_client(client, f"{prefix}-m@test.com", name="박내담")
    H.link_client(counselor["id"], member["id"])
    H.agree_consent(client, member["h"])
    H.set_checkin_enabled(counselor["id"], member["id"], True)
    return counselor, member


def _run_checkin(client, member: dict, first_text: str = PROFILE_TEXT) -> None:
    """체크인 1건을 마무리까지 진행해 프로파일 추출을 일으킨다(LLM 미사용 폴백)."""
    H.run_checkin_sweep(now=H.kst_at(10, 0))
    with patch("app.services.agent_llm.is_enabled", return_value=False):
        H.send_client_message(client, member["h"], first_text)
        for i in range(5):
            H.send_client_message(client, member["h"], f"그 뒤로도 비슷해요 {i}")


# ── TS6: 추출 ─────────────────────────────────────────────────────


def test_TS6_수면과_스트레스_항목이_AI_추정으로_저장된다(client):
    counselor, member = _pair(client, "pf-ts6a")

    _run_checkin(client, member)

    items = H.profile_items(counselor["id"], member["id"])
    assert items, items
    categories = {item["category"] for item in items}
    assert "sleep" in categories
    assert {"stress", "people_events"} & categories
    assert all(item["status"] == agent_profile.STATUS_AI for item in items)


def test_TS6_근거_메시지_id_가_보존된다(client):
    counselor, member = _pair(client, "pf-ts6b")

    _run_checkin(client, member)

    user_message_ids = {
        m["id"] for m in H.messages_of(member["id"]) if m["sender"] == "user"
    }
    items = H.profile_items(counselor["id"], member["id"])
    assert any(item["evidence"] for item in items)
    for item in items:
        for evidence_id in item["evidence"]:
            assert evidence_id in user_message_ids, evidence_id


def test_TS16_키워드_폴백만으로도_항목이_만들어진다():
    candidates = agent_profile.extract_candidates([("mid-1", PROFILE_TEXT)])

    assert candidates
    categories = {c["category"] for c in candidates}
    assert categories & {"sleep", "stress", "people_events"}
    assert all(c["evidence"] == ["mid-1"] for c in candidates)


def test_진단_표현이_섞인_후보는_버려진다():
    candidates = agent_profile.extract_candidates(
        [("mid-1", "불안 점수가 80점이에요. 잠을 못 자요.")]
    )

    assert candidates
    for candidate in candidates:
        assert "80점" not in candidate["text"]


# ── TS6: 상담사 편집 ──────────────────────────────────────────────


def test_TS6_상담사가_항목을_확정한다(client):
    counselor, member = _pair(client, "pf-ts6c")
    _run_checkin(client, member)
    item_id = H.profile_items(counselor["id"], member["id"])[0]["id"]

    res = client.patch(
        f"/api/v1/agent/counselor/profile-items/{item_id}",
        json={"status": "confirmed"},
        headers=counselor["h"],
    )

    assert res.status_code == 200, res.text
    assert res.json()["status"] == agent_profile.STATUS_CONFIRMED


def test_TS6_상담사가_문구를_수정하면_확정_상태가_된다(client):
    counselor, member = _pair(client, "pf-ts6d")
    _run_checkin(client, member)
    item_id = H.profile_items(counselor["id"], member["id"])[0]["id"]

    res = client.patch(
        f"/api/v1/agent/counselor/profile-items/{item_id}",
        json={"text": "새벽에 자주 깬다고 이야기함"},
        headers=counselor["h"],
    )

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["text"] == "새벽에 자주 깬다고 이야기함"
    assert body["status"] == agent_profile.STATUS_CONFIRMED


def test_TS6_기각한_항목은_목록에서_빠진다(client):
    counselor, member = _pair(client, "pf-ts6e")
    _run_checkin(client, member)
    items = H.profile_items(counselor["id"], member["id"])
    before = len(
        client.get(
            f"/api/v1/agent/counselor/clients/{member['id']}/profile", headers=counselor["h"]
        ).json()["items"]
    )

    res = client.patch(
        f"/api/v1/agent/counselor/profile-items/{items[0]['id']}",
        json={"status": "dismissed"},
        headers=counselor["h"],
    )
    assert res.status_code == 200, res.text

    after = client.get(
        f"/api/v1/agent/counselor/clients/{member['id']}/profile", headers=counselor["h"]
    ).json()["items"]
    assert len(after) == before - 1
    assert items[0]["id"] not in {item["id"] for item in after}


def test_TS6_프로파일_응답에_근거_원문이_담기지_않는다(client):
    counselor, member = _pair(client, "pf-ts6f")
    _run_checkin(client, member)

    res = client.get(
        f"/api/v1/agent/counselor/clients/{member['id']}/profile", headers=counselor["h"]
    )

    assert res.status_code == 200, res.text
    for item in res.json()["items"]:
        assert set(item) == {"id", "category", "text", "status", "evidence_count", "updated_at"}
        assert item["evidence_count"] >= 1


# ── TS6: 내담자 비노출 ────────────────────────────────────────────


def test_TS6_내담자_토큰으로_프로파일_API_에_접근할_수_없다(client):
    _, member = _pair(client, "pf-ts6g")
    _run_checkin(client, member)

    res = client.get(
        f"/api/v1/agent/counselor/clients/{member['id']}/profile", headers=member["h"]
    )
    assert res.status_code == 403, res.text


def test_TS6_내담자_API_응답과_메시지에_프로파일_필드가_없다(client):
    counselor, member = _pair(client, "pf-ts6h")
    _run_checkin(client, member)
    assert H.profile_items(counselor["id"], member["id"])

    for path in ("/api/v1/agent/messages", "/api/v1/agent/checkin-prefs"):
        res = client.get(path, headers=member["h"])
        assert res.status_code == 200, res.text
        for token in ("profile", "ai_estimate", "evidence", "mood_direction"):
            assert token not in res.text, f"{path}: {token}"


# ── TS12: 상담사 간 격리 ─────────────────────────────────────────


def test_TS12_다른_상담사는_프로파일을_조회할_수_없다(client):
    _, member = _pair(client, "pf-ts12a")
    other = H.register_counselor("pf-ts12a-other@test.com", name="이상담")
    _run_checkin(client, member)

    res = client.get(
        f"/api/v1/agent/counselor/clients/{member['id']}/profile", headers=other["h"]
    )
    assert res.status_code == 404, res.text


def test_TS12_다른_상담사는_프로파일_항목을_수정할_수_없다(client):
    counselor, member = _pair(client, "pf-ts12b")
    other = H.register_counselor("pf-ts12b-other@test.com", name="이상담")
    _run_checkin(client, member)
    item_id = H.profile_items(counselor["id"], member["id"])[0]["id"]

    res = client.patch(
        f"/api/v1/agent/counselor/profile-items/{item_id}",
        json={"status": "confirmed"},
        headers=other["h"],
    )
    assert res.status_code == 404, res.text


def test_TS12_상담사별로_프로파일이_분리_저장된다(client):
    first, member = _pair(client, "pf-ts12c")
    second = H.register_counselor("pf-ts12c-c2@test.com", name="이상담")
    H.link_client(second["id"], member["id"])
    _run_checkin(client, member)

    # 체크인을 유발한 상담사에게만 항목이 생긴다.
    assert H.profile_items(first["id"], member["id"])
    assert H.profile_items(second["id"], member["id"]) == []
    res = client.get(
        f"/api/v1/agent/counselor/clients/{member['id']}/profile", headers=second["h"]
    )
    assert res.status_code == 200, res.text
    assert res.json()["items"] == []
