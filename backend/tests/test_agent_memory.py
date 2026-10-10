"""SDD-198 — 루시 구조화 장기기억 QA.

verify.md 시나리오: TS1(추출·저장), TS2(키별 갱신), TS3(컨텍스트 인출), TS4(진단·점수 차단).
"""

from unittest.mock import patch
from uuid import UUID

from app.services import agent_memory, agent_policy
from tests import agent_helpers as H

_LLM_RESPONSE = (
    '[{"category":"fact","key":"자녀","value":"이서(딸), 이준(아들)"},'
    '{"category":"relation","key":"배우자","value":"남편과 함께 살고 있음"},'
    '{"category":"emotion_trend","key":"최근 상태","value":"직장에서 힘들어함"}]'
)


def _memory_items(client_id: str) -> list[dict]:
    from app.models.agent import AgentMemoryItem

    conn = H.db()
    try:
        rows = (
            conn.query(AgentMemoryItem)
            .filter(AgentMemoryItem.client_id == UUID(client_id))
            .order_by(AgentMemoryItem.category.asc(), AgentMemoryItem.created_at.asc())
            .all()
        )
        return [
            {
                "category": r.category,
                "key": r.key,
                "value": r.value,
                "evidence": list(r.evidence or []),
            }
            for r in rows
        ]
    finally:
        conn.close()


# ── TS1: 추출·저장 ─────────────────────────────────────────


def test_TS1_LLM_응답에서_구조화_항목을_추출한다():
    with patch("app.services.agent_llm.is_enabled", return_value=True), patch(
        "app.services.agent_llm.generate", return_value=_LLM_RESPONSE
    ):
        candidates = agent_memory.extract_candidates([("mid-1", "딸 이서, 아들 이준이 있어요")])

    assert len(candidates) == 3
    assert {c["key"] for c in candidates} == {"자녀", "배우자", "최근 상태"}
    assert all(c["evidence"] == ["mid-1"] for c in candidates)


def test_TS1_저장과_조회가_된다(client):
    member = H.register_client(client, "mem-ts1@test.com", name="박내담")

    with patch("app.services.agent_llm.is_enabled", return_value=True), patch(
        "app.services.agent_llm.generate", return_value=_LLM_RESPONSE
    ):
        conn = H.db()
        try:
            saved = agent_memory.extract_and_store(
                conn,
                client_id=UUID(member["id"]),
                texts=[("mid-1", "딸 이서, 아들 이준이 있어요")],
                commit=True,
            )
        finally:
            conn.close()

    assert len(saved) == 3
    items = _memory_items(member["id"])
    assert len(items) == 3
    assert {i["key"] for i in items} == {"자녀", "배우자", "최근 상태"}


# ── TS2: 키별 갱신 ─────────────────────────────────────────


def test_TS2_같은_키는_최신_값으로_갱신되고_중복이_없다(client):
    member = H.register_client(client, "mem-ts2@test.com", name="박내담")
    client_id = UUID(member["id"])

    conn = H.db()
    try:
        agent_memory.upsert_items(
            conn,
            client_id=client_id,
            candidates=[{"category": "fact", "key": "자녀", "value": "이서(딸)", "evidence": ["m1"]}],
            commit=True,
        )
        agent_memory.upsert_items(
            conn,
            client_id=client_id,
            candidates=[
                {
                    "category": "fact",
                    "key": "자녀",
                    "value": "이서(딸), 이준(아들)",
                    "evidence": ["m2"],
                }
            ],
            commit=True,
        )
    finally:
        conn.close()

    items = _memory_items(member["id"])
    assert len(items) == 1
    assert items[0]["value"] == "이서(딸), 이준(아들)"
    assert items[0]["evidence"] == ["m1", "m2"]


# ── TS3: 컨텍스트 인출 ─────────────────────────────────────


def test_TS3_client_context_와_직렬화에_구조화_기억이_포함된다(client):
    member = H.register_client(client, "mem-ts3@test.com", name="박내담")
    client_id = UUID(member["id"])

    conn = H.db()
    try:
        agent_memory.upsert_items(
            conn,
            client_id=client_id,
            candidates=[
                {"category": "fact", "key": "자녀", "value": "이서(딸), 이준(아들)", "evidence": []}
            ],
            commit=True,
        )
    finally:
        conn.close()

    conn = H.db()
    try:
        context = agent_policy.client_context(member["id"], conn)
        text = agent_policy.context_to_text(context)
    finally:
        conn.close()

    assert context["structured_memories"]
    assert "■ 기억" in text
    assert "자녀" in text
    assert "이서(딸), 이준(아들)" in text


def test_TS3_기억이_없으면_블록이_생략된다(client):
    member = H.register_client(client, "mem-ts3b@test.com", name="박내담")

    conn = H.db()
    try:
        context = agent_policy.client_context(member["id"], conn)
        text = agent_policy.context_to_text(context)
    finally:
        conn.close()

    assert context["structured_memories"] == []
    assert "■ 기억" not in text


# ── TS4: 진단·점수 차단 ────────────────────────────────────


def test_TS4_점수_표현이_섞인_후보는_버려진다():
    response = '[{"category":"fact","key":"불안","value":"불안 점수가 80점이에요"}]'
    with patch("app.services.agent_llm.is_enabled", return_value=True), patch(
        "app.services.agent_llm.generate", return_value=response
    ):
        candidates = agent_memory.extract_candidates([("mid-1", "불안 점수가 80점이에요")])

    assert candidates == []


def test_TS4_카테고리가_다른_후보는_버려진다():
    response = '[{"category":"diagnosis","key":"병명","value":"우울증"}]'
    with patch("app.services.agent_llm.is_enabled", return_value=True), patch(
        "app.services.agent_llm.generate", return_value=response
    ):
        candidates = agent_memory.extract_candidates([("mid-1", "우울증이에요")])

    assert candidates == []
