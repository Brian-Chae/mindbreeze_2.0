"""SDD-189 — 상담사 간 정보 격리 QA (verify.md TS6 · Security Review).

상담사 A 의 브리핑·대화·relay 목록에 상담사 B 의 내담자·세션·이벤트가 나타나면 안 된다.
고유 문자열(내담자 이름·세션 제목·요약 문장)로 유출 여부를 직접 확인한다.
"""

from tests import agent_helpers as H

BASE = "/api/v1/agent/counselor"

# B 쪽에만 존재하는 고유 문자열 — A 의 어떤 응답에도 나타나면 안 된다.
B_CLIENT_NAME = "비상담사내담자"
B_SESSION_TITLE = "비상담사전용세션제목"
B_SUMMARY = "비상담사전용요약문장"
B_FEEDBACK = "비상담사전용피드백원문"


def _two_counselors(client, prefix: str):
    """상담사 A(본인) + 상담사 B(타인)와 각자의 내담자·오늘 세션을 만든다."""
    a = H.register_counselor(f"{prefix}-a@test.com", name="상담사에이")
    b = H.register_counselor(f"{prefix}-b@test.com", name="상담사비")

    a_client = H.register_client(client, f"{prefix}-am@test.com", name="에이내담자")
    b_client = H.register_client(client, f"{prefix}-bm@test.com", name=B_CLIENT_NAME)

    a_session = H.create_session(client, a["h"], [a_client["id"]], title="에이세션")
    H.set_scheduled_at(a_session["id"], H.kst_at(9))

    b_session = H.create_session(
        client, b["h"], [b_client["id"]], minutes_from_now=300, title=B_SESSION_TITLE
    )
    H.set_scheduled_at(b_session["id"], H.kst_at(10))
    H.set_session_status(b_session["id"], "completed")
    H.set_ai_summary(
        b_session["id"], {"headline": B_SUMMARY, "sections": {}, "keywords": []}
    )

    H.link_client(a["id"], a_client["id"])
    H.link_client(b["id"], b_client["id"])

    # B 의 내담자가 B 에게 남긴 피드백
    conn = H.db()
    try:
        from app.services import agent_service

        agent_service.create_relay_event(
            conn,
            kind="feedback",
            source_user_id=b_client["id"],
            target_user_id=b["id"],
            session_id=b_session["id"],
            payload={"choice": "disappointed", "texts": [B_FEEDBACK]},
            commit=True,
        )
    finally:
        conn.close()

    return {
        "a": a, "b": b,
        "a_client": a_client, "b_client": b_client,
        "a_session": a_session, "b_session": b_session,
    }


def _assert_no_leak(text: str, where: str) -> None:
    for token in (B_CLIENT_NAME, B_SESSION_TITLE, B_SUMMARY, B_FEEDBACK, "상담사비"):
        assert token not in text, f"{where} 에 타 상담사 데이터({token})가 유출됐다: {text}"


# ── TS6: 브리핑 격리 ─────────────────────────────────────────────


def test_TS6_아침_브리핑에_타_상담사_내담자_세션이_없다(client):
    env = _two_counselors(client, "ci-ts6a")

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    a_briefing = H.counselor_messages(env["a"]["id"], kind="briefing_morning")
    assert len(a_briefing) == 1
    content = a_briefing[0]["content"]
    assert "에이내담자" in content
    _assert_no_leak(content, "A 의 아침 브리핑")

    # B 는 B 의 브리핑을 받는다(A 내담자는 없다)
    b_briefing = H.counselor_messages(env["b"]["id"], kind="briefing_morning")
    assert len(b_briefing) == 1
    assert B_CLIENT_NAME in b_briefing[0]["content"]
    assert "에이내담자" not in b_briefing[0]["content"]


def test_TS6_저녁_정리에_타_상담사_요약_피드백이_없다(client):
    env = _two_counselors(client, "ci-ts6b")
    H.set_session_status(env["a_session"]["id"], "completed")
    H.set_ai_summary(
        env["a_session"]["id"],
        {"headline": "에이세션요약", "sections": {}, "keywords": []},
    )

    H.run_briefing_sweep(now=H.kst_at(21, 0))

    content = H.counselor_messages(env["a"]["id"], kind="briefing_evening")[0]["content"]
    assert "에이세션요약" in content
    _assert_no_leak(content, "A 의 저녁 정리")


# ── TS6: 대화 격리 ───────────────────────────────────────────────


def test_TS6_오늘_일정_대화에_타_상담사_세션이_없다(client):
    env = _two_counselors(client, "ci-ts6c")

    reply = client.post(
        f"{BASE}/messages", json={"content": "오늘 일정 알려줘"}, headers=env["a"]["h"]
    ).json()["agent_message"]["content"]

    assert "에이내담자" in reply
    _assert_no_leak(reply, "A 의 오늘 일정 응답")


def test_TS6_타_상담사_내담자_이름으로_요약을_캐낼_수_없다(client):
    env = _two_counselors(client, "ci-ts6d")

    reply = client.post(
        f"{BASE}/messages",
        json={"content": f"{B_CLIENT_NAME} 지난 요약"},
        headers=env["a"]["h"],
    ).json()["agent_message"]["content"]

    assert "찾을 수 없어요" in reply
    assert B_SUMMARY not in reply


def test_TS6_담당_링크가_끝난_내담자는_조회되지_않는다(client):
    """ended 링크 + 본인 세션도 없으면 담당 내담자로 보지 않는다."""
    counselor = H.register_counselor("ci-ts6e-c@test.com")
    former = H.register_client(client, "ci-ts6e-m@test.com", name="지난내담자")
    H.link_client(counselor["id"], former["id"], status="ended")

    reply = client.post(
        f"{BASE}/messages", json={"content": "지난내담자 지난 요약"}, headers=counselor["h"]
    ).json()["agent_message"]["content"]
    assert "찾을 수 없어요" in reply


# ── TS6: relay 목록 격리 ─────────────────────────────────────────


def test_TS6_relay_목록에_타_상담사_이벤트가_없다(client):
    env = _two_counselors(client, "ci-ts6f")

    items = client.get(f"{BASE}/relay-events?status=all", headers=env["a"]["h"]).json()["items"]
    assert items == []
    _assert_no_leak(str(items), "A 의 relay 목록")

    b_items = client.get(f"{BASE}/relay-events?status=all", headers=env["b"]["h"]).json()["items"]
    assert len(b_items) == 1
    assert b_items[0]["client_name"] == B_CLIENT_NAME


def test_TS6_정책계층이_타_상담사_세션을_반환하지_않는다(client):
    """counselor_context 가 단일 진입점임을 직접 검증한다."""
    env = _two_counselors(client, "ci-ts6g")

    conn = H.db()
    try:
        from app.services import agent_policy

        context = agent_policy.counselor_context(env["a"]["id"], conn)
        session_ids = {s["session_id"] for s in context["today"]} | {
            s["session_id"] for s in context["tomorrow"]
        }
        assert env["a_session"]["id"] in session_ids
        assert env["b_session"]["id"] not in session_ids
        assert context["relay_events"] == []
        _assert_no_leak(agent_policy.counselor_context_to_text(context), "counselor_context_to_text")
    finally:
        conn.close()
