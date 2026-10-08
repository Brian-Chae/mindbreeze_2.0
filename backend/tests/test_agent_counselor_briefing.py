"""SDD-189 — 상담사 브리핑 생성 QA (아침 일정 브리핑 · 저녁 상담 정리).

verify.md 시나리오: TS1(아침 브리핑), TS2(멱등), TS3(시각 윈도우), TS4(일정 없음),
TS5(저녁 정리), TS10(푸시 Outbox 비식별), TS11(LLM 폴백·가드) + Edge Cases.
"""

from unittest.mock import patch

from tests import agent_helpers as H

# 브리핑에 절대 나타나면 안 되는 표현 — 장소·연락처·길찾기(기획 §1.2-6)
FORBIDDEN_TOKENS = ("길찾기", "map.kakao.com", "주소", "전화", "연락처", "tel:")


def _setup(client, *, email_prefix: str, clients: list[str], hour: int = 9):
    """상담사 + 내담자별 1:1 세션 1건씩(오늘 KST hour 시부터 1시간 간격)."""
    counselor = H.register_counselor(f"{email_prefix}-c@test.com", name="김상담")
    members: list[dict] = []
    sessions: list[dict] = []
    for index, name in enumerate(clients):
        member = H.register_client(client, f"{email_prefix}-m{index}@test.com", name=name)
        # 1:1 세션(정원 1명)이므로 내담자마다 세션을 따로 만든다.
        session = H.create_session(
            client, counselor["h"], [member["id"]], minutes_from_now=200 + index * 60
        )
        H.set_scheduled_at(session["id"], H.kst_at(hour + index))
        H.link_client(counselor["id"], member["id"])
        members.append(member)
        sessions.append(session)
    return counselor, members, sessions[0]


# ── TS1: 아침 브리핑 생성 ─────────────────────────────────────────


def test_TS1_아침브리핑_실명_회차_온오프라인_포함하고_장소연락처_없음(client):
    counselor, members, session = _setup(
        client, email_prefix="cb-ts1", clients=["박내담", "최내담"]
    )
    # 승인 대기 리포트 1건 — 아침 브리핑에 건수가 들어가야 한다.
    H.create_report(session["id"], user_id=members[0]["id"], status="pending_review")

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    briefings = H.counselor_messages(counselor["id"], kind="briefing_morning")
    assert len(briefings) == 1, briefings
    content = briefings[0]["content"]

    assert "오늘 상담 2건이 있어요." in content
    assert "박내담" in content and "최내담" in content
    assert "1회차" in content
    assert "오프라인" in content
    assert "승인 대기 리포트 1건" in content
    for token in FORBIDDEN_TOKENS:
        assert token not in content, f"브리핑에 {token} 가 들어갔다: {content}"

    # CTA 는 모두 상담사 채널 이동형이다.
    actions = {c["action"] for c in briefings[0]["cta"]}
    assert "open_schedule" in actions
    assert "open_report" in actions
    assert actions <= {
        "open_schedule", "open_client", "open_record", "open_report", "open_change_requests"
    }


def test_TS1_미확인_예약과_일정변경문의가_아침브리핑에_들어간다(client):
    counselor, members, session = _setup(client, email_prefix="cb-ts1b", clients=["박내담"])

    # 내담자가 일정 변경 문의를 남긴다(SDD-188 relay event).
    conn = H.db()
    try:
        from app.services import agent_service

        agent_service.create_relay_event(
            conn,
            kind="schedule_change_request",
            source_user_id=members[0]["id"],
            target_user_id=counselor["id"],
            session_id=session["id"],
            payload={"reason": "그 시간에 회의가 생겼어요"},
            commit=True,
        )
    finally:
        conn.close()

    H.run_briefing_sweep(now=H.kst_at(8, 0))
    content = H.counselor_messages(counselor["id"], kind="briefing_morning")[0]["content"]

    assert "예약 안내를 아직 확인하지 않은 내담자" in content
    assert "박내담" in content
    assert "일정 변경 문의 1건" in content
    # 변경 사유는 상담사가 판단해야 하므로 원문 그대로 실린다.
    assert "그 시간에 회의가 생겼어요" in content


# ── TS2: 멱등 ────────────────────────────────────────────────────


