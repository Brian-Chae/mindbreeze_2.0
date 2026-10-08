"""SDD-191 — 안부 대화 진행·마무리·가드 QA.

verify.md 시나리오: TS4(체크인 대화·마무리), TS5(가드), TS16(LLM 폴백),
Edge(체크인 도중 끄기 · 내담자 일시중지).
"""

from unittest.mock import patch

from app.services import agent_checkin, agent_guard
from tests import agent_helpers as H


def _pair(client, prefix: str, *, enabled: bool = True):
    counselor = H.register_counselor(f"{prefix}-c@test.com", name="김상담")
    member = H.register_client(client, f"{prefix}-m@test.com", name="박내담")
    H.link_client(counselor["id"], member["id"])
    H.agree_consent(client, member["h"])
    if enabled:
        H.set_checkin_enabled(counselor["id"], member["id"], True)
    return counselor, member


def _talk(client, member: dict, text: str) -> dict:
    return H.send_client_message(client, member["h"], text)["agent_message"]


# ── TS4: 체크인 대화 ──────────────────────────────────────────────


def test_TS4_여섯턴_진행하면_마무리_메시지로_닫힌다(client):
    counselor, member = _pair(client, "cv-ts4a")
    H.run_checkin_sweep(now=H.kst_at(10, 0))

    replies = [_talk(client, member, f"요즘은 그냥 그래요 {i}") for i in range(6)]

    # 1~5턴은 안부 대화, 6턴에서 마무리.
    assert [r["kind"] for r in replies[:5]] == [agent_checkin.KIND_CHECKIN] * 5
    assert replies[5]["kind"] == agent_checkin.KIND_CHECKIN_CLOSING
    assert replies[5]["content"] == agent_checkin.CLOSING_TEMPLATE
    assert "상담사" in replies[5]["content"]

    rows = H.checkins(member["id"])
    assert len(rows) == 1
    assert rows[0]["closed_at"] is not None
    assert rows[0]["summary"]
    assert rows[0]["mood_direction"] in ("better", "same", "watch")
    assert rows[0]["counselor_id"] == counselor["id"]


def test_TS4_마무리_후_새_메시지는_새_체크인으로_처리된다(client):
    _, member = _pair(client, "cv-ts4b")
    H.run_checkin_sweep(now=H.kst_at(10, 0))
    for i in range(6):
        _talk(client, member, f"그냥 지냈어요 {i}")
    assert H.checkins(member["id"])[0]["closed_at"] is not None

    _talk(client, member, "다시 이야기하고 싶어요")

    rows = H.checkins(member["id"])
    assert len(rows) == 2
    assert rows[1]["closed_at"] is None
    assert rows[1]["turn_count"] == 1


def test_TS4_안부가_꺼진_내담자는_체크인으로_묶이지_않는다(client):
    _, member = _pair(client, "cv-ts4c", enabled=False)

    reply = _talk(client, member, "요즘 어떻게 지내는지 적어볼게요")

    assert H.checkins(member["id"]) == []
    assert reply["kind"] != agent_checkin.KIND_CHECKIN


def test_TS4_요약에는_대화_원문이_그대로_담기지_않는다(client):
    _, member = _pair(client, "cv-ts4d")
    H.run_checkin_sweep(now=H.kst_at(10, 0))
    secret = "지난주에 사촌 결혼식에서 크게 다퉜어요"
    _talk(client, member, secret)
    for i in range(5):
        _talk(client, member, f"그 뒤로도 계속 생각이 나요 {i}")

    summary = H.checkins(member["id"])[0]["summary"]
    assert secret not in summary


# ── TS5: 가드 ─────────────────────────────────────────────────────

BAD_LLM_OUTPUT = (
    "약을 드세요. 우울증 같아요. 항상 곁에 있을게요. 불안 점수는 80점입니다. "
    "그 마음이 가장 크게 느껴지는 순간은 언제인가요?"
)


def test_TS5_금지_표현은_저장_전에_제거된다(client):
    _, member = _pair(client, "cv-ts5a")
    H.run_checkin_sweep(now=H.kst_at(10, 0))

    with patch("app.services.agent_llm._invoke", return_value=BAD_LLM_OUTPUT):
        reply = _talk(client, member, "요즘 많이 힘들어요")

    content = reply["content"]
    for token in ("약을 드세요", "우울증", "항상 곁에", "80점", "점수"):
        assert token not in content, token
    # 안전한 열린 질문 문장은 남는다.
    assert "언제인가요" in content


def test_TS5_금지_표현만_있으면_템플릿_폴백으로_대체된다(client):
    _, member = _pair(client, "cv-ts5b")
    H.run_checkin_sweep(now=H.kst_at(10, 0))

    with patch(
        "app.services.agent_llm._invoke",
        return_value="약을 드세요. 우울증 같아요. 불안 점수는 80점입니다.",
    ):
        reply = _talk(client, member, "요즘 많이 힘들어요")

    assert reply["content"] in agent_checkin.REPLY_FALLBACKS


