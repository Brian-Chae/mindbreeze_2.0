"""SDD-188 — 리포트 승인 → AI 비서 리포트 대화 QA

verify.md 시나리오: TS8(승인 → 링크 메시지), TS9(자동 승인 경로), TS10(제외 대상),
TS11(3지선다 피드백 + 원문 중계), TS16(LLM 폴백) + Edge Cases.
"""

from unittest.mock import patch

import pytest

from app.services import report_service
from tests import agent_helpers as H


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    """기본은 LLM 키 없음 — 템플릿 폴백 경로로 결정적으로 검증한다."""
    from app.config import settings

    monkeypatch.setattr(settings, "gemini_api_key", "")


def _approve(report_id: str, host_id: str) -> dict:
    conn = H.db()
    try:
        return report_service.approve_report(report_id, host_id, conn)
    finally:
        conn.close()


def _setup(client, prefix: str, **session_kwargs) -> dict:
    counselor = H.register_counselor(f"{prefix}-host@test.com", name="김상담")
    member = H.register_client(client, f"{prefix}-mem@test.com", name="박내담")
    session = H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=300, **session_kwargs
    )
    return {"counselor": counselor, "member": member, "session": session}


# ── TS8: 승인 → 링크 메시지 ─────────────────────────────────────


def test_TS8_승인전에는_메시지가_없고_승인시_1건_생성된다(client):
    env = _setup(client, "arc-ts8")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
        content={"summary": "이완이 빠르게 돌아오는 모습이 관찰되었습니다"},
    )

    # 승인 전 — 메시지 없음
    assert H.messages_of(env["member"]["id"]) == []

    _approve(report_id, env["counselor"]["id"])

    msgs = H.messages_of(env["member"]["id"], kind="report_ready")
    assert len(msgs) == 1
    msg = msgs[0]
    assert msg["ref_type"] == "report" and msg["ref_id"] == report_id
    # 리포트 본문 인용 + 열린 질문
    assert "이완이 빠르게 돌아오는 모습이 관찰되었습니다" in msg["content"]
    assert "?" in msg["content"]
    # CTA: 리포트 보기 + 3지선다 피드백
    assert "open_report" in H.cta_ids(msg)
    choices = [c for c in msg["cta"] if c["action"] == "feedback_choice"]
    assert {c["payload"]["choice"] for c in choices} == {"helpful", "neutral", "disappointed"}
    assert _open_report_cta(msg)["payload"]["url"] == f"/app/reports/{report_id}"


def test_TS8_중복_승인은_추가_메시지를_만들지_않는다(client):
    env = _setup(client, "arc-ts8b")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
    )

    _approve(report_id, env["counselor"]["id"])
    _approve(report_id, env["counselor"]["id"])
    _approve(report_id, env["counselor"]["id"])

    assert len(H.messages_of(env["member"]["id"], kind="report_ready")) == 1
    assert len(H.delivery_logs("report_ready")) == 1


def test_EDGE_리포트_재승인_훅_직접_재호출도_멱등(client):
    env = _setup(client, "arc-redo")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
    )
    _approve(report_id, env["counselor"]["id"])

    from app.models.record import Report
    from app.services import agent_report_chat

    conn = H.db()
    try:
        report = conn.get(Report, H._uuid(report_id))
        assert agent_report_chat.on_report_approved(report, conn) is False
    finally:
        conn.close()
    assert len(H.messages_of(env["member"]["id"], kind="report_ready")) == 1


# ── TS9: 자동 승인 경로 ─────────────────────────────────────────


def test_TS9_자동승인_상담사도_동일하게_메시지_1건(client):
    env = _setup(client, "arc-ts9")
    _set_auto_approve(env["counselor"]["id"], True)
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
        content={"summary": "차분한 흐름이 유지되었습니다"},
    )

    # 자동 승인 경로(generate_*_reports)도 결국 approve_report 를 거친다.
    with patch("app.services.report_comment_service.ensure_auto_comment"):
        _approve(report_id, env["counselor"]["id"])

    assert len(H.messages_of(env["member"]["id"], kind="report_ready")) == 1


# ── TS10: 제외 대상 ─────────────────────────────────────────────


def test_TS10_그룹세션_리포트는_메시지를_만들지_않는다(client):
    env = _setup(
        client,
        "arc-ts10a",
        type="meditation",
        participant_mode="group",
        max_participants=10,
    )
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
    )

    result = _approve(report_id, env["counselor"]["id"])
    assert result["status"] == "completed"
    assert H.messages_of(env["member"]["id"]) == []