def test_TS2_스윕_재실행해도_메시지와_로그_각각_1건(client):
    counselor, _, _ = _setup(client, email_prefix="cb-ts2", clients=["박내담"])

    for _ in range(4):
        H.run_briefing_sweep(now=H.kst_at(8, 0))

    assert len(H.counselor_messages(counselor["id"], kind="briefing_morning")) == 1
    logs = [log for log in H.briefing_logs(counselor["id"]) if log["kind"] == "morning"]
    assert len(logs) == 1


# ── TS3: 시각 윈도우 (지정 시각 + 30분 보정) ──────────────────────


def test_TS3_지정시각_이전에는_생성되지_않는다(client):
    counselor, _, _ = _setup(client, email_prefix="cb-ts3a", clients=["박내담"])

    H.run_briefing_sweep(now=H.kst_at(7, 59))

    assert H.counselor_messages(counselor["id"], kind="briefing_morning") == []


def test_TS3_20분_지연은_보정_생성된다(client):
    counselor, _, _ = _setup(client, email_prefix="cb-ts3b", clients=["박내담"])

    H.run_briefing_sweep(now=H.kst_at(8, 20))

    assert len(H.counselor_messages(counselor["id"], kind="briefing_morning")) == 1


def test_TS3_30분_초과_지연은_생성되지_않는다(client):
    counselor, _, _ = _setup(client, email_prefix="cb-ts3c", clients=["박내담"])

    H.run_briefing_sweep(now=H.kst_at(8, 40))

    assert H.counselor_messages(counselor["id"], kind="briefing_morning") == []


# ── TS4: 일정 없음 ────────────────────────────────────────────────


def test_TS4_일정없고_건너뛰기_켜짐이면_생성되지_않는다(client):
    counselor = H.register_counselor("cb-ts4a-c@test.com")
    H.set_counselor_settings(counselor["id"], skip_no_session_days=True)

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    assert H.counselor_messages(counselor["id"]) == []
    assert H.briefing_logs(counselor["id"]) == []


def test_TS4_일정없고_건너뛰기_꺼짐이면_일정없음_메시지_1건(client):
    counselor = H.register_counselor("cb-ts4b-c@test.com")
    H.set_counselor_settings(counselor["id"], skip_no_session_days=False)

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    briefings = H.counselor_messages(counselor["id"], kind="briefing_morning")
    assert len(briefings) == 1
    assert "오늘 일정이 없어요" in briefings[0]["content"]


# ── TS5: 저녁 정리 ────────────────────────────────────────────────


def test_TS5_저녁정리_요약_기록없음_불참_리포트_피드백_내일일정(client):
    counselor = H.register_counselor("cb-ts5-c@test.com")
    with_summary = H.register_client(client, "cb-ts5-m1@test.com", name="박내담")
    no_record = H.register_client(client, "cb-ts5-m2@test.com", name="최내담")
    absent = H.register_client(client, "cb-ts5-m3@test.com", name="이내담")

    # 오늘 진행 완료 2건 — 하나는 AI 요약 있음, 하나는 기록 없음
    s1 = H.create_session(client, counselor["h"], [with_summary["id"]])
    H.set_scheduled_at(s1["id"], H.kst_at(9))
    H.set_session_status(s1["id"], "completed")
    H.set_ai_summary(
        s1["id"],
        {
            "headline": "직장에서의 긴장과 수면 패턴을 함께 살펴봤다",
            "sections": {"주요 이슈": "업무 압박으로 밤에 잠들기 어렵다고 이야기했다"},
            "keywords": ["수면", "업무 압박", "가족 관계"],
        },
    )
    s2 = H.create_session(client, counselor["h"], [no_record["id"]], minutes_from_now=260)
    H.set_scheduled_at(s2["id"], H.kst_at(11))
    H.set_session_status(s2["id"], "completed")

    # 불참 1건 — 참여 행의 joined_at 을 비운다
    s3 = H.create_session(client, counselor["h"], [absent["id"]], minutes_from_now=320)
    H.set_scheduled_at(s3["id"], H.kst_at(13))
    H.set_session_status(s3["id"], "completed")
    H.set_joined_at(s3["id"], absent["id"], None)

    # 내일 일정 1건
    s4 = H.create_session(client, counselor["h"], [with_summary["id"]], minutes_from_now=380)
    H.set_scheduled_at(s4["id"], H.kst_at(10, day_offset=1))

    # 리포트 승인 대기 + 내담자 피드백(원문 포함)
    H.create_report(s1["id"], user_id=with_summary["id"], status="pending_review")
    conn = H.db()
    try:
        from app.services import agent_service

        agent_service.create_relay_event(
            conn,
            kind="feedback",
            source_user_id=with_summary["id"],
            target_user_id=counselor["id"],
            session_id=s1["id"],
            payload={"choice": "disappointed", "texts": ["제 말을 좀 더 들어주셨으면 했어요"]},
            commit=True,
        )
    finally:
        conn.close()

    H.run_briefing_sweep(now=H.kst_at(21, 0))

    briefings = H.counselor_messages(counselor["id"], kind="briefing_evening")
    assert len(briefings) == 1, briefings
    content = briefings[0]["content"]

    assert "다룬 이야기: 직장에서의 긴장과 수면 패턴을 함께 살펴봤다" in content
    assert "기록 없음" in content
    # 섹션에 등장하지 않은 키워드만 남은 주제 후보가 된다
    assert "남은 주제 후보" in content and "가족 관계" in content
    assert "참석 기록이 없는 내담자" in content and "이내담" in content
    assert "승인 대기 리포트 1건" in content
    assert "내담자 피드백 1건" in content
    assert "아쉬웠어요" in content
    # D10: 자유 서술은 원문 그대로
    assert "제 말을 좀 더 들어주셨으면 했어요" in content
    assert "내일 일정 1건" in content

    for token in FORBIDDEN_TOKENS:
        assert token not in content, f"저녁 정리에 {token} 가 들어갔다"
    # 진단·점수 표현 없음
    assert "점수" not in content and "진단" not in content


