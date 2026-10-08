"""SDD-191 — 브리핑 연동 QA.

verify.md 시나리오: TS14(안부 요약 · 미처리 위험 신호 섹션, 처리 후 제외,
excerpt 는 상담사 채널에만), Security(프롬프트에 excerpt 미포함).
"""

from unittest.mock import patch

from app.services import agent_policy
from tests import agent_helpers as H

RISK_TEXT_HIGH = "요즘 죽고 싶다는 생각이 계속 들어요."


def _setup(client, prefix: str, *, with_session: bool = True):
    """상담사 + 담당 내담자 + (선택) 오늘 세션 1건. 안부는 켜 둔다."""
    counselor = H.register_counselor(f"{prefix}-c@test.com", name="김상담")
    member = H.register_client(client, f"{prefix}-m@test.com", name="박내담")
    H.link_client(counselor["id"], member["id"])
    H.agree_consent(client, member["h"])
    H.set_checkin_enabled(counselor["id"], member["id"], True)
    if with_session:
        session = H.create_session(client, counselor["h"], [member["id"]])
        H.set_scheduled_at(session["id"], H.kst_at(14, 0))
    return counselor, member


def _finish_checkin(client, member: dict) -> None:
    H.run_checkin_sweep(now=H.kst_at(10, 0))
    with patch("app.services.agent_llm.is_enabled", return_value=False):
        for i in range(6):
            H.send_client_message(client, member["h"], f"요즘 잠을 잘 못 자요 {i}")


# ── TS14: 안부 요약 섹션 ─────────────────────────────────────────


def test_TS14_아침_브리핑에_안부_요약과_변화_방향이_들어간다(client):
    counselor, member = _setup(client, "bf-ts14a")
    _finish_checkin(client, member)

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    content = H.counselor_messages(counselor["id"], kind="briefing_morning")[0]["content"]
    assert "세션 사이 안부 요약 1건" in content
    assert "박내담" in content
    assert "변화 방향:" in content
    summary = H.checkins(member["id"])[0]["summary"]
    assert summary in content


def test_TS14_저녁_브리핑에도_안부_요약이_들어간다(client):
    counselor, member = _setup(client, "bf-ts14b")
    _finish_checkin(client, member)

    H.run_briefing_sweep(now=H.kst_at(21, 0))

    content = H.counselor_messages(counselor["id"], kind="briefing_evening")[0]["content"]
    assert "세션 사이 안부 요약 1건" in content


def test_TS14_안부_요약이_없으면_섹션이_없다(client):
    counselor, _ = _setup(client, "bf-ts14c")

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    content = H.counselor_messages(counselor["id"], kind="briefing_morning")[0]["content"]
    assert "세션 사이 안부 요약" not in content


# ── TS14: 미처리 위험 신호 섹션 ──────────────────────────────────


def test_TS14_아침_브리핑에_미처리_위험_신호가_들어간다(client):
    counselor, member = _setup(client, "bf-risk-a")
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    content = H.counselor_messages(counselor["id"], kind="briefing_morning")[0]["content"]
    assert "확인이 필요한 알림 1건" in content
    assert "박내담" in content
    assert "즉시 확인" in content
    assert "죽고 싶다" in content
    assert "알림이 간 사실을 알리지 않았어요" in content


def test_TS14_처리_완료한_신호는_브리핑에서_빠진다(client):
    counselor, member = _setup(client, "bf-risk-b")
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)
    signal_id = H.risk_signals(counselor["id"])[0]["id"]
    res = client.post(
        f"/api/v1/agent/counselor/risk-signals/{signal_id}/handled", headers=counselor["h"]
    )
    assert res.status_code == 200, res.text

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    content = H.counselor_messages(counselor["id"], kind="briefing_morning")[0]["content"]
    assert "확인이 필요한 알림" not in content


def test_TS14_다른_상담사의_신호는_브리핑에_들어가지_않는다(client):
    _, member = _setup(client, "bf-risk-c")
    other = H.register_counselor("bf-risk-c-other@test.com", name="이상담")
    other_member = H.register_client(client, "bf-risk-c-om@test.com", name="최내담")
    H.link_client(other["id"], other_member["id"])
    other_session = H.create_session(client, other["h"], [other_member["id"]])
    H.set_scheduled_at(other_session["id"], H.kst_at(15, 0))
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    content = H.counselor_messages(other["id"], kind="briefing_morning")[0]["content"]
    assert "확인이 필요한 알림" not in content
    assert "박내담" not in content


def test_TS14_일정이_없어도_위험_신호가_있으면_브리핑을_보낸다(client):
    counselor, member = _setup(client, "bf-risk-d", with_session=False)
    H.set_counselor_settings(counselor["id"], skip_no_session_days=True)
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    briefings = H.counselor_messages(counselor["id"], kind="briefing_morning")
    assert len(briefings) == 1, briefings
    assert "확인이 필요한 알림 1건" in briefings[0]["content"]


# ── Security: excerpt 는 상담사 채널에만 ────────────────────────


def test_Security_브리핑_프롬프트에는_excerpt_와_요약_본문이_들어가지_않는다(client):
    counselor, member = _setup(client, "bf-sec-a")
    _finish_checkin(client, member)
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    conn = H.db()
    try:
        context = agent_policy.counselor_context(counselor["id"], conn)
        text = agent_policy.counselor_context_to_text(context)
    finally:
        conn.close()

    assert context["risk_signals"] and context["checkin_summaries"]
    assert "확인이 필요한 알림 1건" in text
    assert "죽고" not in text
    assert H.checkins(member["id"])[0]["summary"] not in text


def test_Security_내담자_채널에는_브리핑과_위험_정보가_없다(client):
    _, member = _setup(client, "bf-sec-b")
    _finish_checkin(client, member)
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    kinds = {m["kind"] for m in H.messages_of(member["id"])}
    assert not kinds & {"briefing_morning", "briefing_evening", "risk_alert"}
    serialized = str(H.messages_of(member["id"]))
    for token in ("확인이 필요한 알림", "변화 방향", "즉시 확인"):
        assert token not in serialized, token