def test_TS5_가드_단위_판정(client):
    for sentence in (
        "약을 드세요.",
        "우울증 같아요.",
        "항상 곁에 있을게요.",
        "불안 점수는 80점입니다.",
        "운동을 해 보세요.",
        "병원에 가 보세요.",
        "제가 해결해 드릴게요.",
    ):
        assert agent_guard.is_blocked(sentence), sentence
    # 대화를 여는 표현은 막지 않는다 — 과차단 회귀 방지.
    for sentence in (
        "편하게 적어 주셔도 괜찮아요.",
        "한두 줄만 들려주실 수 있을까요?",
        "오늘 하루는 어떤 마음으로 보내고 계신가요?",
    ):
        assert not agent_guard.is_blocked(sentence), sentence


# ── TS16: LLM 폴백 ────────────────────────────────────────────────


def test_TS16_LLM_키가_없으면_템플릿으로_대화가_완결된다(client):
    _, member = _pair(client, "cv-ts16a")
    H.run_checkin_sweep(now=H.kst_at(10, 0))

    with patch("app.services.agent_llm.is_enabled", return_value=False):
        replies = [_talk(client, member, f"요즘 잠을 잘 못 자요 {i}") for i in range(6)]

    assert all(r["content"] for r in replies)
    assert replies[0]["content"] in agent_checkin.REPLY_FALLBACKS
    row = H.checkins(member["id"])[0]
    assert row["closed_at"] is not None
    assert row["summary"]


def test_TS16_LLM_예외가_나도_템플릿으로_완결된다(client):
    _, member = _pair(client, "cv-ts16b")
    H.run_checkin_sweep(now=H.kst_at(10, 0))

    with patch("app.services.agent_llm.is_enabled", return_value=True), patch(
        "app.services.agent_llm._invoke", side_effect=RuntimeError("provider down")
    ):
        replies = [_talk(client, member, f"요즘 많이 지쳤어요 {i}") for i in range(6)]

    assert replies[0]["content"] in agent_checkin.REPLY_FALLBACKS
    row = H.checkins(member["id"])[0]
    assert row["closed_at"] is not None
    assert row["summary"]
    # 키워드 폴백으로도 변화 방향이 정해진다.
    assert row["mood_direction"] == "watch"


def test_TS16_변화_방향_키워드_폴백(client):
    _, member = _pair(client, "cv-ts16c")
    H.run_checkin_sweep(now=H.kst_at(10, 0))

    with patch("app.services.agent_llm.is_enabled", return_value=False):
        for i in range(6):
            _talk(client, member, f"요즘은 많이 나아졌고 편해졌어요 {i}")

    assert H.checkins(member["id"])[0]["mood_direction"] == "better"


# ── Edge: 체크인 도중 상태 변경 ───────────────────────────────────


def test_Edge_체크인_도중_상담사가_끄면_열린_체크인은_마무리된다(client):
    counselor, member = _pair(client, "cv-edge-off")
    H.run_checkin_sweep(now=H.kst_at(10, 0))
    _talk(client, member, "한 턴 이야기했어요")

    H.set_checkin_enabled(counselor["id"], member["id"], False)

    # 열린 체크인은 마무리까지 간다.
    replies = [_talk(client, member, f"계속 이야기해요 {i}") for i in range(5)]
    assert replies[-1]["kind"] == agent_checkin.KIND_CHECKIN_CLOSING
    assert H.checkins(member["id"])[0]["closed_at"] is not None

    # 신규 아웃리치는 멈춘다.
    H.run_checkin_sweep(now=H.kst_at(11, 0))
    assert len(H.checkins(member["id"])) == 1


def test_Edge_내담자가_일시중지해도_대화는_계속_가능하다(client):
    _, member = _pair(client, "cv-edge-pause")
    H.set_checkin_paused(member["id"], True)

    # 아웃리치는 멈춘다.
    H.run_checkin_sweep(now=H.kst_at(10, 0))
    assert H.messages_of(member["id"], kind=agent_checkin.KIND_CHECKIN) == []

    # 내담자가 먼저 말을 걸면 응답한다.
    reply = _talk(client, member, "그래도 이야기하고 싶어요")
    assert reply["content"]


def test_Edge_턴_상한을_넘기면_스윕이_방치된_체크인을_닫는다(client):
    _, member = _pair(client, "cv-edge-stale")
    H.run_checkin_sweep(now=H.kst_at(10, 0))
    _talk(client, member, "한 턴만 이야기했어요")
    # 하루 넘게 방치된 상태로 만든다.
    conn = H.db()
    try:
        from datetime import datetime, timedelta, timezone

        from app.models.agent import AgentCheckin

        row = (
            conn.query(AgentCheckin)
            .filter(AgentCheckin.client_id == H._uuid(member["id"]))
            .first()
        )
        row.started_at = datetime.now(timezone.utc) - timedelta(days=2)
        conn.commit()
    finally:
        conn.close()

    conn = H.db()
    try:
        closed = agent_checkin.close_stale(conn)
    finally:
        conn.close()

    assert closed == 1
    assert H.checkins(member["id"])[0]["closed_at"] is not None
