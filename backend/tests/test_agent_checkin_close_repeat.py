"""SDD-202 — 체크인 종료 방식(마무리 신호·30분 무응답) + 반복 입력 대응."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx

from app.models.agent import AgentCheckin, AgentConversation, AgentMessage
from app.services import agent_checkin, agent_llm
from tests import agent_helpers as H


def _pair(client, prefix: str):
    counselor = H.register_counselor(f"{prefix}-c@test.com", name="김상담")
    member = H.register_client(client, f"{prefix}-m@test.com", name="박내담")
    H.link_client(counselor["id"], member["id"])
    H.agree_consent(client, member["h"])
    H.set_checkin_enabled(counselor["id"], member["id"], True)
    return counselor, member


def _talk(client, member, text):
    return H.send_client_message(client, member["h"], text)["agent_message"]


def _shift_checkin_messages(member_id: str, minutes: int) -> None:
    """체크인·메시지 시각을 과거로 민다(무응답 경과 시나리오)."""
    conn = H.db()
    try:
        delta = timedelta(minutes=minutes)
        for row in conn.query(AgentCheckin).filter(AgentCheckin.client_id == H._uuid(member_id)).all():
            row.started_at = row.started_at - delta
        conv = conn.query(AgentConversation).filter(
            AgentConversation.user_id == H._uuid(member_id), AgentConversation.channel == "client"
        ).first()
        for row in conn.query(AgentMessage).filter(AgentMessage.conversation_id == conv.id).all():
            row.created_at = row.created_at - delta
        conn.commit()
    finally:
        conn.close()


def _close_stale() -> int:
    conn = H.db()
    try:
        return agent_checkin.close_stale(conn)
    finally:
        conn.close()


# ── 30분 무응답 종료 ──────────────────────────────────────────────


def test_마지막_응답_후_30분이_지나면_스윕이_체크인을_닫는다(client):
    _, member = _pair(client, "cr-idle1")
    _talk(client, member, "오늘 좀 지쳤어요")
    _shift_checkin_messages(member["id"], 31)

    assert _close_stale() == 1
    row = H.checkins(member["id"])[0]
    assert row["closed_at"] is not None and row["summary"]


def test_29분이면_닫지_않는다(client):
    _, member = _pair(client, "cr-idle2")
    _talk(client, member, "오늘 좀 지쳤어요")
    _shift_checkin_messages(member["id"], 29)

    assert _close_stale() == 0
    assert H.checkins(member["id"])[0]["closed_at"] is None


def test_답장이_없는_아웃리치_체크인은_30분_규칙에서_제외된다(client):
    _, member = _pair(client, "cr-idle3")
    H.run_checkin_sweep(now=H.kst_at(10, 0, day_offset=-1))
    conn = H.db()
    try:  # 아웃리치 체크인을 2시간 전에 시작한 것으로(하루 방치 규칙에는 걸리지 않게) 맞춘다.
        for row in conn.query(AgentCheckin).filter(AgentCheckin.client_id == H._uuid(member["id"])).all():
            row.started_at = datetime.now(timezone.utc) - timedelta(minutes=120)
        conn.commit()
    finally:
        conn.close()

    assert _close_stale() == 0
    assert H.checkins(member["id"])[0]["closed_at"] is None


def test_30분_뒤_돌아오면_이전_체크인을_닫고_새_체크인으로_이어진다(client):
    _, member = _pair(client, "cr-idle4")
    _talk(client, member, "첫 번째 이야기예요")
    _shift_checkin_messages(member["id"], 45)

    _talk(client, member, "다시 왔어요 두 번째 이야기예요")

    rows = H.checkins(member["id"])
    assert len(rows) == 2
    assert rows[0]["closed_at"] is not None
    assert rows[1]["closed_at"] is None and rows[1]["turn_count"] == 1


# ── 마무리 턴 LLM 실패(스트림) ────────────────────────────────────


def test_마무리_턴에_LLM이_실패하면_체크인은_열린_채_오류로_끝난다(client, monkeypatch):
    _, member = _pair(client, "cr-fail")
    _talk(client, member, "오늘 좀 지쳤어요")

    monkeypatch.setattr(httpx, "stream", lambda *a, **k: (_ for _ in ()).throw(httpx.ReadTimeout("slow")))
    monkeypatch.setattr(agent_llm, "is_enabled", lambda: True)
    res = client.post("/api/v1/agent/messages/stream", json={"content": "오늘은 여기까지 할게요"}, headers=member["h"])

    assert '"error": "llm_unavailable"' in res.text
    row = H.checkins(member["id"])[0]
    assert row["closed_at"] is None and row["turn_count"] == 1


# ── 반복 입력 ─────────────────────────────────────────────────────

A = "하루를 마치는 시간이 되었어. 오늘 하루를 되돌아보니 참 허무하다."
B = "하루를 마무리하는 시간이네. 오늘 하루를 되돌아보니 참 허무하다"


def _hist(*texts):
    return [{"sender": "user" if i % 2 == 0 else "agent", "content": t} for i, t in enumerate(texts)]


def test_반복_판정():
    assert agent_llm.is_repeated_message(_hist(A, "그러셨군요"), B)  # 스크린샷 사례(유사)
    assert agent_llm.is_repeated_message(_hist(A, "응답", A), A)  # 동일(저장된 현재 입력 포함)
    assert agent_llm.is_repeated_message(_hist(A, "응답", B), B)  # 이미 저장된 현재 입력은 제외하고 비교
    assert not agent_llm.is_repeated_message(_hist(A), "내일은 쉬는 날이라 좋아요 정말로")  # 다른 말
    assert not agent_llm.is_repeated_message(_hist("응", "네"), "응")  # 짧은 말
    assert not agent_llm.is_repeated_message([], B)  # 첫 발화
    assert not agent_llm.is_repeated_message(_hist("안녕하세요 반가워요", "안녕하세요"), "오늘 하루도 고생했어요")


def test_반복이면_시스템_맥락에_반복_지시가_들어가고_예시_문장은_없다():
    repeated = agent_llm.build_chat_request("ctx", _hist(A, "그러셨군요"), B)
    normal = agent_llm.build_chat_request("ctx", _hist(A, "그러셨군요"), "내일은 쉬는 날이라 좋아요 정말로")

    assert agent_llm.REPEAT_TASK in repeated.system
    assert agent_llm.REPEAT_TASK not in normal.system
    # 예시 문장(따옴표 안 대사)을 주지 않는다 — 모델이 직접 표현을 만든다.
    assert "\"" not in agent_llm.REPEAT_TASK and "“" not in agent_llm.REPEAT_TASK
    assert "잘못 입력하신" not in agent_llm.REPEAT_TASK
