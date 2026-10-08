"""SDD-188 — AI 비서 예약 사전 노티 QA

verify.md 시나리오: TS2(3시간 전), TS3(1시간 전·온라인), TS4(멱등), TS5(주소 없음),
TS6(취소·변경), TS7(시간 윈도우), TS15(푸시 Outbox 비식별) + Edge Cases.
"""

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from app.services import agent_reminder
from tests import agent_helpers as H

ADDRESS = "대전 유성구 테크노2로 187"


def _cta(message: dict, action: str) -> dict | None:
    for item in message.get("cta") or []:
        if item.get("action") == action:
            return item
    return None


# ── TS2: 예약 3시간 전 노티 (오프라인) ──────────────────────────


def test_TS2_3시간전_오프라인_노티와_CTA(client):
    counselor = H.register_counselor("agr-ts2-host@test.com", name="김상담")
    member = H.register_client(client, "agr-ts2-mem@test.com")
    session = H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )

    H.run_sweep()

    msgs = H.messages_of(member["id"], kind="reminder_3h")
    assert len(msgs) == 1
    msg = msgs[0]
    assert msg["ref_type"] == "session" and msg["ref_id"] == session["id"]

    # 사실 정보는 DB 값 그대로 — 상담사 이름·시각·장소
    assert "김상담" in msg["content"]
    assert ADDRESS in msg["content"]
    assert "임상심리상담" in msg["content"]
    scheduled_text = _scheduled_text(session["id"])
    assert scheduled_text in msg["content"]

    assert H.cta_ids(msg) >= {"ack", "open_map", "request_change", "open_chat"}
    # 길찾기 URL 에 주소가 인코딩돼 들어간다
    assert quote(ADDRESS, safe="") in _cta(msg, "open_map")["payload"]["url"]


def test_TS2_상담사_전화번호가_있으면_전화_CTA_포함(client):
    counselor = H.register_counselor("agr-tel-host@test.com")
    member = H.register_client(client, "agr-tel-mem@test.com")
    _set_phone(counselor["id"], "010-1234-5678")
    H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )

    H.run_sweep()
    msg = H.messages_of(member["id"], kind="reminder_3h")[0]
    assert _cta(msg, "call_counselor")["payload"]["tel"] == "010-1234-5678"


def test_전화번호_없으면_전화_CTA_없음(client):
    counselor = H.register_counselor("agr-notel-host@test.com")
    member = H.register_client(client, "agr-notel-mem@test.com")
    H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )

    H.run_sweep()
    msg = H.messages_of(member["id"], kind="reminder_3h")[0]
    assert "call_counselor" not in H.cta_ids(msg)


# ── TS3: 1시간 전 노티 (온라인) ─────────────────────────────────


def test_TS3_1시간전_온라인_노티는_입장하기만(client):
    counselor = H.register_counselor("agr-ts3-host@test.com")
    member = H.register_client(client, "agr-ts3-mem@test.com")
    session = H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=60, location_type="online"
    )

    H.run_sweep()

    msgs = H.messages_of(member["id"])
    assert [m["kind"] for m in msgs] == ["reminder_1h"]
    actions = H.cta_ids(msgs[0])
    assert "join_session" in actions
    assert "open_map" not in actions
    assert _cta(msgs[0], "join_session")["payload"]["session_id"] == session["id"]
    assert "온라인" in msgs[0]["content"]


def test_온라인_세션은_주소를_입력해도_장소문장이_없다(client):
    counselor = H.register_counselor("agr-on-host@test.com")
    member = H.register_client(client, "agr-on-mem@test.com")
    H.create_session(
        client,
        counselor["h"],
        [member["id"]],
        minutes_from_now=60,
        location_type="online",
        location_address=ADDRESS,
    )

    H.run_sweep()
    msg = H.messages_of(member["id"], kind="reminder_1h")[0]
    assert ADDRESS not in msg["content"]
    assert "open_map" not in H.cta_ids(msg)


# ── TS4: 멱등 ───────────────────────────────────────────────────