def test_TS10_게스트_리포트는_오류없이_건너뛴다(client):
    env = _setup(client, "arc-ts10b")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=None,
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
    )

    result = _approve(report_id, env["counselor"]["id"])
    assert result["status"] == "completed"
    assert H.messages_of(env["member"]["id"]) == []


def test_TS10_counselor_타입_리포트는_내담자에게_가지_않는다(client):
    env = _setup(client, "arc-ts10c")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["counselor"]["id"],
        report_type="counselor",
        status="pending_review",
    )

    result = _approve(report_id, env["counselor"]["id"])
    assert result["status"] == "completed"
    assert H.messages_of(env["member"]["id"]) == []
    assert H.messages_of(env["counselor"]["id"]) == []


# ── TS11: 사후 피드백 (D9 / D10) ────────────────────────────────


def test_TS11_부정_피드백_선택과_자유서술이_원문_그대로_중계된다(client):
    env = _setup(client, "arc-ts11")
    H.agree_consent(client, env["member"]["h"])
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
        content={"summary": "오늘의 흐름이 기록되었습니다"},
    )
    _approve(report_id, env["counselor"]["id"])
    msg = H.messages_of(env["member"]["id"], kind="report_ready")[0]

    res = client.post(
        f"/api/v1/agent/messages/{msg['id']}/cta/feedback_disappointed",
        json={},
        headers=env["member"]["h"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["cta"]["done"] is True
    # 열린 질문이 이어진다 (숫자 척도 없음)
    assert body["agent_message"]["kind"] == "feedback_thanks"
    assert "이야기해 주실래요" in body["agent_message"]["content"]

    raw = "상담사 말투가 불편했어요"
    res = client.post("/api/v1/agent/messages", json={"content": raw}, headers=env["member"]["h"])
    assert res.status_code == 200, res.text

    events = H.relay_events("feedback")
    assert len(events) == 1
    event = events[0]
    assert event["payload"]["choice"] == "disappointed"
    # D10: 요약·순화 없이 원문 그대로
    assert event["payload"]["texts"] == [raw]
    assert event["target_user_id"] == env["counselor"]["id"]
    assert event["session_id"] == env["session"]["id"]


def test_TS11_3지선다_재선택은_중복_이벤트를_만들지_않는다(client):
    env = _setup(client, "arc-ts11b")
    H.agree_consent(client, env["member"]["h"])
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
    )
    _approve(report_id, env["counselor"]["id"])
    msg = H.messages_of(env["member"]["id"], kind="report_ready")[0]

    for cta_id in ("feedback_helpful", "feedback_helpful", "feedback_neutral"):
        res = client.post(
            f"/api/v1/agent/messages/{msg['id']}/cta/{cta_id}", json={}, headers=env["member"]["h"]
        )
        assert res.status_code == 200, res.text

    # 한 번 고르면 세 버튼 모두 done — 이벤트는 1건
    assert len(H.relay_events("feedback")) == 1
    updated = H.messages_of(env["member"]["id"], kind="report_ready")[0]
    assert all(c.get("done") for c in updated["cta"] if c["action"] == "feedback_choice")


def test_피드백_CTA_에_자유서술을_함께_보낼_수_있다(client):
    env = _setup(client, "arc-ts11c")
    H.agree_consent(client, env["member"]["h"])
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
    )
    _approve(report_id, env["counselor"]["id"])
    msg = H.messages_of(env["member"]["id"], kind="report_ready")[0]

    client.post(
        f"/api/v1/agent/messages/{msg['id']}/cta/feedback_helpful",
        json={"text": "많이 편해졌어요"},
        headers=env["member"]["h"],
    )
    assert H.relay_events("feedback")[0]["payload"]["texts"] == ["많이 편해졌어요"]


def test_SEC_미동의_상태에서는_피드백_중계가_생기지_않는다(client):
    env = _setup(client, "arc-noconsent")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
    )
    _approve(report_id, env["counselor"]["id"])
    msg = H.messages_of(env["member"]["id"], kind="report_ready")[0]

    res = client.post(
        f"/api/v1/agent/messages/{msg['id']}/cta/feedback_helpful",
        json={},
        headers=env["member"]["h"],
    )
    assert res.status_code == 403
    assert res.json()["detail"] == "agent_consent_required"
    assert H.relay_events("feedback") == []


# ── TS16: LLM 폴백 ──────────────────────────────────────────────


