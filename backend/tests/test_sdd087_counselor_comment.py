"""SDD-087 — 상담사 코멘트 + AI(Gemini) 초안 QA

specs/087-counselor-comment-ai-draft/verify.md 기반:
- 코멘트 저장/삭제/길이 제한/상태·타입·권한 경계 (V1~V6)
- 노출: 메일 HTML·counselor 파생 표시·그룹 격리·재생성 이월 (V7~V11)
- AI 초안: 규칙 폴백·LLM 모킹·프롬프트 보강·자동 승인 자동 생성 (V12~V17)
"""

from uuid import UUID

from app.config import settings
from app.core.database import get_db
from app.main import app
from app.models.record import Report, SessionRecord
from app.models.session import SessionParticipant

from tests.test_audio_record import _register, _create_session


def _db():
    provider = app.dependency_overrides[get_db]()
    return next(provider)


def _add_participant(db, sid: str, user_id=None, guest_name=None):
    participant = SessionParticipant(
        session_id=UUID(sid),
        user_id=UUID(user_id) if user_id else None,
        guest_name=guest_name,
    )
    db.add(participant)
    db.commit()
    return participant


def _end_session(client, host, sid: str):
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text


def _client_report(db, sid: str) -> Report:
    return (
        db.query(Report)
        .filter(Report.session_id == UUID(sid), Report.type == "client")
        .one()
    )


def _counselor_report(db, sid: str) -> Report:
    return (
        db.query(Report)
        .filter(Report.session_id == UUID(sid), Report.type == "counselor")
        .one()
    )


def _setup_client_report(client, email: str, guest_name: str = "게스트"):
    """세션 종료 → pending_review client 리포트 1건 준비."""
    host = _register(client, email)
    sid = _create_session(client, host)
    db = _db()
    participant = _add_participant(db, sid, guest_name=guest_name)
    _end_session(client, host, sid)
    db.expire_all()
    report = _client_report(db, sid)
    assert report.status == "pending_review"
    return host, sid, db, participant, report


# ── 코멘트 저장 (B1/B2) ──────────────────────────────────────────