def test_TS4_스윕을_여러번_실행해도_메시지와_로그는_1건(client):
    counselor = H.register_counselor("agr-ts4-host@test.com")
    member = H.register_client(client, "agr-ts4-mem@test.com")
    H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )

    for _ in range(4):
        H.run_sweep()

    assert len(H.messages_of(member["id"], kind="reminder_3h")) == 1
    assert len(H.delivery_logs("reminder_3h")) == 1


# ── TS5: 주소 없음 ──────────────────────────────────────────────


def test_TS5_주소가_없으면_길찾기_CTA_없고_장소문장도_없다(client):
    # 기관 주소·상담사 주소가 모두 없는 상태(테스트 기관은 주소 미설정)
    counselor = H.register_counselor("agr-ts5-host@test.com")
    member = H.register_client(client, "agr-ts5-mem@test.com")
    session = H.create_session(client, counselor["h"], [member["id"]], minutes_from_now=180)
    assert session["location_address"] is None

    H.run_sweep()

    msg = H.messages_of(member["id"], kind="reminder_3h")[0]
    actions = H.cta_ids(msg)
    assert "open_map" not in actions
    assert "open_chat" in actions
    assert "· 장소:" not in msg["content"]
    assert "정보 없음" not in msg["content"]


# ── TS6: 취소 · 변경 ────────────────────────────────────────────


def test_TS6_취소된_세션에는_발송하지_않는다(client):
    counselor = H.register_counselor("agr-ts6a-host@test.com")
    member = H.register_client(client, "agr-ts6a-mem@test.com")
    session = H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )
    H.set_session_status(session["id"], "cancelled")

    H.run_sweep()
    assert H.messages_of(member["id"]) == []


def test_TS6_일정이_늦춰지면_정정안내_1회_이후_1h는_새시각_기준(client):
    counselor = H.register_counselor("agr-ts6b-host@test.com")
    member = H.register_client(client, "agr-ts6b-mem@test.com")
    session = H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )
    H.run_sweep()
    assert len(H.messages_of(member["id"], kind="reminder_3h")) == 1

    # 일정을 2시간 늦춘다 → 정정 안내 1건
    new_when = datetime.now(timezone.utc) + timedelta(minutes=300)
    H.set_scheduled_at(session["id"], new_when)
    H.run_sweep()
    corrections = H.messages_of(member["id"], kind="schedule_changed")
    assert len(corrections) == 1
    assert "변경" in corrections[0]["content"]

    # 같은 변경으로는 다시 정정하지 않는다
    H.run_sweep()
    assert len(H.messages_of(member["id"], kind="schedule_changed")) == 1

    # 새 시각 기준 1시간 전이 되면 1h 노티가 나간다
    H.set_scheduled_at(session["id"], datetime.now(timezone.utc) + timedelta(minutes=60))
    H.run_sweep()
    assert len(H.messages_of(member["id"], kind="reminder_1h")) == 1


def test_안내를_받지_않은_수신자에게는_정정안내를_보내지_않는다(client):
    counselor = H.register_counselor("agr-ts6c-host@test.com")
    member = H.register_client(client, "agr-ts6c-mem@test.com")
    session = H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=600, location_address=ADDRESS
    )
    H.set_scheduled_at(session["id"], datetime.now(timezone.utc) + timedelta(minutes=700))

    H.run_sweep()
    assert H.messages_of(member["id"], kind="schedule_changed") == []


# ── TS7: 시간 윈도우 ────────────────────────────────────────────


def test_TS7_240분_전에는_발송하지_않는다(client):
    counselor = H.register_counselor("agr-ts7a-host@test.com")
    member = H.register_client(client, "agr-ts7a-mem@test.com")
    H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=240, location_address=ADDRESS
    )

    H.run_sweep()
    assert H.messages_of(member["id"]) == []


def test_TS7_시작_5분전_임박_세션에는_1h_보정을_하지_않는다(client):
    counselor = H.register_counselor("agr-ts7b-host@test.com")
    member = H.register_client(client, "agr-ts7b-mem@test.com")
    H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=5, location_address=ADDRESS
    )

    H.run_sweep()
    assert H.messages_of(member["id"]) == []


