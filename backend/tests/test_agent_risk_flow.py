"""SDD-191 — 위험 감지 전체 흐름 QA.

verify.md 시나리오: TS7(상담사 알림), TS8(내담자 비노출 + 연결 CTA), TS10(중복 억제/상승),
TS11(어디서든 탐지), TS12(격리), TS15(푸시 비식별), Edge(상담사 다수 · 연속 감지).
"""

from app.services import agent_risk
from tests import agent_helpers as H
from tests.test_agent_risk_detect import FORBIDDEN_TOKENS

RISK_TEXT_HIGH = "요즘 죽고 싶다는 생각이 계속 들어요."
RISK_TEXT_WATCH = "그냥 사라지고 싶어요."


def _pair(client, prefix: str, *, checkin: bool = False):
    counselor = H.register_counselor(f"{prefix}-c@test.com", name="김상담")
    member = H.register_client(client, f"{prefix}-m@test.com", name="박내담")
    H.link_client(counselor["id"], member["id"])
    H.agree_consent(client, member["h"])
    if checkin:
        H.set_checkin_enabled(counselor["id"], member["id"], True)
    return counselor, member


# ── TS7: 상담사 알림 ──────────────────────────────────────────────


def test_TS7_위험_표현에_상담사_알림이_한_벌_생성된다(client):
    counselor, member = _pair(client, "rk-ts7")

    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    # 1) 위험 신호 1건
    signals = H.risk_signals(counselor["id"])
    assert len(signals) == 1, signals
    assert signals[0]["level"] == agent_risk.LEVEL_HIGH
    assert signals[0]["status"] == "open"
    assert signals[0]["handled_at"] is None
    assert signals[0]["message_id"] is not None

    # 2) 상담사 채널 risk_alert 메시지 — 실명 + excerpt + CTA 2개
    alerts = H.counselor_messages(counselor["id"], kind=agent_risk.KIND_RISK_ALERT)
    assert len(alerts) == 1, alerts
    assert "박내담" in alerts[0]["content"]
    assert "죽고 싶다" in alerts[0]["content"]
    assert H.cta_ids(alerts[0]) == {"open_client", "open_risk_signals"}

    # 3) 인앱 알림 이벤트 — 본문 비식별
    notices = H.notifications_of(counselor["id"], title="AI 비서")
    assert len(notices) == 1, notices
    assert notices[0]["extra"].get("event_type") == agent_risk.RISK_NOTIFICATION_EVENT
    for token in ("박내담", "죽고", agent_risk.LEVEL_HIGH):
        assert token not in notices[0]["body"]


def test_TS7_excerpt_는_감지된_문장만_담고_원문_전체는_담지_않는다(client):
    counselor, member = _pair(client, "rk-ts7b")

    H.send_client_message(
        client,
        member["h"],
        "어제는 친구를 만나서 저녁을 먹었어요. 죽고 싶다는 생각이 들어요. 내일은 병원에 가요.",
    )

    excerpt = H.risk_signals(counselor["id"])[0]["excerpt"]
    assert "죽고 싶다" in excerpt
    assert "저녁을 먹었어요" not in excerpt
    assert "병원에 가요" not in excerpt
    assert len(excerpt) <= agent_risk.EXCERPT_MAX_LENGTH


def test_TS15_위험_푸시_payload_는_비식별이다(client):
    counselor, member = _pair(client, "rk-ts15")

    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    rows = [
        r
        for r in H.outbox_rows("push")
        if r["payload"].get("body") == agent_risk.PUSH_BODY_RISK
    ]
    assert len(rows) == 1, rows
    serialized = str(rows[0]["payload"])
    for token in ("박내담", "죽고", "자살", "high", "watch", "위험"):
        assert token not in serialized, token
    assert counselor["id"] is not None


# ── TS8: 내담자 비노출 + 연결 CTA ─────────────────────────────────


def test_TS8_내담자_응답에는_감지_사실이_드러나지_않는다(client):
    _, member = _pair(client, "rk-ts8a")

    body = H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    reply = body["agent_message"]["content"]
    for token in FORBIDDEN_TOKENS:
        assert token not in reply, token
    assert "상담사" in reply
    # 메시지 kind 로도 드러나지 않는다 — 평범한 free 다.
    assert body["agent_message"]["kind"] == "free"


def test_TS8_상담사와의_direct_채팅방_CTA_가_붙는다(client):
    counselor, member = _pair(client, "rk-ts8b")

    body = H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    ctas = body["agent_message"]["cta"]
    assert len(ctas) == 1, ctas
    assert ctas[0]["action"] == agent_risk.CTA_TALK_TO_COUNSELOR
    assert ctas[0]["label"] == agent_risk.CTA_LABEL_TALK_TO_COUNSELOR
    room_id = ctas[0]["payload"]["room_id"]
    assert room_id == H.direct_room_id(counselor["id"], member["id"])

    # CTA 클릭 기록이 가능하다(화면 이동 액션).
    res = client.post(
        f"/api/v1/agent/messages/{body['agent_message']['id']}/cta/{ctas[0]['id']}",
        json={},
        headers=member["h"],
    )
    assert res.status_code == 200, res.text


