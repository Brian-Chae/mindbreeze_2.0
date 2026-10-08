"""SDD-191 — 안부 아웃리치 QA (대상 선정 · 제한 규칙 · 트리거).

verify.md 시나리오: TS1(대상 선정), TS2(제한 규칙), TS3(트리거), TS16(LLM 폴백) 일부.
"""

from datetime import timedelta

from app.services import agent_checkin
from tests import agent_helpers as H


def _pair(client, prefix: str, *, enabled: bool = True, consent: bool = True):
    """상담사 1명 + 담당 내담자 1명. 기본은 "상담사가 켬 + 동의함" 상태."""
    counselor = H.register_counselor(f"{prefix}-c@test.com", name="김상담")
    member = H.register_client(client, f"{prefix}-m@test.com", name="박내담")
    H.link_client(counselor["id"], member["id"])
    if consent:
        H.agree_consent(client, member["h"])
    if enabled:
        H.set_checkin_enabled(counselor["id"], member["id"], True)
    return counselor, member


# ── TS1: 대상 선정 ────────────────────────────────────────────────


def test_TS1_상담사가_켠_내담자에게만_안부가_생성된다(client):
    counselor, member = _pair(client, "ck-ts1a")

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    messages = H.messages_of(member["id"], kind="checkin")
    assert len(messages) == 1, messages
    rows = H.checkins(member["id"])
    assert len(rows) == 1
    assert rows[0]["counselor_id"] == counselor["id"]


def test_TS1_상담사가_켜지_않으면_생성되지_않는다(client):
    _, member = _pair(client, "ck-ts1b", enabled=False)

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    assert H.messages_of(member["id"], kind="checkin") == []
    assert H.checkins(member["id"]) == []


def test_TS1_내담자가_일시중지하면_생성되지_않는다(client):
    _, member = _pair(client, "ck-ts1c")
    H.set_checkin_paused(member["id"], True)

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    assert H.messages_of(member["id"], kind="checkin") == []


def test_TS1_동의_전이면_생성되지_않는다(client):
    _, member = _pair(client, "ck-ts1d", consent=False)

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    assert H.messages_of(member["id"], kind="checkin") == []


def test_TS1_링크가_종료되면_생성되지_않는다(client):
    counselor = H.register_counselor("ck-ts1e-c@test.com", name="김상담")
    member = H.register_client(client, "ck-ts1e-m@test.com", name="박내담")
    H.link_client(counselor["id"], member["id"], status="ended")
    H.agree_consent(client, member["h"])
    H.set_checkin_enabled(counselor["id"], member["id"], True)

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    assert H.messages_of(member["id"], kind="checkin") == []


def test_TS1_계정이_정지되면_생성되지_않는다(client):
    _, member = _pair(client, "ck-ts1f")
    conn = H.db()
    try:
        from app.models.user import User

        user = conn.get(User, H._uuid(member["id"]))
        user.status = "suspended"
        conn.commit()
    finally:
        conn.close()

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    assert H.messages_of(member["id"], kind="checkin") == []


# ── TS2: 제한 규칙 ────────────────────────────────────────────────


def test_TS2_하루에_두번_스윕해도_한건만_생성된다(client):
    _, member = _pair(client, "ck-ts2a")

    H.run_checkin_sweep(now=H.kst_at(10, 0))
    # 열린 체크인을 닫아도 같은 날에는 더 만들지 않는다(발송 로그 UNIQUE).
    H.close_open_checkin(member["id"])
    H.run_checkin_sweep(now=H.kst_at(14, 0))

    assert len(H.messages_of(member["id"], kind="checkin")) == 1


def test_TS2_방해금지_시간대에는_생성되지_않는다(client):
    _, member = _pair(client, "ck-ts2b")

    # 22:00·02:00·07:59 KST 는 금지
    for hour, minute in ((22, 0), (2, 0), (7, 59)):
        H.run_checkin_sweep(now=H.kst_at(hour, minute))
    assert H.messages_of(member["id"], kind="checkin") == []

    # 21:59 는 허용
    H.run_checkin_sweep(now=H.kst_at(21, 59))
    assert len(H.messages_of(member["id"], kind="checkin")) == 1


def test_TS2_08시_정각은_허용된다(client):
    _, member = _pair(client, "ck-ts2c")

    H.run_checkin_sweep(now=H.kst_at(8, 0))

    assert len(H.messages_of(member["id"], kind="checkin")) == 1


def test_TS2_열린_체크인이_있으면_새로_시작하지_않는다(client):
    _, member = _pair(client, "ck-ts2d")

    H.run_checkin_sweep(now=H.kst_at(10, 0))
    # 열린 체크인을 하루 전으로 밀어 발송 로그 날짜 제약을 피해도 신규는 생기지 않는다.
    conn = H.db()
    try:
        from app.models.agent import AgentCheckin

        row = (
            conn.query(AgentCheckin)
            .filter(AgentCheckin.client_id == H._uuid(member["id"]))
            .first()
        )
        row.started_at = row.started_at - timedelta(days=5)
        conn.commit()
    finally:
        conn.close()

    H.run_checkin_sweep(now=H.kst_at(11, 0))

    assert len(H.checkins(member["id"])) == 1


def test_TS2_주당_상한을_넘으면_생성되지_않는다(client):
    _, member = _pair(client, "ck-ts2e")
    # 지난 7일 안에 마무리된 체크인 4건을 심는다(응답이 있었던 체크인 — 간격 점증 미적용).
    counselor_id = _enabled_counselor_ids(member["id"])[0]
    _seed_checkins(member["id"], counselor_id, count=4, turn_count=3)

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    assert H.messages_of(member["id"], kind="checkin") == []