def test_TS7_서버중단_복구_55분전_로그없음이면_1h_보정발송_1회(client):
    counselor = H.register_counselor("agr-ts7c-host@test.com")
    member = H.register_client(client, "agr-ts7c-mem@test.com")
    H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=55, location_address=ADDRESS
    )

    H.run_sweep()
    msgs = H.messages_of(member["id"])
    # 3h 노티는 1h 구간에 들어오면 중단되므로 이중 안내가 없다
    assert [m["kind"] for m in msgs] == ["reminder_1h"]

    H.run_sweep()
    assert len(H.messages_of(member["id"], kind="reminder_1h")) == 1


def test_윈도우_판정_단위_규칙(client):
    """due_offsets 규칙 자체를 시각별로 고정한다."""
    from app.models.session import Session as SessionModel

    base = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)
    session = SessionModel(
        type="clinical", status="scheduled", host_id=H._uuid("00000000-0000-0000-0000-000000000001"),
        duration_min=50, scheduled_at=base, location_type="offline",
        participant_mode="one_on_one", linkband_mode="none", is_template=False,
    )

    def due(remaining_min: float) -> list[int]:
        return agent_reminder.due_offsets(session, base - timedelta(minutes=remaining_min))

    assert due(240) == []
    assert due(180) == [180]
    assert due(179) == [180]
    assert due(120) == [180]      # 보정 구간(바닥선 60 초과)
    assert due(60) == [60]        # 정상 창
    assert due(30) == [60]        # 보정 구간(바닥선 10 초과)
    assert due(5) == []           # 임박 — 보내지 않는다
    assert due(-5) == []          # 이미 시작


# ── TS15: 푸시 Outbox 비식별 ────────────────────────────────────


def test_TS15_푸시_outbox_는_pending_이고_PII_가_없다(client):
    counselor = H.register_counselor("agr-ts15-host@test.com", name="김상담")
    member = H.register_client(client, "agr-ts15-mem@test.com", name="박내담")
    H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )

    H.run_sweep()

    rows = H.outbox_rows("push")
    assert len(rows) == 1
    row = rows[0]
    assert row["status"] == "pending"
    assert row["payload"]["body"] == "AI 비서가 메시지를 보냈어요"
    assert row["payload"]["deeplink"] == "/app/ai"
    serialized = str(row["payload"])
    for secret in ("박내담", "김상담", ADDRESS, "임상심리상담"):
        assert secret not in serialized


def test_TS15_기존_outbox_소비_cron은_push_행을_건드리지_않는다(client):
    counselor = H.register_counselor("agr-ts15b-host@test.com")
    member = H.register_client(client, "agr-ts15b-mem@test.com")
    H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )
    H.run_sweep()

    import asyncio

    from app.services import outbox_worker
    from app.tasks.outbox import cleanup_notifications, process_email_outbox

    # ws 소비자 · 이메일 소비자 · 보관 정리 cron 을 모두 돌려 본다.
    asyncio.run(outbox_worker.poll_and_deliver_ws())
    process_email_outbox()
    cleanup_notifications()

    rows = H.outbox_rows("push")
    assert len(rows) == 1
    assert rows[0]["status"] == "pending"


# ── Edge Cases ─────────────────────────────────────────────────


def test_EDGE_그룹세션은_대상에서_제외(client):
    counselor = H.register_counselor("agr-grp-host@test.com")
    member = H.register_client(client, "agr-grp-mem@test.com")
    H.create_session(
        client,
        counselor["h"],
        [member["id"]],
        minutes_from_now=180,
        type="meditation",
        participant_mode="group",
        max_participants=10,
        location_address=ADDRESS,
    )

    H.run_sweep()
    assert H.messages_of(member["id"]) == []