def test_TS16_키_없이도_템플릿으로_메시지가_생성된다(client):
    env = _setup(client, "arc-ts16a")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
        content={"summary": "편안한 호흡이 이어졌습니다"},
    )

    _approve(report_id, env["counselor"]["id"])

    msg = H.messages_of(env["member"]["id"], kind="report_ready")[0]
    from app.services.agent_report_chat import DEFAULT_OPEN_QUESTION

    assert DEFAULT_OPEN_QUESTION in msg["content"]


def test_TS16_Gemini_예외가_나도_승인과_메시지_생성이_정상(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    env = _setup(client, "arc-ts16b")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
        content={"summary": "편안한 호흡이 이어졌습니다"},
    )

    def _boom(prompt: str):
        raise RuntimeError("provider down")

    with patch("app.services.report_comment_service._call_gemini", side_effect=_boom):
        result = _approve(report_id, env["counselor"]["id"])

    assert result["status"] == "completed"
    msgs = H.messages_of(env["member"]["id"], kind="report_ready")
    assert len(msgs) == 1
    from app.services.agent_report_chat import DEFAULT_OPEN_QUESTION

    assert DEFAULT_OPEN_QUESTION in msgs[0]["content"]


def test_TS17_LLM_이_진단_표현을_내면_저장전에_제거된다(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    env = _setup(client, "arc-guard")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
        content={"summary": "편안한 호흡이 이어졌습니다"},
    )

    with patch(
        "app.services.report_comment_service._call_gemini",
        return_value="우울증으로 보입니다. 불안 점수는 82점입니다.",
    ):
        _approve(report_id, env["counselor"]["id"])

    content = H.messages_of(env["member"]["id"], kind="report_ready")[0]["content"]
    assert "우울증" not in content
    assert "82" not in content
    assert "점수" not in content


def test_훅_실패가_승인_트랜잭션을_깨지_않는다(client):
    env = _setup(client, "arc-hookfail")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
    )

    with patch(
        "app.services.agent_service.post_agent_message",
        side_effect=RuntimeError("DB 장애"),
    ):
        result = _approve(report_id, env["counselor"]["id"])

    # 승인은 정상 완료된다
    assert result["status"] == "completed"
    assert H.messages_of(env["member"]["id"]) == []


# ── Edge Cases ─────────────────────────────────────────────────


def test_EDGE_본문이_비어도_링크_메시지는_생성되고_인용은_없다(client):
    env = _setup(client, "arc-empty")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
        content={"status": "no_record"},
    )

    _approve(report_id, env["counselor"]["id"])

    msgs = H.messages_of(env["member"]["id"], kind="report_ready")
    assert len(msgs) == 1
    assert "“" not in msgs[0]["content"]  # 빈 본문을 인용하지 않는다
    assert "open_report" in H.cta_ids(msgs[0])


def test_EDGE_정지된_계정에는_리포트_메시지를_만들지_않는다(client):
    env = _setup(client, "arc-susp")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
    )
    _set_user_status(env["member"]["id"], "suspended")

    result = _approve(report_id, env["counselor"]["id"])
    assert result["status"] == "completed"
    assert H.messages_of(env["member"]["id"]) == []


def test_리포트_메시지도_푸시_outbox_가_비식별이다(client):
    env = _setup(client, "arc-push")
    report_id = H.create_report(
        env["session"]["id"],
        user_id=env["member"]["id"],
        participant_id=H.participant_id_of(env["session"], env["member"]["id"]),
        status="pending_review",
        content={"summary": "민감한 상담 요약 문장"},
    )

    _approve(report_id, env["counselor"]["id"])

    rows = H.outbox_rows("push")
    assert len(rows) == 1
    assert rows[0]["payload"]["body"] == "루시가 메시지를 보냈어요"
    assert "민감한 상담 요약 문장" not in str(rows[0]["payload"])
    assert "박내담" not in str(rows[0]["payload"])


# ── 보조 ───────────────────────────────────────────────────────


def _open_report_cta(message: dict) -> dict:
    return next(c for c in message["cta"] if c["action"] == "open_report")


def _set_auto_approve(user_id: str, value: bool) -> None:
    from app.models.user import User

    conn = H.db()
    try:
        user = conn.get(User, H._uuid(user_id))
        user.auto_approve_report = value
        conn.commit()
    finally:
        conn.close()


def _set_user_status(user_id: str, status: str) -> None:
    from app.models.user import User

    conn = H.db()
    try:
        user = conn.get(User, H._uuid(user_id))
        user.status = status
        conn.commit()
    finally:
        conn.close()