def test_TS2_무응답이_쌓이면_간격이_점증한다(client):
    _, member = _pair(client, "ck-ts2f")
    counselor_id = _enabled_counselor_ids(member["id"])[0]

    # 무응답(턴 0) 체크인 1건이 어제 있었다 → 1일 간격은 아직 안 지났다.
    _seed_checkins(member["id"], counselor_id, count=1, turn_count=0, days_ago=0)
    H.run_checkin_sweep(now=H.kst_at(10, 0))
    assert H.messages_of(member["id"], kind="checkin") == []

    # 무응답 2건이 2일 전에 끝났다면 필요한 간격은 2일 → 통과한다.
    _reset_checkins(member["id"])
    _seed_checkins(member["id"], counselor_id, count=2, turn_count=0, days_ago=3)
    H.run_checkin_sweep(now=H.kst_at(10, 30))
    assert len(H.messages_of(member["id"], kind="checkin")) == 1


# ── TS3: 트리거 ───────────────────────────────────────────────────


def test_TS3_무응답_3일이면_무응답_문구로_안부한다(client):
    _, member = _pair(client, "ck-ts3a")

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    rows = H.checkins(member["id"])
    assert rows[0]["trigger"] == "no_response"
    content = H.messages_of(member["id"], kind="checkin")[0]["content"]
    assert content == agent_checkin.OUTREACH_TEMPLATES["no_response"]


def test_TS3_직전_대화가_주의로_끝나면_분기_문구가_나온다(client):
    _, member = _pair(client, "ck-ts3b")
    counselor_id = _enabled_counselor_ids(member["id"])[0]
    _seed_checkins(
        member["id"], counselor_id, count=1, turn_count=4, days_ago=2, mood_direction="watch"
    )

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    rows = H.checkins(member["id"])
    assert rows[-1]["trigger"] == "hard_feeling"
    content = H.messages_of(member["id"], kind="checkin")[0]["content"]
    assert content == agent_checkin.OUTREACH_TEMPLATES["hard_feeling"]


def test_TS3_상담_완료_다음날이면_분기_문구가_나온다(client):
    counselor, member = _pair(client, "ck-ts3c")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(14, 0, day_offset=-1))
    H.set_session_status(session["id"], "completed")

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    rows = H.checkins(member["id"])
    assert rows[-1]["trigger"] == "after_session"
    content = H.messages_of(member["id"], kind="checkin")[0]["content"]
    assert content == agent_checkin.OUTREACH_TEMPLATES["after_session"]


def test_TS3_트리거가_없으면_생성되지_않는다(client):
    _, member = _pair(client, "ck-ts3d")
    # 방금 대화한 내담자(무응답 아님) + 완료 세션 없음 + 평소 시간대 표본 부족
    H.send_client_message(client, member["h"], "오늘은 날씨가 좋네요")
    before = len(H.messages_of(member["id"], kind="checkin"))

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    # 아웃리치 발송 로그가 없다 = AI 가 먼저 말을 걸지 않았다.
    assert H.delivery_logs(kind="checkin") == []
    assert len(H.messages_of(member["id"], kind="checkin")) == before


# ── TS15: 푸시 비식별 ─────────────────────────────────────────────


def test_TS15_안부_푸시_payload_에_이름과_감정이_없다(client):
    _, member = _pair(client, "ck-ts15")

    H.run_checkin_sweep(now=H.kst_at(10, 0))

    rows = [
        r
        for r in H.outbox_rows("push")
        if r["payload"].get("body") == agent_checkin.PUSH_BODY_CHECKIN
    ]
    assert len(rows) == 1, rows
    payload = rows[0]["payload"]
    assert payload["title"] == "AI 비서"
    assert payload["deeplink"] == "/app/ai"
    serialized = str(payload)
    for token in ("박내담", "안부가 궁금", "불안", "우울", "위험"):
        assert token not in serialized


# ---------------------------------------------------------------------------
# 테스트 보조
# ---------------------------------------------------------------------------


def _enabled_counselor_ids(client_id: str) -> list[str]:
    from app.services import agent_checkin as svc

    conn = H.db()
    try:
        return [str(cid) for cid in svc.enabled_counselor_ids(conn, H._uuid(client_id))]
    finally:
        conn.close()


def _seed_checkins(
    client_id: str,
    counselor_id: str,
    *,
    count: int,
    turn_count: int,
    days_ago: int = 1,
    mood_direction: str = "same",
) -> None:
    """과거 체크인 행을 심는다 — 주당 상한·간격 점증·트리거 검증용."""
    from datetime import datetime, timezone

    from app.models.agent import AgentCheckin

    conn = H.db()
    try:
        for index in range(count):
            when = datetime.now(timezone.utc) - timedelta(days=days_ago, hours=index)
            conn.add(
                AgentCheckin(
                    client_id=H._uuid(client_id),
                    counselor_id=H._uuid(counselor_id),
                    trigger="usual_time",
                    started_at=when,
                    closed_at=when,
                    turn_count=turn_count,
                    summary="안부 대화를 나눴어요.",
                    mood_direction=mood_direction,
                )
            )
        conn.commit()
    finally:
        conn.close()


def _reset_checkins(client_id: str) -> None:
    from app.models.agent import AgentCheckin

    conn = H.db()
    try:
        conn.query(AgentCheckin).filter(
            AgentCheckin.client_id == H._uuid(client_id)
        ).delete(synchronize_session=False)
        conn.commit()
    finally:
        conn.close()
