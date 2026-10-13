"""SDD-202 — 상담사 연결 제안 문구 + 채팅 버튼, 에이전트 LLM 타임아웃 60s."""

from __future__ import annotations

from unittest.mock import patch

import httpx

from app.services import agent_guard, agent_llm, agent_risk, agent_service, report_comment_service
from tests import agent_helpers as H

OFFER = "상담사님과 바로 이야기 나눌 수 있게 채팅을 연결해 드릴까요?"


def _pair(client, prefix: str, *, linked: bool = True):
    counselor = H.register_counselor(f"{prefix}-c@test.com", name="김상담")
    member = H.register_client(client, f"{prefix}-m@test.com", name="박내담")
    if linked:
        H.link_client(counselor["id"], member["id"])
    H.agree_consent(client, member["h"])
    return counselor, member


# ── 문구 ──────────────────────────────────────────────────────────


def test_연결_제안_문구는_패턴에_걸리고_피드백_접수_문구는_걸리지_않는다():
    pattern = agent_service._HANDOFF_OFFER
    for text in (
        agent_service.OUT_OF_SCOPE_REPLY,
        agent_guard.SAFE_FALLBACK,
        OFFER,
        *agent_risk.SAFE_REPLIES_HIGH,
        *agent_risk.SAFE_REPLIES_WATCH,
    ):
        assert pattern.search(text), text
    assert not pattern.search("남겨 주신 이야기는 상담사님께 그대로 전해 드릴게요.")
    assert not pattern.search("오늘은 어떤 일이 있었는지 들려주세요.")


def test_위험_안전_응답은_훈계형이_아니고_감지_암시_표현이_없다():
    for text in (*agent_risk.SAFE_REPLIES_HIGH, *agent_risk.SAFE_REPLIES_WATCH):
        assert "이야기 나눠 보시면" not in text
        assert "채팅을 연결해 드릴까요" in text
        for banned in ("감지", "위험", "모니터링", "알림이 갔", "알렸"):
            assert banned not in text


# ── 버튼 부착 ─────────────────────────────────────────────────────


def test_LLM_응답에_연결_제안이_있으면_상담사_채팅_CTA가_붙는다(client):
    _, member = _pair(client, "ho-1")
    with patch("app.services.agent_llm._invoke", return_value=f"많이 지치셨겠어요. {OFFER}"):
        reply = H.send_client_message(client, member["h"], "요즘 계속 의욕이 없어요")["agent_message"]

    ctas = reply["cta"]
    assert [c["action"] for c in ctas] == ["talk_to_counselor"]
    assert ctas[0]["label"] == agent_risk.CTA_LABEL_TALK_TO_COUNSELOR
    assert ctas[0]["payload"]["url"] == f"/app/chat/{ctas[0]['payload']['room_id']}"


def test_연결_제안이_없으면_CTA도_없다(client):
    _, member = _pair(client, "ho-2")
    with patch("app.services.agent_llm._invoke", return_value="그런 하루였군요. 조금 더 들려주세요."):
        reply = H.send_client_message(client, member["h"], "오늘 좀 지쳤어요")["agent_message"]
    assert reply["cta"] == []


def test_담당_상담사가_없으면_제안이_있어도_CTA를_붙이지_않는다(client):
    _, member = _pair(client, "ho-3", linked=False)
    with patch("app.services.agent_llm._invoke", return_value=OFFER):
        reply = H.send_client_message(client, member["h"], "오늘 좀 지쳤어요")["agent_message"]
    assert reply["cta"] == []


def test_범위_밖_질문_고정응답과_가드_대체문구에도_채팅_CTA가_붙는다(client):
    from uuid import UUID

    from app.core.database import SessionLocal

    _, member = _pair(client, "ho-4")
    db = SessionLocal()
    try:
        for text in (agent_service.OUT_OF_SCOPE_REPLY, agent_guard.SAFE_FALLBACK):
            ctas = agent_service.handoff_cta(db, UUID(str(member["id"])), text)
            assert [c["action"] for c in ctas] == ["talk_to_counselor"], text
            assert ctas[0]["payload"]["room_id"]
    finally:
        db.close()


# ── 타임아웃 ──────────────────────────────────────────────────────


