"""SDD-188 — 정책 계층 · 출력 가드 QA

verify.md 시나리오: TS13(채널 분리 — 상담사 리포트·비공개 메모·타인 리포트 차단),
TS17(진단·점수 금지 가드) + Security Review(프롬프트에 금지 데이터 없음).
"""

from app.services import agent_guard, agent_llm, agent_policy
from tests import agent_helpers as H

COUNSELOR_SECRET = "COUNSELOR_SECRET"
MEMO_SECRET = "MEMO_SECRET"
OTHER_SECRET = "OTHER_SECRET"
PENDING_SECRET = "PENDING_SECRET"
MINE_VISIBLE = "본인에게 발송된 리포트 본문입니다"


def _setup_boundary(client) -> dict:
    """본인/타인/상담사/승인전 리포트와 비공개 메모를 심어 둔 상태를 만든다."""
    counselor = H.register_counselor("agp-host@test.com", name="김상담")
    me = H.register_client(client, "agp-me@test.com", name="박내담")
    other = H.register_client(client, "agp-other@test.com", name="최내담")

    my_session = H.create_session(client, counselor["h"], [me["id"]], minutes_from_now=300,
                                  location_address="대전 유성구 테크노2로 187")
    other_session = H.create_session(client, counselor["h"], [other["id"]], minutes_from_now=320)

    # 본인 승인 완료 client 리포트 — 유일하게 보여야 하는 본문
    H.create_report(
        my_session["id"],
        user_id=me["id"],
        participant_id=H.participant_id_of(my_session, me["id"]),
        status="completed",
        content={"summary": MINE_VISIBLE},
    )
    # 상담사용 리포트(같은 세션) — 보이면 안 된다
    H.create_report(
        my_session["id"],
        user_id=counselor["id"],
        report_type="counselor",
        status="completed",
        content={"summary": COUNSELOR_SECRET},
    )
    # 타인의 client 리포트 — 보이면 안 된다
    H.create_report(
        other_session["id"],
        user_id=other["id"],
        participant_id=H.participant_id_of(other_session, other["id"]),
        status="completed",
        content={"summary": OTHER_SECRET},
    )
    # 본인의 승인 전(pending_review) 리포트 — 보이면 안 된다
    H.create_report(
        other_session["id"],
        user_id=me["id"],
        report_type="client",
        status="pending_review",
        content={"summary": PENDING_SECRET},
    )
    # 상담사 비공개 메모 — 보이면 안 된다
    _set_link_memo(counselor["id"], me["id"], MEMO_SECRET)

    return {"counselor": counselor, "me": me, "other": other, "session": my_session}


def test_TS13_client_context_에는_허용된_본문만_담긴다(client):
    env = _setup_boundary(client)

    conn = H.db()
    try:
        context = agent_policy.client_context(env["me"]["id"], conn)
    finally:
        conn.close()

    serialized = str(context)
    for secret in (COUNSELOR_SECRET, MEMO_SECRET, OTHER_SECRET, PENDING_SECRET):
        assert secret not in serialized, f"{secret} 가 컨텍스트에 노출됨"
    assert MINE_VISIBLE in serialized

    # 본인 승인 완료 리포트 1건만
    assert len(context["reports"]) == 1
    assert context["reports"][0]["summary"] == MINE_VISIBLE


def test_TS13_LLM_프롬프트_문자열에도_금지_데이터가_없다(client):
    env = _setup_boundary(client)

    conn = H.db()
    try:
        context = agent_policy.client_context(env["me"]["id"], conn)
    finally:
        conn.close()

    prompt = agent_llm.build_prompt(
        agent_policy.context_to_text(context),
        user_text="리포트 좀 설명해 주세요",
        task="설명하세요",
    )
    for secret in (COUNSELOR_SECRET, MEMO_SECRET, OTHER_SECRET, PENDING_SECRET):
        assert secret not in prompt, f"{secret} 가 프롬프트에 노출됨"
    assert MINE_VISIBLE in prompt