def test_01_코멘트_저장_및_content_반영(client):
    host, sid, db, _, report = _setup_client_report(client, "sdd087a@test.com")
    res = client.patch(
        f"/api/v1/reports/{report.id}/comment",
        json={"comment": "오늘 세션에 함께해 주셔서 감사합니다."},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["content"]["counselor_comment"] == "오늘 세션에 함께해 주셔서 감사합니다."
    db.expire_all()
    assert report.content["counselor_comment"] == "오늘 세션에 함께해 주셔서 감사합니다."


def test_02_1000자_초과는_422(client):
    host, _, _, _, report = _setup_client_report(client, "sdd087b@test.com")
    res = client.patch(
        f"/api/v1/reports/{report.id}/comment",
        json={"comment": "가" * 1001},
        headers=host["auth"],
    )
    assert res.status_code == 422, res.text


def test_03_null과_빈문자열은_삭제_빈문자열_저장금지(client):
    host, _, db, _, report = _setup_client_report(client, "sdd087c@test.com")
    client.patch(
        f"/api/v1/reports/{report.id}/comment",
        json={"comment": "지울 코멘트"},
        headers=host["auth"],
    )
    # null = 삭제
    res = client.patch(
        f"/api/v1/reports/{report.id}/comment", json={"comment": None}, headers=host["auth"]
    )
    assert res.status_code == 200, res.text
    db.expire_all()
    assert "counselor_comment" not in report.content
    # normalize 계약: 응답에서는 None 유지 (빈 문자열 치환 금지)
    assert res.json()["content"]["counselor_comment"] is None
    # 공백만 있는 문자열도 저장하지 않는다
    client.patch(
        f"/api/v1/reports/{report.id}/comment", json={"comment": "   "}, headers=host["auth"]
    )
    db.expire_all()
    assert "counselor_comment" not in report.content


def test_04_counselor_리포트에는_코멘트_불가_400(client):
    host, sid, db, _, _ = _setup_client_report(client, "sdd087d@test.com")
    counselor_report = _counselor_report(db, sid)
    res = client.patch(
        f"/api/v1/reports/{counselor_report.id}/comment",
        json={"comment": "코멘트"},
        headers=host["auth"],
    )
    assert res.status_code == 400, res.text


def test_05_completed_리포트_수정_400(client):
    """Q7 — 승인 후 콘텐츠 확정: completed 리포트 코멘트 수정 거부."""
    host, _, db, _, report = _setup_client_report(client, "sdd087e@test.com")
    assert (
        client.post(f"/api/v1/reports/{report.id}/approve", headers=host["auth"]).status_code
        == 200
    )
    res = client.patch(
        f"/api/v1/reports/{report.id}/comment",
        json={"comment": "늦은 코멘트"},
        headers=host["auth"],
    )
    assert res.status_code == 400, res.text


def test_06_그룹_격리_타_참가자_리포트에_미노출(client):
    """Q6 — 코멘트는 리포트(참가자) 단위."""
    host = _register(client, "sdd087f@test.com")
    sid = _create_session(client, host)
    db = _db()
    p_a = _add_participant(db, sid, guest_name="참가자A")
    _add_participant(db, sid, guest_name="참가자B")
    _end_session(client, host, sid)
    db.expire_all()
    reports = {
        rp.participant_id: rp
        for rp in db.query(Report)
        .filter(Report.session_id == UUID(sid), Report.type == "client")
        .all()
    }
    assert len(reports) == 2
    report_a = reports[p_a.id]
    report_b = next(rp for pid, rp in reports.items() if pid != p_a.id)
    res = client.patch(
        f"/api/v1/reports/{report_a.id}/comment",
        json={"comment": "A님에게만 전하는 말"},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    db.expire_all()
    assert report_a.content["counselor_comment"] == "A님에게만 전하는 말"
    assert "counselor_comment" not in report_b.content


def test_07_비호스트_상담사는_403(client):
    _, _, _, _, report = _setup_client_report(client, "sdd087g@test.com")
    other = _register(client, "sdd087g-other@test.com")
    res = client.patch(
        f"/api/v1/reports/{report.id}/comment",
        json={"comment": "남의 리포트"},
        headers=other["auth"],
    )
    assert res.status_code == 403, res.text


def test_08_코멘트_없이도_승인_가능(client):
    """Q4 — 기존 승인·발송 흐름 회귀 없음."""
    host, _, db, _, report = _setup_client_report(client, "sdd087h@test.com")
    res = client.post(f"/api/v1/reports/{report.id}/approve", headers=host["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "completed"
    assert res.json()["content"]["counselor_comment"] is None


# ── 노출 (B4/B5) + 이월 (B3) ─────────────────────────────────────


def test_09_메일_HTML에_코멘트_섹션_escape_노출(client):
    """Q3 — 저장 → 승인 → 메일 열람 HTML 코멘트 섹션."""
    from app.services import report_email_service

    host, sid, db, participant, report = _setup_client_report(client, "sdd087i@test.com")
    comment = "한 주간 <스스로>를 돌봐 주세요.\n다음에 뵙겠습니다."
    client.patch(
        f"/api/v1/reports/{report.id}/comment", json={"comment": comment}, headers=host["auth"]
    )
    client.post(f"/api/v1/reports/{report.id}/approve", headers=host["auth"])
    db.expire_all()
    participant.report_email = "guest87@example.com"
    db.commit()
    token = report_email_service._token(
        "report_view", str(report.id), sid, email="guest87@example.com"
    )
    res = client.get(f"/api/v1/sessions/{sid}/report-email/view", params={"token": token})
    assert res.status_code == 200, res.text
    assert "상담사 코멘트" in res.text
    # escape + pre-wrap: 원문 태그는 이스케이프되어야 한다
    assert "&lt;스스로&gt;" in res.text
    assert "<스스로>" not in res.text


def test_10_코멘트_없으면_메일_HTML에_섹션_미노출(client):
    from app.services import report_email_service

    host, sid, db, participant, report = _setup_client_report(client, "sdd087j@test.com")
    client.post(f"/api/v1/reports/{report.id}/approve", headers=host["auth"])
    db.expire_all()
    participant.report_email = "guest87j@example.com"
    db.commit()
    token = report_email_service._token(
        "report_view", str(report.id), sid, email="guest87j@example.com"
    )
    res = client.get(f"/api/v1/sessions/{sid}/report-email/view", params={"token": token})
    assert res.status_code == 200, res.text
    assert "상담사 코멘트" not in res.text


def test_11_counselor_리포트_상세에_client_코멘트_파생표시(client):
    host, sid, db, _, report = _setup_client_report(client, "sdd087k@test.com", guest_name="김민지")
    client.patch(
        f"/api/v1/reports/{report.id}/comment",
        json={"comment": "민지님께 전하는 말"},
        headers=host["auth"],
    )
    counselor_report = _counselor_report(db, sid)
    res = client.get(f"/api/v1/reports/{counselor_report.id}", headers=host["auth"])
    assert res.status_code == 200, res.text
    comments = res.json()["content"]["client_comments"]
    assert comments == [
        {
            "participant_id": str(report.participant_id),
            "participant_name": "김민지",
            "comment": "민지님께 전하는 말",
        }
    ]


def test_12_재생성시_코멘트_이월(client):
    """B3 — error → 재생성 시 content 통째 교체에도 코멘트 보존."""
    from app.tasks.report_task import generate_report_inline

    host, _, db, _, report = _setup_client_report(client, "sdd087l@test.com")
    client.patch(
        f"/api/v1/reports/{report.id}/comment",
        json={"comment": "이월될 코멘트"},
        headers=host["auth"],
    )
    db.expire_all()
    report.status = "error"
    db.commit()
    regenerated = generate_report_inline(str(report.id), db)
    assert regenerated.status == "pending_review"
    assert regenerated.content["counselor_comment"] == "이월될 코멘트"


# ── AI 초안 (B6~B8) ──────────────────────────────────────────────


def test_13_초안_규칙폴백_키없음_5xx없음(client, monkeypatch):
    """Q5 — LLM 키 부재 시 규칙 템플릿, source=rule."""
    monkeypatch.setattr(settings, "gemini_api_key", "")
    host, _, _, _, report = _setup_client_report(client, "sdd087m@test.com")
    res = client.post(f"/api/v1/reports/{report.id}/comment-draft", headers=host["auth"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "rule"
    assert body["draft"].strip()
    assert len(body["draft"]) <= 1000
    assert "임상심리상담" in body["draft"]


def test_14_초안_Gemini_호출실패도_규칙폴백(client, monkeypatch):
    """Q5 — 키가 있어도 호출 실패 시 폴백 (네트워크 없이 예외 유도)."""
    from app.services import report_comment_service

    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(report_comment_service, "_call_gemini", lambda prompt: None)
    host, _, _, _, report = _setup_client_report(client, "sdd087n@test.com")
    res = client.post(f"/api/v1/reports/{report.id}/comment-draft", headers=host["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["source"] == "rule"


def test_15_초안_LLM_성공시_source_llm_1000자_절단(client, monkeypatch):
    """Q2 — 데이터 전무 세션에서도 초안 생성, LLM 응답은 1000자 절단."""
    from app.services import report_comment_service

    monkeypatch.setattr(report_comment_service, "_call_gemini", lambda prompt: "다" * 1500)
    host, _, _, _, report = _setup_client_report(client, "sdd087o@test.com")
    res = client.post(f"/api/v1/reports/{report.id}/comment-draft", headers=host["auth"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "llm"
    assert body["draft"] == "다" * 1000


def test_16_초안_프롬프트에_세션메타와_ai_summary_반영(client, monkeypatch):
    """Q8 — 데이터 있는 세션은 ai_summary 가 프롬프트에 포함된다."""
    from app.services import report_comment_service

    captured: dict = {}

    def _capture(prompt: str):
        captured["prompt"] = prompt
        return "초안입니다."

    monkeypatch.setattr(report_comment_service, "_call_gemini", _capture)
    host, sid, db, _, report = _setup_client_report(client, "sdd087p@test.com", guest_name="박지훈")
    record = db.query(SessionRecord).filter(SessionRecord.session_id == UUID(sid)).first()
    if record is None:
        record = SessionRecord(session_id=UUID(sid))
        db.add(record)
    record.ai_summary = {"summary": "오늘은 수면 문제를 다뤘습니다.", "sections": {"주요 주제": "수면"}}
    record.counselor_notes = "다음 세션에 이완 훈련 도입 검토"
    db.commit()
    res = client.post(f"/api/v1/reports/{report.id}/comment-draft", headers=host["auth"])
    assert res.status_code == 200, res.text
    prompt = captured["prompt"]
    assert "임상심리상담" in prompt
    assert "박지훈" in prompt
    assert "오늘은 수면 문제를 다뤘습니다." in prompt
    assert "다음 세션에 이완 훈련 도입 검토" in prompt
    assert "인용하지 마세요" in prompt


def test_17_자동승인시_AI코멘트_자동생성_저장(client, monkeypatch):
    """B8 — auto_approve ON: 코멘트 없으면 AI 초안 자동 생성·저장 후 completed."""
    from app.services import report_comment_service

    monkeypatch.setattr(
        report_comment_service, "_call_gemini", lambda prompt: "자동 생성된 코멘트입니다."
    )
    host = _register(client, "sdd087q@test.com")
    assert (
        client.patch(
            "/api/v1/reports/auto-approve", json={"enabled": True}, headers=host["auth"]
        ).status_code
        == 200
    )
    sid = _create_session(client, host)
    db = _db()
    _add_participant(db, sid, guest_name="게스트")
    _end_session(client, host, sid)
    db.expire_all()
    report = _client_report(db, sid)
    assert report.status == "completed"
    assert report.content["counselor_comment"] == "자동 생성된 코멘트입니다."
    # counselor 리포트에는 코멘트를 저장하지 않는다 (파생 표시만)
    assert "counselor_comment" not in _counselor_report(db, sid).content


def test_18_자동승인_기존_코멘트는_덮어쓰지_않음(client, monkeypatch):
    """B8 — 이미 코멘트가 있으면 자동 생성이 덮어쓰지 않는다."""
    from app.services import report_comment_service
    from app.services.report_service import generate_client_reports_for_session

    monkeypatch.setattr(report_comment_service, "_call_gemini", lambda prompt: "새 자동 코멘트")
    host, sid, db, _, report = _setup_client_report(client, "sdd087r@test.com")
    client.patch(
        f"/api/v1/reports/{report.id}/comment",
        json={"comment": "상담사가 직접 쓴 코멘트"},
        headers=host["auth"],
    )
    assert (
        client.patch(
            "/api/v1/reports/auto-approve", json={"enabled": True}, headers=host["auth"]
        ).status_code
        == 200
    )
    db.expire_all()  # API가 다른 세션으로 저장한 코멘트를 반영
    generate_client_reports_for_session(sid, db)
    db.expire_all()
    assert report.status == "completed"
    assert report.content["counselor_comment"] == "상담사가 직접 쓴 코멘트"


def test_19_자동승인_규칙폴백으로도_빈리포트_발송없음(client, monkeypatch):
    """B8 + Q5 — LLM 실패 시에도 규칙 템플릿 코멘트가 채워진다."""
    monkeypatch.setattr(settings, "gemini_api_key", "")
    host = _register(client, "sdd087s@test.com")
    client.patch("/api/v1/reports/auto-approve", json={"enabled": True}, headers=host["auth"])
    sid = _create_session(client, host)
    db = _db()
    _add_participant(db, sid, guest_name="게스트")
    _end_session(client, host, sid)
    db.expire_all()
    report = _client_report(db, sid)
    assert report.status == "completed"
    assert report.content["counselor_comment"].strip()
