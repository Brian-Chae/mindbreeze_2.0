"""SDD-189 — 상담사 채널 API QA.

verify.md 시나리오: TS7(relay 목록·처리), TS8(설정 API), TS9(상담사 대화),
TS13(Contract 필드·enum) + Security Review(인증·role·소유자 검증).
"""

from tests import agent_helpers as H

BASE = "/api/v1/agent/counselor"


def _relay_event(counselor_id: str, client_id: str, session_id: str | None, **overrides) -> str:
    """중계 이벤트 1건 직접 생성 — 상담사 열람 경로 검증용."""
    conn = H.db()
    try:
        from app.services import agent_service

        payload = {"kind": "feedback", "payload": {"choice": "helpful", "texts": ["좋았어요"]}}
        payload.update(overrides)
        event = agent_service.create_relay_event(
            conn,
            source_user_id=client_id,
            target_user_id=counselor_id,
            session_id=session_id,
            commit=True,
            **payload,
        )
        return str(event.id)
    finally:
        conn.close()


# ── TS8: 설정 API ────────────────────────────────────────────────


def test_TS8_기본값_반환하고_수정이_반영된다(client):
    counselor = H.register_counselor("ca-ts8a-c@test.com")

    res = client.get(f"{BASE}/settings", headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json() == {
        "morning_enabled": True,
        "morning_time": "08:00",
        "evening_enabled": True,
        "evening_time": "21:00",
        "skip_no_session_days": True,
    }

    updated = {
        "morning_enabled": True,
        "morning_time": "07:30",
        "evening_enabled": False,
        "evening_time": "22:15",
        "skip_no_session_days": False,
    }
    res = client.put(f"{BASE}/settings", json=updated, headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json() == updated

    # 재조회 시에도 유지된다
    assert client.get(f"{BASE}/settings", headers=counselor["h"]).json() == updated


def test_TS8_잘못된_시각은_422(client):
    counselor = H.register_counselor("ca-ts8b-c@test.com")
    base = {
        "morning_enabled": True,
        "morning_time": "08:00",
        "evening_enabled": True,
        "evening_time": "21:00",
        "skip_no_session_days": True,
    }
    for bad in ("25:00", "8:0", "08:60", "0800", "", "08:00:00"):
        res = client.put(
            f"{BASE}/settings", json={**base, "morning_time": bad}, headers=counselor["h"]
        )
        assert res.status_code == 422, f"{bad} 가 통과했다: {res.text}"


def test_TS8_내담자_토큰은_403_이고_비로그인은_401(client):
    member = H.register_client(client, "ca-ts8c-m@test.com")

    assert client.get(f"{BASE}/settings").status_code == 401
    assert client.get(f"{BASE}/settings", headers=member["h"]).status_code == 403
    assert client.get(f"{BASE}/messages", headers=member["h"]).status_code == 403
    assert client.get(f"{BASE}/relay-events", headers=member["h"]).status_code == 403
    assert client.get(f"{BASE}/unread-count", headers=member["h"]).status_code == 403
    assert (
        client.post(f"{BASE}/messages", json={"content": "안녕"}, headers=member["h"]).status_code
        == 403
    )


# ── TS7: relay 목록 · 처리 ────────────────────────────────────────


def test_TS7_본인_이벤트만_나오고_처리하면_목록에서_빠진다(client):
    counselor = H.register_counselor("ca-ts7a-c@test.com")
    member = H.register_client(client, "ca-ts7a-m@test.com", name="박내담")
    session = H.create_session(client, counselor["h"], [member["id"]])
    event_id = _relay_event(counselor["id"], member["id"], session["id"])

    res = client.get(f"{BASE}/relay-events", headers=counselor["h"])
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert len(items) == 1
    item = items[0]
    # Contract(RelayEvent) 필드 확인
    assert item["id"] == event_id
    assert item["kind"] == "feedback"
    assert item["client_id"] == member["id"]
    assert item["client_name"] == "박내담"
    assert item["session_id"] == session["id"]
    assert item["handled_at"] is None
    # 자유 서술은 원문 그대로(D10)
    assert item["payload"]["texts"] == ["좋았어요"]
    assert item["payload"]["choice"] == "helpful"

    res = client.post(f"{BASE}/relay-events/{event_id}/handled", headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json()["handled_at"] is not None

    # status=open 에서는 빠지고, all 에서는 보인다
    assert client.get(f"{BASE}/relay-events", headers=counselor["h"]).json()["items"] == []
    all_items = client.get(
        f"{BASE}/relay-events?status=all", headers=counselor["h"]
    ).json()["items"]
    assert len(all_items) == 1 and all_items[0]["handled_at"] is not None


def test_TS7_처리는_멱등하고_타인_이벤트는_404(client):
    mine = H.register_counselor("ca-ts7b-c1@test.com")
    other = H.register_counselor("ca-ts7b-c2@test.com")
    member = H.register_client(client, "ca-ts7b-m@test.com", name="박내담")
    session = H.create_session(client, other["h"], [member["id"]])
    foreign_event = _relay_event(other["id"], member["id"], session["id"])

    # 타 상담사 대상 이벤트는 404 (IDOR 방지)
    res = client.post(f"{BASE}/relay-events/{foreign_event}/handled", headers=mine["h"])
    assert res.status_code == 404

    own_session = H.create_session(client, mine["h"], [member["id"]], minutes_from_now=320)
    own_event = _relay_event(mine["id"], member["id"], own_session["id"])
    first = client.post(f"{BASE}/relay-events/{own_event}/handled", headers=mine["h"]).json()
    second = client.post(f"{BASE}/relay-events/{own_event}/handled", headers=mine["h"]).json()
    assert first["handled_at"] == second["handled_at"]


def test_TS7_존재하지_않는_이벤트는_404(client):
    counselor = H.register_counselor("ca-ts7c-c@test.com")
    res = client.post(
        f"{BASE}/relay-events/00000000-0000-0000-0000-000000000001/handled",
        headers=counselor["h"],
    )
    assert res.status_code == 404


# ── TS9: 상담사 대화 ─────────────────────────────────────────────


def test_TS9_오늘_일정_질문에_오늘_일정을_답한다(client):
    counselor = H.register_counselor("ca-ts9a-c@test.com")
    member = H.register_client(client, "ca-ts9a-m@test.com", name="박내담")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(14))

    res = client.post(
        f"{BASE}/messages", json={"content": "오늘 일정 알려줘"}, headers=counselor["h"]
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user_message"]["sender"] == "user"
    reply = body["agent_message"]["content"]
    assert "오늘 일정은 1건이에요." in reply
    assert "박내담" in reply and "14:00" in reply
    # 장소·연락처는 상담사 응답에도 담지 않는다
    assert "주소" not in reply and "전화" not in reply


def test_TS9_내일_일정도_구분해서_답한다(client):
    counselor = H.register_counselor("ca-ts9b-c@test.com")
    member = H.register_client(client, "ca-ts9b-m@test.com", name="박내담")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(10, day_offset=1))

    reply = client.post(
        f"{BASE}/messages", json={"content": "내일 일정 알려줘"}, headers=counselor["h"]
    ).json()["agent_message"]["content"]
    assert "내일 일정은 1건이에요." in reply
    assert "박내담" in reply

    # 오늘은 비어 있다
    today_reply = client.post(
        f"{BASE}/messages", json={"content": "오늘 일정"}, headers=counselor["h"]
    ).json()["agent_message"]["content"]
    assert "오늘은 잡혀 있는 상담이 없어요." in today_reply


def test_TS9_담당_내담자_지난요약은_답하고_타_상담사_내담자는_못_찾는다(client):
    mine = H.register_counselor("ca-ts9c-c1@test.com")
    other = H.register_counselor("ca-ts9c-c2@test.com")
    my_client = H.register_client(client, "ca-ts9c-m1@test.com", name="박내담")
    other_client = H.register_client(client, "ca-ts9c-m2@test.com", name="남의내담")

    session = H.create_session(client, mine["h"], [my_client["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(9, day_offset=-1))
    H.set_session_status(session["id"], "completed")
    H.set_ai_summary(
        session["id"],
        {"headline": "최근 수면 패턴 변화를 함께 살펴봤다", "sections": {}, "keywords": ["수면"]},
    )
    H.link_client(mine["id"], my_client["id"])

    other_session = H.create_session(client, other["h"], [other_client["id"]])
    H.set_scheduled_at(other_session["id"], H.kst_at(9, day_offset=-1))
    H.set_session_status(other_session["id"], "completed")
    H.set_ai_summary(
        other_session["id"],
        {"headline": "남의상담사만_볼수있는_요약", "sections": {}, "keywords": []},
    )
    H.link_client(other["id"], other_client["id"])

    reply = client.post(
        f"{BASE}/messages", json={"content": "박내담 지난 요약"}, headers=mine["h"]
    ).json()["agent_message"]["content"]
    assert "최근 수면 패턴 변화를 함께 살펴봤다" in reply

    # 타 상담사 내담자 이름은 찾을 수 없다
    foreign = client.post(
        f"{BASE}/messages", json={"content": "남의내담 지난 요약"}, headers=mine["h"]
    ).json()["agent_message"]["content"]
    assert "찾을 수 없어요" in foreign
    assert "남의상담사만_볼수있는_요약" not in foreign


def test_TS9_기록이_없으면_기록없음을_안내한다(client):
    counselor = H.register_counselor("ca-ts9d-c@test.com")
    member = H.register_client(client, "ca-ts9d-m@test.com", name="박내담")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(9, day_offset=-1))
    H.set_session_status(session["id"], "completed")
    H.link_client(counselor["id"], member["id"])

    reply = client.post(
        f"{BASE}/messages", json={"content": "박내담 지난 요약"}, headers=counselor["h"]
    ).json()["agent_message"]["content"]
    assert "남아 있는 기록이 없어요" in reply


def test_TS9_발송_변경_요청은_실행하지_않고_안내만_한다(client):
    counselor = H.register_counselor("ca-ts9e-c@test.com")
    member = H.register_client(client, "ca-ts9e-m@test.com", name="박내담")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(14))
    before = H.db()
    try:
        from app.models.session import Session as SessionModel

        scheduled_before = before.get(SessionModel, H._uuid(session["id"])).scheduled_at
    finally:
        before.close()

    for text in ("박내담에게 메시지 보내줘", "박내담 일정 변경해줘", "이 상담 취소해줘"):
        reply = client.post(
            f"{BASE}/messages", json={"content": text}, headers=counselor["h"]
        ).json()["agent_message"]["content"]
        assert "직접 바꾸거나 보내지 않아요" in reply

    # 실제 데이터가 바뀌지 않았다
    after = H.db()
    try:
        from app.models.session import Session as SessionModel

        row = after.get(SessionModel, H._uuid(session["id"]))
        assert row.scheduled_at == scheduled_before
        assert row.status != "cancelled"
    finally:
        after.close()


def test_TS9_브리핑_시간_변경_문의는_설정_안내로_답한다(client):
    counselor = H.register_counselor("ca-ts9f-c@test.com")

    reply = client.post(
        f"{BASE}/messages", json={"content": "브리핑 시간 어디서 바꿔요?"}, headers=counselor["h"]
    ).json()["agent_message"]["content"]
    assert "브리핑 설정" in reply


def test_TS9_볼_자료가_없으면_안내_문구로_답한다(client):
    counselor = H.register_counselor("ca-ts9g-c@test.com")

    reply = client.post(
        f"{BASE}/messages", json={"content": "요즘 어때요"}, headers=counselor["h"]
    ).json()["agent_message"]["content"]
    assert "함께 볼 일정이나 전달 사항이 없어요" in reply


# ── 메시지 목록 · 읽음 · 미읽음 ──────────────────────────────────


def test_상담사_채널은_내담자_채널_메시지와_섞이지_않는다(client):
    counselor = H.register_counselor("ca-chan-c@test.com")
    member = H.register_client(client, "ca-chan-m@test.com", name="박내담")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(9))

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    # 상담사 목록에는 브리핑만 있다
    items = client.get(f"{BASE}/messages", headers=counselor["h"]).json()["items"]
    assert len(items) == 1
    assert items[0]["kind"] == "briefing_morning"

    # 내담자 채널(/agent/messages)에는 상담사 브리핑이 없다
    H.agree_consent(client, member["h"])
    client_items = client.get("/api/v1/agent/messages", headers=member["h"]).json()["items"]
    assert all(m["kind"] != "briefing_morning" for m in client_items)


def test_미읽음_카운트와_읽음_처리(client):
    counselor = H.register_counselor("ca-unread-c@test.com")
    member = H.register_client(client, "ca-unread-m@test.com", name="박내담")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(9))
    H.run_briefing_sweep(now=H.kst_at(8, 0))

    assert client.get(f"{BASE}/unread-count", headers=counselor["h"]).json() == {"unread": 1}

    res = client.post(f"{BASE}/messages/read", json={}, headers=counselor["h"])
    assert res.status_code == 200, res.text
    assert res.json() == {"unread": 0}
    assert client.get(f"{BASE}/unread-count", headers=counselor["h"]).json() == {"unread": 0}


# ── CTA 실행 (기록용) ────────────────────────────────────────────


def test_CTA_실행은_이동형만_200_이고_타인_메시지는_404(client):
    counselor = H.register_counselor("ca-cta-c1@test.com")
    other = H.register_counselor("ca-cta-c2@test.com")
    member = H.register_client(client, "ca-cta-m@test.com", name="박내담")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(9))
    H.run_briefing_sweep(now=H.kst_at(8, 0))

    message = H.counselor_messages(counselor["id"], kind="briefing_morning")[0]
    res = client.post(
        f"{BASE}/messages/{message['id']}/cta/open_schedule", json={}, headers=counselor["h"]
    )
    assert res.status_code == 200, res.text
    assert res.json()["cta"]["action"] == "open_schedule"

    # 타 상담사가 같은 메시지 id 로 접근하면 404
    res = client.post(
        f"{BASE}/messages/{message['id']}/cta/open_schedule", json={}, headers=other["h"]
    )
    assert res.status_code == 404

    # 없는 CTA id 는 404
    res = client.post(
        f"{BASE}/messages/{message['id']}/cta/nope", json={}, headers=counselor["h"]
    )
    assert res.status_code == 404


# ── TS13: Contract 교차 대조 (BE 측) ────────────────────────────


def test_TS13_SDD188_enum_값은_변경되지_않았다():
    """내담자 채널 회귀 방지 — 기존 kind·action 값이 그대로 남아 있어야 한다."""
    from typing import get_args

    from app.schemas.agent import AgentCtaAction, AgentMessageKind

    kinds = set(get_args(AgentMessageKind))
    actions = set(get_args(AgentCtaAction))

    assert {
        "reminder_3h", "reminder_1h", "schedule_changed", "report_ready",
        "report_chat", "feedback_thanks", "free",
    } <= kinds
    assert {
        "ack", "open_map", "join_session", "request_change", "open_chat",
        "call_counselor", "open_report", "feedback_choice",
    } <= actions

    # SDD-189 추가분
    assert {"briefing_morning", "briefing_evening"} <= kinds
    assert {
        "open_schedule", "open_client", "open_record", "open_change_requests",
    } <= actions
