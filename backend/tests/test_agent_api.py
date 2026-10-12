"""SDD-188 — AI 에이전트 채널 API QA

verify.md 시나리오: TS1(동의), TS12(일정 변경 문의), TS14(접근 제어),
TS18(사용자 자유 메시지) + Edge Cases(1000자 초과, CTA 멱등, 읽음/미읽음).
"""

from app.services import agent_service
from tests import agent_helpers as H


# ── TS1: 동의 흐름 (D1) ──────────────────────────────────────────


def test_TS1_동의전_조회는_false_이고_전송은_403(client):
    member = H.register_client(client, "ag-consent1@test.com")

    res = client.get("/api/v1/agent/consent", headers=member["h"])
    assert res.status_code == 200, res.text
    assert res.json() == {"agreed": False, "version": "1.0"}

    res = client.post("/api/v1/agent/messages", json={"content": "안녕하세요"}, headers=member["h"])
    assert res.status_code == 403
    assert res.json()["detail"] == "agent_consent_required"


def test_TS1_동의후_전송_성공하고_재동의_요구없음(client):
    member = H.register_client(client, "ag-consent2@test.com")
    assert H.agree_consent(client, member["h"]) == {"agreed": True, "version": "1.0"}

    res = client.get("/api/v1/agent/consent", headers=member["h"])
    assert res.json()["agreed"] is True

    res = client.post("/api/v1/agent/messages", json={"content": "요즘 잠이 안 와요"}, headers=member["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user_message"]["sender"] == "user"
    assert body["agent_message"]["sender"] == "agent"

    # 재동의(멱등) — consents 에 ai_agent 행은 1개만 남는다
    H.agree_consent(client, member["h"])
    from app.models.consent import Consent

    conn = H.db()
    try:
        rows = (
            conn.query(Consent)
            .filter(Consent.user_id == H._uuid(member["id"]), Consent.type == "ai_agent")
            .all()
        )
        assert len(rows) == 1
    finally:
        conn.close()


# ── TS14: 접근 제어 ──────────────────────────────────────────────


def test_TS14_비로그인은_401_상담사는_403(client):
    assert client.get("/api/v1/agent/messages").status_code == 401

    counselor = H.register_counselor("ag-acl-host@test.com")
    res = client.get("/api/v1/agent/messages", headers=counselor["h"])
    assert res.status_code == 403


def test_TS14_타인_메시지_CTA_는_404(client):
    counselor = H.register_counselor("ag-acl2-host@test.com")
    member_a = H.register_client(client, "ag-acl2-a@test.com")
    member_b = H.register_client(client, "ag-acl2-b@test.com")
    H.agree_consent(client, member_a["h"])
    H.agree_consent(client, member_b["h"])

    session = H.create_session(client, counselor["h"], [member_b["id"]], minutes_from_now=180,
                               location_address="대전 유성구 테스트로 1")
    H.run_sweep()
    msgs = H.messages_of(member_b["id"], kind="reminder_3h")
    assert len(msgs) == 1
    target_id = msgs[0]["id"]

    # A 토큰으로 B 의 메시지 CTA 호출 → 404 (IDOR 차단)
    res = client.post(
        f"/api/v1/agent/messages/{target_id}/cta/ack", json={}, headers=member_a["h"]
    )
    assert res.status_code == 404

    # 본인(B)은 정상 수행
    res = client.post(
        f"/api/v1/agent/messages/{target_id}/cta/ack", json={}, headers=member_b["h"]
    )
    assert res.status_code == 200, res.text
    assert res.json()["cta"]["done"] is True
    assert session["id"]


# ── TS12: 일정 변경 문의 ─────────────────────────────────────────


def test_TS12_사유없이_호출하면_400_이고_사유가_있으면_중계와_알림이_생긴다(client):
    counselor = H.register_counselor("ag-chg-host@test.com", name="이상담")
    member = H.register_client(client, "ag-chg-mem@test.com")
    H.agree_consent(client, member["h"])
    session = H.create_session(client, counselor["h"], [member["id"]], minutes_from_now=180,
                               location_address="대전 유성구 테스트로 2")
    H.run_sweep()
    msg = H.messages_of(member["id"], kind="reminder_3h")[0]

    res = client.post(
        f"/api/v1/agent/messages/{msg['id']}/cta/request_change", json={}, headers=member["h"]
    )
    assert res.status_code == 400, res.text

    res = client.post(
        f"/api/v1/agent/messages/{msg['id']}/cta/request_change",
        json={"reason": "회사 일정이 생겼어요"},
        headers=member["h"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["cta"]["done"] is True
    assert body["agent_message"] is not None
    assert "접수" in body["agent_message"]["content"]

    events = H.relay_events("schedule_change_request")
    assert len(events) == 1
    assert events[0]["payload"]["reason"] == "회사 일정이 생겼어요"
    assert events[0]["session_id"] == session["id"]
    assert events[0]["target_user_id"] == counselor["id"]

    # 상담사 인앱 알림 1건
    res = client.get("/api/v1/notifications?event=schedule_change_request", headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert len(res.json()["notifications"]) == 1


def test_TS12_같은_CTA_두번_호출해도_중계이벤트는_1건(client):
    counselor = H.register_counselor("ag-chg2-host@test.com")
    member = H.register_client(client, "ag-chg2-mem@test.com")
    H.agree_consent(client, member["h"])
    H.create_session(client, counselor["h"], [member["id"]], minutes_from_now=180,
                     location_address="대전 유성구 테스트로 3")
    H.run_sweep()
    msg = H.messages_of(member["id"], kind="reminder_3h")[0]

    for _ in range(2):
        client.post(
            f"/api/v1/agent/messages/{msg['id']}/cta/request_change",
            json={"reason": "사정이 생겼어요"},
            headers=member["h"],
        )
    assert len(H.relay_events("schedule_change_request")) == 1


def test_ack_CTA_두번_눌러도_이벤트_1건(client):
    counselor = H.register_counselor("ag-ack-host@test.com")
    member = H.register_client(client, "ag-ack-mem@test.com")
    H.agree_consent(client, member["h"])
    H.create_session(client, counselor["h"], [member["id"]], minutes_from_now=180,
                     location_address="대전 유성구 테스트로 4")
    H.run_sweep()
    msg = H.messages_of(member["id"], kind="reminder_3h")[0]

    for _ in range(2):
        res = client.post(
            f"/api/v1/agent/messages/{msg['id']}/cta/ack", json={}, headers=member["h"]
        )
        assert res.status_code == 200, res.text
    assert len(H.relay_events("ack")) == 1


def test_없는_CTA_id_는_404(client):
    member = H.register_client(client, "ag-nocta@test.com")
    H.agree_consent(client, member["h"])
    res = client.post("/api/v1/agent/messages", json={"content": "안녕"}, headers=member["h"])
    msg_id = res.json()["agent_message"]["id"]
    res = client.post(
        f"/api/v1/agent/messages/{msg_id}/cta/nope", json={}, headers=member["h"]
    )
    assert res.status_code == 404


# ── TS18: 사용자 자유 메시지 (리포트 범위) ──────────────────────


def test_TS18_리포트_범위_질문은_본문_안에서_답하고_범위밖은_상담사_안내(client, monkeypatch):
    # LLM 키 없음 → 템플릿 폴백 경로를 검증한다(TS16 과 동일 조건).
    from app.config import settings

    monkeypatch.setattr(settings, "gemini_api_key", "")

    counselor = H.register_counselor("ag-chat-host@test.com", name="최상담")
    member = H.register_client(client, "ag-chat-mem@test.com")
    H.agree_consent(client, member["h"])
    session = H.create_session(client, counselor["h"], [member["id"]], minutes_from_now=300,
                               location_address="대전 유성구 테스트로 5")
    H.create_report(
        session["id"],
        user_id=member["id"],
        participant_id=H.participant_id_of(session, member["id"]),
        status="completed",
        content={"summary": "이완이 빠르게 돌아오는 모습이 관찰되었습니다"},
    )

    res = client.post(
        "/api/v1/agent/messages",
        json={"content": "이완이 빨리 돌아왔다는 게 무슨 뜻이에요?"},
        headers=member["h"],
    )
    assert res.status_code == 200, res.text
    reply = res.json()["agent_message"]
    assert reply["kind"] == "report_chat"
    # 리포트 본문을 인용하고, 새 해석을 하지 않는다
    assert "이완이 빠르게 돌아오는 모습이 관찰되었습니다" in reply["content"]

    # 범위 밖(병명) 질문 → 상담사 연결 안내
    res = client.post(
        "/api/v1/agent/messages", json={"content": "제 병명이 뭐예요?"}, headers=member["h"]
    )
    assert res.status_code == 200, res.text
    reply = res.json()["agent_message"]
    assert "상담사" in reply["content"]
    assert "병명" not in reply["content"]


def test_리포트_일정_모두_없으면_감정_대화_응답(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "gemini_api_key", "")
    member = H.register_client(client, "ag-chat-empty@test.com")
    H.agree_consent(client, member["h"])

    res = client.post("/api/v1/agent/messages", json={"content": "안녕하세요"}, headers=member["h"])
    assert res.status_code == 200, res.text
    reply = res.json()["agent_message"]
    assert reply["kind"] == "free"
    # SDD-193: 리포트·일정이 없어도 감정 대화 폴백으로 응답한다(안내 문구 아님).
    assert reply["content"] in agent_service.COMPANION_REPLY_FALLBACKS


# ── Edge Cases ──────────────────────────────────────────────────


def test_EDGE_1000자_초과_메시지는_422(client):
    member = H.register_client(client, "ag-long@test.com")
    H.agree_consent(client, member["h"])
    res = client.post(
        "/api/v1/agent/messages", json={"content": "가" * 1001}, headers=member["h"]
    )
    assert res.status_code == 422

    res = client.post("/api/v1/agent/messages", json={"content": ""}, headers=member["h"])
    assert res.status_code == 422


def test_미읽음_카운트와_읽음_처리(client):
    counselor = H.register_counselor("ag-unread-host@test.com")
    member = H.register_client(client, "ag-unread-mem@test.com")
    H.agree_consent(client, member["h"])
    H.create_session(client, counselor["h"], [member["id"]], minutes_from_now=180,
                     location_address="대전 유성구 테스트로 6")
    H.run_sweep()

    res = client.get("/api/v1/agent/unread-count", headers=member["h"])
    assert res.status_code == 200, res.text
    assert res.json()["unread"] == 1

    res = client.post("/api/v1/agent/messages/read", json={}, headers=member["h"])
    assert res.status_code == 200, res.text
    assert res.json()["unread"] == 0


def test_메시지_목록은_최신순이고_has_more_를_내려준다(client):
    member = H.register_client(client, "ag-list@test.com")
    H.agree_consent(client, member["h"])
    for i in range(3):
        client.post("/api/v1/agent/messages", json={"content": f"메시지 {i}"}, headers=member["h"])

    res = client.get("/api/v1/agent/messages?limit=2", headers=member["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["items"]) == 2
    assert body["has_more"] is True
    # 최신순 — 첫 항목의 created_at 이 더 크다(같을 수 있으므로 >=)
    assert body["items"][0]["created_at"] >= body["items"][1]["created_at"]


def test_내담자_메시지는_본인_대화방에만_쌓인다(client):
    member_a = H.register_client(client, "ag-iso-a@test.com")
    member_b = H.register_client(client, "ag-iso-b@test.com")
    H.agree_consent(client, member_a["h"])
    H.agree_consent(client, member_b["h"])

    client.post("/api/v1/agent/messages", json={"content": "A 의 비밀 이야기"}, headers=member_a["h"])

    res = client.get("/api/v1/agent/messages", headers=member_b["h"])
    assert res.status_code == 200, res.text
    assert res.json()["items"] == []