def test_TS8_내담자_응답_저장본에도_레벨과_excerpt_가_없다(client):
    _, member = _pair(client, "rk-ts8c")

    H.send_client_message(client, member["h"], RISK_TEXT_WATCH)

    agent_msgs = [m for m in H.messages_of(member["id"]) if m["sender"] == "agent"]
    assert agent_msgs
    for message in agent_msgs:
        assert agent_risk.LEVEL_WATCH not in message["content"]
        assert message["kind"] != agent_risk.KIND_RISK_ALERT


def test_TS8_내담자_API_응답에_위험_필드가_없다(client):
    _, member = _pair(client, "rk-ts8d")
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    res = client.get("/api/v1/agent/messages", headers=member["h"])
    assert res.status_code == 200, res.text
    serialized = res.text
    for token in ("risk", "excerpt", "감지", "모니터링"):
        assert token not in serialized, token


# ── Edge: 연속 감지 ───────────────────────────────────────────────


def test_Edge_연속_위험_발화에_안전_템플릿을_남발하지_않는다(client):
    _, member = _pair(client, "rk-edge-rep")

    replies = [
        H.send_client_message(client, member["h"], RISK_TEXT_HIGH)["agent_message"]
        for _ in range(3)
    ]

    known = set(agent_risk.all_safe_reply_texts())
    safe_count = sum(1 for r in replies if r["content"] in known)
    assert safe_count <= 2, [r["content"] for r in replies]
    assert replies[-1]["content"] == agent_risk.PLAIN_EMPATHY_REPLY
    # 반복 단계에서는 CTA 를 반복 노출하지 않는다.
    assert replies[-1]["cta"] == []


# ── TS10: 중복 억제 / 레벨 상승 ───────────────────────────────────


def test_TS10_같은_레벨_30분_내_재발은_한_건으로_억제된다(client):
    counselor, member = _pair(client, "rk-ts10a")

    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)
    H.send_client_message(client, member["h"], "또 죽고 싶다는 생각이 들어요.")

    assert len(H.risk_signals(counselor["id"])) == 1


def test_TS10_주의에서_즉시확인으로_올라가면_새_신호가_생긴다(client):
    counselor, member = _pair(client, "rk-ts10b")

    H.send_client_message(client, member["h"], RISK_TEXT_WATCH)
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    levels = [s["level"] for s in H.risk_signals(counselor["id"])]
    assert levels == [agent_risk.LEVEL_WATCH, agent_risk.LEVEL_HIGH]


def test_TS10_억제창이_지나면_새_신호가_생긴다(client):
    counselor, member = _pair(client, "rk-ts10c")

    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)
    H.age_risk_signals(member["id"], agent_risk.SUPPRESS_WINDOW_MIN + 5)
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    assert len(H.risk_signals(counselor["id"])) == 2


# ── TS11: 어디서든 탐지 ───────────────────────────────────────────


def test_TS11_안부_대화_중에도_동일하게_탐지된다(client):
    counselor, member = _pair(client, "rk-ts11a", checkin=True)
    H.run_checkin_sweep(now=H.kst_at(10, 0))
    assert H.messages_of(member["id"], kind="checkin")

    body = H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    assert len(H.risk_signals(counselor["id"])) == 1
    assert body["agent_message"]["content"] in agent_risk.all_safe_reply_texts()
    # 체크인 턴으로 소비되지 않는다 — 위험 응답이 체크인 응답을 대체한다.
    assert body["agent_message"]["kind"] == "free"


def test_TS11_리포트_대화_중에도_동일하게_탐지된다(client):
    counselor, member = _pair(client, "rk-ts11b")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.create_report(session["id"], user_id=member["id"], status="published")

    body = H.send_client_message(client, member["h"], "리포트를 봤어요. " + RISK_TEXT_HIGH)

    assert len(H.risk_signals(counselor["id"])) == 1
    assert body["agent_message"]["content"] in agent_risk.all_safe_reply_texts()


def test_TS11_일반_자유_메시지에서도_동일하게_탐지된다(client):
    counselor, member = _pair(client, "rk-ts11c")

    body = H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    assert len(H.risk_signals(counselor["id"])) == 1
    assert body["agent_message"]["content"] in agent_risk.all_safe_reply_texts()