def test_TS5_기록없는_세션만_있어도_오류없이_생성된다(client):
    """Edge: 마이크 오프/기록 없음 세션에서 저녁 정리가 깨지지 않는다."""
    counselor = H.register_counselor("cb-ts5b-c@test.com")
    member = H.register_client(client, "cb-ts5b-m@test.com", name="박내담")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(9))
    H.set_session_status(session["id"], "completed")
    H.set_ai_summary(session["id"], None, status="manual")

    H.run_briefing_sweep(now=H.kst_at(21, 0))

    briefings = H.counselor_messages(counselor["id"], kind="briefing_evening")
    assert len(briefings) == 1
    assert "기록 없음" in briefings[0]["content"]


# ── Edge Cases ───────────────────────────────────────────────────


def test_EDGE_같은_내담자_하루_2세션은_각각_항목으로_나온다(client):
    counselor = H.register_counselor("cb-edge1-c@test.com")
    member = H.register_client(client, "cb-edge1-m@test.com", name="박내담")
    s1 = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(s1["id"], H.kst_at(9))
    s2 = H.create_session(client, counselor["h"], [member["id"]], minutes_from_now=300)
    H.set_scheduled_at(s2["id"], H.kst_at(15))

    H.run_briefing_sweep(now=H.kst_at(8, 0))
    content = H.counselor_messages(counselor["id"], kind="briefing_morning")[0]["content"]

    assert "오늘 상담 2건" in content
    assert "09:00" in content and "15:00" in content
    # 회차는 세션 순서대로 1회차·2회차가 매겨진다
    assert "1회차" in content and "2회차" in content


def test_EDGE_취소된_세션은_취소로_표시된다(client):
    counselor, _, session = _setup(client, email_prefix="cb-edge2", clients=["박내담"])
    H.set_session_status(session["id"], "cancelled")

    H.run_briefing_sweep(now=H.kst_at(8, 0))
    content = H.counselor_messages(counselor["id"], kind="briefing_morning")[0]["content"]

    assert "취소됨" in content
    assert "오늘 상담 0건" in content


def test_EDGE_설정행이_없어도_기본값으로_동작하고_행이_생성된다(client):
    counselor, _, _ = _setup(client, email_prefix="cb-edge3", clients=["박내담"])

    # 설정을 한 번도 건드리지 않은 상담사 — 기본 08:00 으로 아침 브리핑이 나온다
    H.run_briefing_sweep(now=H.kst_at(8, 0))

    assert len(H.counselor_messages(counselor["id"], kind="briefing_morning")) == 1
    conn = H.db()
    try:
        from app.models.agent import AgentCounselorSettings

        row = (
            conn.query(AgentCounselorSettings)
            .filter(AgentCounselorSettings.user_id == H._uuid(counselor["id"]))
            .first()
        )
        assert row is not None
        assert row.morning_time == "08:00" and row.evening_time == "21:00"
    finally:
        conn.close()