def test_에이전트_LLM_타임아웃은_60초이고_리포트_공용값은_그대로(monkeypatch):
    assert agent_llm.AGENT_LLM_TIMEOUT_SEC == 60.0
    assert agent_llm.AGENT_STREAM_READ_TIMEOUT_SEC == 60.0
    assert report_comment_service.GEMINI_TIMEOUT_SECONDS == 15.0

    seen: dict = {}

    class Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": "네"}]}}]}

    def fake_post(*args, **kwargs):
        seen["timeout"] = kwargs.get("timeout")
        return Resp()

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(report_comment_service.settings, "gemini_api_key", "k")
    report_comment_service._call_gemini("p", timeout=agent_llm.AGENT_LLM_TIMEOUT_SEC)
    assert seen["timeout"] == 60.0
    report_comment_service._call_gemini("p")  # 기존 호출부(상담사 코멘트 초안)는 15s 유지
    assert seen["timeout"] == 15.0

    monkeypatch.setattr(agent_llm.settings, "gemini_api_key", "k")
    agent_llm._call_gemini_chat(agent_llm.build_chat_request("ctx", [], "안녕"))
    assert seen["timeout"] == 60.0


# ── 거절 존중 ─────────────────────────────────────────────────────

DECLINE = "일단 지금은 상담사와 이야기 하고 싶지는 않아"


def test_거절_판정():
    pattern = agent_service._HANDOFF_DECLINE
    for text in (DECLINE, "상담사님 말고 그냥 얘기할래", "상담사 연결은 싫어요", "채팅은 안 할래", "상담사는 지금 필요 없어요"):
        assert pattern.search(text), text
    for text in ("상담사님과 이야기하고 싶어요", "오늘 너무 지쳤어요", "연결해 주세요"):
        assert not pattern.search(text), text


def test_거절을_되풀이한_문장에는_CTA가_붙지_않는다(client):
    _, member = _pair(client, "ho-5")
    echo = "지금은 상담사님과 이야기하고 싶지 않으시다는 말씀, 충분히 이해했어요. 더 남겨 주세요."
    with patch("app.services.agent_llm._invoke", return_value=echo):
        reply = H.send_client_message(client, member["h"], "오늘 좀 지쳤어요")["agent_message"]
    assert reply["cta"] == []


def test_거절_이후에는_LLM이_제안_문장을_내도_CTA가_없다(client):
    _, member = _pair(client, "ho-6")
    with patch("app.services.agent_llm._invoke", return_value=OFFER):
        reply = H.send_client_message(client, member["h"], DECLINE)["agent_message"]
    assert reply["cta"] == []


def test_거절_안_했으면_기존대로_제안과_버튼(client):
    _, member = _pair(client, "ho-7")
    with patch("app.services.agent_llm._invoke", return_value=OFFER):
        reply = H.send_client_message(client, member["h"], "오늘 좀 지쳤어요")["agent_message"]
    assert [c["action"] for c in reply["cta"]] == ["talk_to_counselor"]


def test_거절_이후_위험_표현은_신호는_저장하고_응답은_제안_없는_공감(client):
    from app.core.database import SessionLocal
    from app.models.agent import AgentRiskSignal

    _, member = _pair(client, "ho-8")
    H.send_client_message(client, member["h"], DECLINE)
    reply = H.send_client_message(client, member["h"], "계속 이러면 진짜 죽고싶을거 같아")["agent_message"]

    assert reply["content"] == agent_risk.PLAIN_EMPATHY_REPLY
    assert "연결해 드릴까요" not in reply["content"]
    assert reply["cta"] == []
    db = SessionLocal()
    try:
        assert db.query(AgentRiskSignal).count() >= 1  # 상담사 조용한 알림은 유지
    finally:
        db.close()


def test_거절_전_위험_표현은_기존처럼_제안과_버튼(client):
    _, member = _pair(client, "ho-9")
    reply = H.send_client_message(client, member["h"], "계속 이러면 진짜 죽고싶을거 같아")["agent_message"]
    assert "연결해 드릴까요" in reply["content"]
    assert [c["action"] for c in reply["cta"]] == ["talk_to_counselor"]