def test_EDGE_일정없는_즉석세션은_대상에서_제외(client):
    counselor = H.register_counselor("agr-adhoc-host@test.com")
    member = H.register_client(client, "agr-adhoc-mem@test.com")
    H.create_session(
        client, counselor["h"], [member["id"]], scheduled_at=None, location_address=ADDRESS
    )

    H.run_sweep()
    assert H.messages_of(member["id"]) == []


def test_EDGE_대기열_참여자는_대상에서_제외(client):
    counselor = H.register_counselor("agr-wait-host@test.com")
    member = H.register_client(client, "agr-wait-mem@test.com")
    session = H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )
    _set_waitlisted(session["id"], member["id"])

    H.run_sweep()
    assert H.messages_of(member["id"]) == []


def test_EDGE_정지된_계정에는_메시지를_만들지_않는다(client):
    counselor = H.register_counselor("agr-susp-host@test.com")
    member = H.register_client(client, "agr-susp-mem@test.com")
    H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )
    _set_user_status(member["id"], "suspended")

    H.run_sweep()
    assert H.messages_of(member["id"]) == []


def test_EDGE_중복_참여행이_있어도_알림은_1건(client):
    counselor = H.register_counselor("agr-dup-host@test.com")
    member = H.register_client(client, "agr-dup-mem@test.com")
    session = H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )
    # 같은 (session, user) 는 UNIQUE 라 행을 늘릴 수 없다 — 쿼리 중복 제거 자체를 검증한다.
    users = _target_users(session["id"])
    assert len(users) == 1

    H.run_sweep()
    assert len(H.messages_of(member["id"], kind="reminder_3h")) == 1


def test_EDGE_같은_시각_두_세션은_각각_별도_메시지(client):
    counselor = H.register_counselor("agr-two-host@test.com")
    counselor2 = H.register_counselor("agr-two-host2@test.com")
    member = H.register_client(client, "agr-two-mem@test.com")
    s1 = H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )
    s2 = H.create_session(
        client, counselor2["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )

    H.run_sweep()
    msgs = H.messages_of(member["id"], kind="reminder_3h")
    assert len(msgs) == 2
    assert {m["ref_id"] for m in msgs} == {s1["id"], s2["id"]}


def test_EDGE_naive_scheduled_at_도_tz_aware_로_처리된다(client):
    counselor = H.register_counselor("agr-naive-host@test.com")
    member = H.register_client(client, "agr-naive-mem@test.com")
    session = H.create_session(
        client, counselor["h"], [member["id"]], minutes_from_now=180, location_address=ADDRESS
    )
    # tz 정보를 뗀 값으로 저장(UTC 로 간주해야 한다)
    naive = (datetime.now(timezone.utc) + timedelta(minutes=180)).replace(tzinfo=None)
    H.set_scheduled_at(session["id"], naive)

    H.run_sweep()
    assert len(H.messages_of(member["id"], kind="reminder_3h")) == 1


# ── 보조 ───────────────────────────────────────────────────────


def _scheduled_text(session_id: str) -> str:
    from app.models.session import Session as SessionModel
    from app.services import agent_policy

    conn = H.db()
    try:
        s = conn.get(SessionModel, H._uuid(session_id))
        return agent_policy.format_schedule(s.scheduled_at)
    finally:
        conn.close()


def _set_phone(user_id: str, phone: str) -> None:
    from app.models.user import User

    conn = H.db()
    try:
        user = conn.get(User, H._uuid(user_id))
        user.phone = phone
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


def _set_waitlisted(session_id: str, user_id: str) -> None:
    from app.models.session import SessionParticipant

    conn = H.db()
    try:
        part = (
            conn.query(SessionParticipant)
            .filter(
                SessionParticipant.session_id == H._uuid(session_id),
                SessionParticipant.user_id == H._uuid(user_id),
            )
            .first()
        )
        part.is_waitlisted = True
        conn.commit()
    finally:
        conn.close()


def _target_users(session_id: str) -> list:
    from app.models.session import Session as SessionModel

    conn = H.db()
    try:
        s = conn.get(SessionModel, H._uuid(session_id))
        return [str(u.id) for u in agent_reminder.target_users(s, conn)]
    finally:
        conn.close()