def test_TS11_안전한_메시지는_기존_응답_경로를_그대로_쓴다(client):
    counselor, member = _pair(client, "rk-ts11d")

    body = H.send_client_message(client, member["h"], "오늘은 날씨가 좋아서 산책했어요.")

    assert H.risk_signals(counselor["id"]) == []
    assert body["agent_message"]["content"] not in agent_risk.all_safe_reply_texts()
    assert H.counselor_messages(counselor["id"], kind=agent_risk.KIND_RISK_ALERT) == []


# ── Edge: 담당 상담사 다수 ────────────────────────────────────────


def test_Edge_담당_상담사가_여럿이면_전원에게_알림이_간다(client):
    first = H.register_counselor("rk-multi-c1@test.com", name="김상담")
    second = H.register_counselor("rk-multi-c2@test.com", name="이상담")
    member = H.register_client(client, "rk-multi-m@test.com", name="박내담")
    # matched_at 을 벌려 "가장 최근 매칭 상담사"를 결정적으로 만든다.
    H.link_client(first["id"], member["id"], matched_days_ago=3)
    H.link_client(second["id"], member["id"], matched_days_ago=1)
    H.agree_consent(client, member["h"])

    body = H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    assert len(H.risk_signals(first["id"])) == 1
    assert len(H.risk_signals(second["id"])) == 1
    assert len(H.counselor_messages(first["id"], kind=agent_risk.KIND_RISK_ALERT)) == 1
    assert len(H.counselor_messages(second["id"], kind=agent_risk.KIND_RISK_ALERT)) == 1

    # CTA 는 가장 최근 매칭 상담사(두 번째로 연결된 상담사) 방 하나만 가리킨다.
    room_id = body["agent_message"]["cta"][0]["payload"]["room_id"]
    assert room_id == H.direct_room_id(second["id"], member["id"])


def test_Edge_종료된_링크의_상담사에게는_알림이_가지_않는다(client):
    active = H.register_counselor("rk-ended-c1@test.com", name="김상담")
    ended = H.register_counselor("rk-ended-c2@test.com", name="이상담")
    member = H.register_client(client, "rk-ended-m@test.com", name="박내담")
    H.link_client(active["id"], member["id"])
    H.link_client(ended["id"], member["id"], status="ended")
    H.agree_consent(client, member["h"])

    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    assert len(H.risk_signals(active["id"])) == 1
    assert H.risk_signals(ended["id"]) == []
    assert H.counselor_messages(ended["id"], kind=agent_risk.KIND_RISK_ALERT) == []


# ── TS12: 상담사 간 격리 ─────────────────────────────────────────


def test_TS12_다른_상담사의_위험_신호는_보이지_않는다(client):
    owner, member = _pair(client, "rk-ts12a")
    other = H.register_counselor("rk-ts12a-other@test.com", name="이상담")
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)

    res = client.get("/api/v1/agent/counselor/risk-signals", headers=other["h"])
    assert res.status_code == 200, res.text
    assert res.json()["items"] == []

    res = client.get("/api/v1/agent/counselor/risk-signals", headers=owner["h"])
    assert len(res.json()["items"]) == 1


def test_TS12_다른_상담사는_위험_신호를_처리할_수_없다(client):
    owner, member = _pair(client, "rk-ts12b")
    other = H.register_counselor("rk-ts12b-other@test.com", name="이상담")
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)
    signal_id = H.risk_signals(owner["id"])[0]["id"]

    res = client.post(
        f"/api/v1/agent/counselor/risk-signals/{signal_id}/handled", headers=other["h"]
    )
    assert res.status_code == 404, res.text

    res = client.post(
        f"/api/v1/agent/counselor/risk-signals/{signal_id}/handled", headers=owner["h"]
    )
    assert res.status_code == 200, res.text
    assert res.json()["handled_at"] is not None


def test_TS12_내담자_토큰으로는_위험_신호_API_에_접근할_수_없다(client):
    _, member = _pair(client, "rk-ts12c")

    res = client.get("/api/v1/agent/counselor/risk-signals", headers=member["h"])
    assert res.status_code == 403, res.text


def test_처리_완료한_신호는_기본_목록에서_빠진다(client):
    owner, member = _pair(client, "rk-handled")
    H.send_client_message(client, member["h"], RISK_TEXT_HIGH)
    signal_id = H.risk_signals(owner["id"])[0]["id"]
    client.post(
        f"/api/v1/agent/counselor/risk-signals/{signal_id}/handled", headers=owner["h"]
    )

    open_only = client.get(
        "/api/v1/agent/counselor/risk-signals", headers=owner["h"]
    ).json()["items"]
    assert open_only == []

    all_items = client.get(
        "/api/v1/agent/counselor/risk-signals?status=all", headers=owner["h"]
    ).json()["items"]
    assert len(all_items) == 1