def test_EDGE_아침_꺼짐이면_아침만_생성되지_않는다(client):
    counselor, _, _ = _setup(client, email_prefix="cb-edge4", clients=["박내담"])
    H.set_counselor_settings(counselor["id"], morning_enabled=False)

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    assert H.counselor_messages(counselor["id"], kind="briefing_morning") == []


def test_EDGE_피드백_자유서술이_없어도_선택만_표시된다(client):
    counselor = H.register_counselor("cb-edge5-c@test.com")
    member = H.register_client(client, "cb-edge5-m@test.com", name="박내담")
    session = H.create_session(client, counselor["h"], [member["id"]])
    H.set_scheduled_at(session["id"], H.kst_at(9))
    H.set_session_status(session["id"], "completed")

    conn = H.db()
    try:
        from app.services import agent_service

        agent_service.create_relay_event(
            conn,
            kind="feedback",
            source_user_id=member["id"],
            target_user_id=counselor["id"],
            session_id=session["id"],
            payload={"choice": "helpful", "texts": []},
            commit=True,
        )
    finally:
        conn.close()

    H.run_briefing_sweep(now=H.kst_at(21, 0))
    content = H.counselor_messages(counselor["id"], kind="briefing_evening")[0]["content"]

    assert "도움이 됐어요" in content


# ── TS10: 푸시 Outbox 비식별 ──────────────────────────────────────


def test_TS10_푸시_Outbox는_pending이고_이름_상담내용이_없다(client):
    counselor, _, _ = _setup(client, email_prefix="cb-ts10", clients=["박내담"])

    H.run_briefing_sweep(now=H.kst_at(8, 0))

    rows = H.outbox_rows("push")
    assert len(rows) == 1, rows
    row = rows[0]
    assert row["status"] == "pending"
    payload = row["payload"]
    assert payload["title"] == "AI 비서"
    assert payload["body"] == "AI 비서가 브리핑을 보냈어요"
    assert payload["deeplink"] == "/agent"
    assert payload["message_id"]
    # payload 전체에 내담자 이름·상담 내용이 없다
    serialized = str(payload)
    assert "박내담" not in serialized
    assert "임상심리상담" not in serialized


# ── TS11: LLM 폴백 · 가드 ────────────────────────────────────────


def test_TS11_LLM_키_없으면_템플릿만으로_브리핑이_나온다(client):
    counselor, _, _ = _setup(client, email_prefix="cb-ts11a", clients=["박내담"])

    with patch("app.services.agent_llm.is_enabled", return_value=False):
        H.run_briefing_sweep(now=H.kst_at(8, 0))

    briefings = H.counselor_messages(counselor["id"], kind="briefing_morning")
    assert len(briefings) == 1
    assert "오늘 상담 1건이 있어요." in briefings[0]["content"]


def test_TS11_LLM_예외시에도_템플릿으로_폴백한다(client):
    counselor, _, _ = _setup(client, email_prefix="cb-ts11b", clients=["박내담"])

    with patch("app.services.agent_llm.is_enabled", return_value=True), patch(
        "app.services.report_comment_service._call_gemini",
        side_effect=RuntimeError("provider down"),
    ):
        H.run_briefing_sweep(now=H.kst_at(8, 0))

    briefings = H.counselor_messages(counselor["id"], kind="briefing_morning")
    assert len(briefings) == 1
    assert "박내담" in briefings[0]["content"]


def test_TS11_LLM이_진단_점수_표현을_내면_걸러진다(client):
    counselor, _, _ = _setup(client, email_prefix="cb-ts11c", clients=["박내담"])

    with patch("app.services.agent_llm.is_enabled", return_value=True), patch(
        "app.services.report_comment_service._call_gemini",
        return_value="내담자는 우울증으로 보입니다. 스트레스 점수는 82점입니다.",
    ):
        H.run_briefing_sweep(now=H.kst_at(8, 0))

    content = H.counselor_messages(counselor["id"], kind="briefing_morning")[0]["content"]
    assert "우울증" not in content
    assert "82점" not in content
    # 사실 템플릿은 그대로 남는다
    assert "박내담" in content