def test_TS13_사용자_대화_응답에도_금지_데이터가_새지_않는다(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "gemini_api_key", "")
    env = _setup_boundary(client)
    H.agree_consent(client, env["me"]["h"])

    res = client.post(
        "/api/v1/agent/messages",
        json={"content": "리포트에 뭐라고 적혀 있어요?"},
        headers=env["me"]["h"],
    )
    assert res.status_code == 200, res.text
    content = res.json()["agent_message"]["content"]
    for secret in (COUNSELOR_SECRET, MEMO_SECRET, OTHER_SECRET, PENDING_SECRET):
        assert secret not in content


def test_정책계층은_본인_예약_세션만_반환한다(client):
    env = _setup_boundary(client)

    conn = H.db()
    try:
        sessions = agent_policy.upcoming_sessions(env["me"]["id"], conn)
    finally:
        conn.close()

    assert len(sessions) == 1
    assert sessions[0]["session_id"] == env["session"]["id"]
    assert sessions[0]["counselor_name"] == "김상담"


def test_정책계층은_EEG_점수를_컨텍스트에_담지_않는다(client):
    counselor = H.register_counselor("agp-eeg-host@test.com")
    me = H.register_client(client, "agp-eeg-me@test.com")
    session = H.create_session(client, counselor["h"], [me["id"]], minutes_from_now=300)
    H.create_report(
        session["id"],
        user_id=me["id"],
        participant_id=H.participant_id_of(session, me["id"]),
        status="completed",
        content={
            "summary": "편안한 상태가 유지되었습니다",
            "eeg": {"status": "ok", "stress_score": 82, "relaxation_score": 71},
            "data_credibility": "high",
        },
    )

    conn = H.db()
    try:
        context = agent_policy.client_context(me["id"], conn)
    finally:
        conn.close()
    serialized = str(context)
    assert "82" not in serialized
    assert "stress_score" not in serialized


def test_리포트_인용은_최대_2문장이고_빈본문은_인용하지_않는다(client):
    facts = {
        "headline": "첫 문장",
        "summary": "두번째 문장",
        "counselor_comment": "세번째 문장",
        "insights": ["네번째"],
    }
    assert agent_policy.report_quotes(facts) == ["첫 문장", "두번째 문장"]

    empty = {"headline": None, "summary": None, "counselor_comment": None, "insights": []}
    assert agent_policy.report_quotes(empty) == []


# ── TS17: 가드 (진단 · 점수 금지) ───────────────────────────────


def test_TS17_진단과_점수_표현은_제거된다():
    out = agent_guard.sanitize("우울증으로 보입니다. 불안 점수는 82점입니다.")
    assert "우울증" not in out
    assert "82" not in out
    assert out == agent_guard.SAFE_FALLBACK


def test_TS17_금지문장만_골라_제거하고_나머지는_남긴다():
    out = agent_guard.sanitize("오늘 이야기 잘 들었어요. 불안 점수는 70점이에요. 편하게 적어 주세요.")
    assert "오늘 이야기 잘 들었어요." in out
    assert "편하게 적어 주세요." in out
    assert "70점" not in out


def test_TS17_안전한_문장은_그대로_통과():
    text = "이완이 빠르게 돌아왔다고 적혀 있어요. 그때 어떤 느낌이셨어요?"
    assert agent_guard.sanitize(text) == text


def test_TS17_가드_폴백은_호출부가_지정할_수_있다():
    assert agent_guard.sanitize("처방이 필요합니다.", fallback="대체 문구") == "대체 문구"
    assert agent_guard.sanitize("", fallback="대체 문구") == "대체 문구"
    assert agent_guard.sanitize(None, fallback="대체 문구") == "대체 문구"


def test_TS17_금지_판정_단위():
    assert agent_guard.is_blocked("병명이 뭐예요?") is True
    assert agent_guard.is_blocked("약을 먹어야 할까요?") is True
    assert agent_guard.is_blocked("별점 5점 드려요") is True
    assert agent_guard.is_blocked("요즘 잠을 잘 못 자요") is False


# ── 보조 ───────────────────────────────────────────────────────


def _set_link_memo(counselor_id: str, client_id: str, memo: str) -> None:
    from app.models.client_counselor_link import ClientCounselorLink

    conn = H.db()
    try:
        link = ClientCounselorLink(
            client_id=H._uuid(client_id),
            counselor_id=H._uuid(counselor_id),
            status="active",
            memo=memo,
        )
        conn.add(link)
        conn.commit()
    finally:
        conn.close()
