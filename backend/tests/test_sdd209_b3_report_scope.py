"""SDD-209 B3 — 리포트 전 경로 필터·무효화 (verify BT10~BT14, RV2-3·4·6, LG8, A3).

확정 결정 A3: 상담사 리포트 EEG 는 첫 참가자 1명이 아니라 '리포트 반영에 동의한 참가자 전원'의 집계.
제외한 참가자는 집계에서만 빠지고 저장은 그대로. 전원 제외면 EEG 를 비우고 안내만.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import Mock
from uuid import uuid4

import pytest

from app.core.database import get_db
from app.main import app
from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import Report, SessionRecord
from app.models.session import Session, SessionParticipant
from app.models.user import User

T0 = datetime(2026, 10, 17, 10, 0, 0, tzinfo=timezone.utc)
SEGMENTS = [
    {"speaker": "A", "text": "제외한 참가자의 발화입니다"},
    {"speaker": "B", "text": "동의한 참가자의 발화입니다"},
]


@pytest.fixture
def db(client):
    provider = app.dependency_overrides[get_db]()
    session = next(provider)
    yield session
    provider.close()


def _host(db):
    host = User(email=f"b3-{uuid4().hex[:8]}@test.com", name="상담사", role="counselor", password_hash="x")
    db.add(host)
    db.flush()
    return host


def _windows(db, session, participant, focus, count=120):
    for i in range(count):
        db.add(
            EEGFeatureWindow(
                session_id=session.id,
                participant_id=participant.id,
                window_index=i,
                quality="valid",
                device_timestamp_ms=float(int(T0.timestamp() * 1000) + i * 1000),
                focus_index=focus,
                relaxation_index=focus,
                stress_index=focus,
                emotional_stability=focus,
                cognitive_load=focus,
                total_neural_activity=focus,
                faa=0.1,
                hemispheric_balance=0.5,
            )
        )


def _class(db, *, mode="group", included=(True, False), focus=(70.0, 20.0)):
    """completed 클래스 + 참가자 N명(report_included=included[i], 각자 EEG focus) + 화자 분리 기록·영상."""
    host = _host(db)
    session = Session(
        host_id=host.id, type="meditation", status="completed", duration_min=10,
        participant_mode=mode, started_at=T0, ended_at=T0 + timedelta(seconds=130),
        title="B3 클래스",
    )
    db.add(session)
    db.flush()
    parts = []
    for i, (inc, f) in enumerate(zip(included, focus)):
        p = SessionParticipant(
            session_id=session.id, guest_name=f"참가자{i}", report_included=inc,
            report_email=f"p{i}@example.com", joined_at=T0 + timedelta(seconds=i),
        )
        db.add(p)
        db.flush()
        _windows(db, session, p, f)
        parts.append(p)
    db.add(
        SessionRecord(
            session_id=session.id, transcript="전사 원문", status="completed",
            ai_summary={"segments": SEGMENTS, "summary": "공통 요약"},
            video_s3_key="video/x/merged.webm", video_status="ready",
        )
    )
    db.commit()
    return host, session, parts


def _gen(db, host, session, kind, participant=None):
    from app.services import report_service

    return report_service.generate_report(
        str(session.id), str(host.id), kind, db,
        participant_id=str(participant.id) if participant else None,
    )


def test_BT10_상담사_리포트는_동의한_참가자만_집계(db):
    host, session, (p_in, p_out) = _class(db)
    only_in = _gen(db, host, session, "counselor")["content"]["eeg"]
    host2, session2, _ = _class(db, included=(True, True))
    both = _gen(db, host2, session2, "counselor")["content"]["eeg"]
    assert only_in["status"] not in ("not_measured", "lost")
    assert len(only_in["timeline"]) > 0
    # 동의 1명(70)만 집계한 값과 둘(70, 20) 평균이 달라야 한다 = 제외자 기여분 0
    assert [t["concentration"] for t in only_in["timeline"]] != [t["concentration"] for t in both["timeline"]]
    # 저장(원본 지표)은 그대로 — 제외 참가자 윈도우가 지워지지 않는다
    assert db.query(EEGFeatureWindow).filter(EEGFeatureWindow.participant_id == p_out.id).count() == 120


def test_BT10_첫_참가자가_제외여도_동의한_다른_참가자로_집계(db):
    host, session, _ = _class(db, included=(False, True), focus=(20.0, 70.0))
    report = _gen(db, host, session, "counselor")
    assert report["content"]["eeg"]["status"] not in ("not_measured", "lost")
    assert report["content"]["report_scope"]["included_participants"] == 1


def test_A3_그룹은_동의한_전원의_평균_1대1은_그_1명(db):
    h1, s1, _ = _class(db, included=(True, True, False), focus=(70.0, 30.0, 99.0))
    h2, s2, _ = _class(db, included=(True, False, False), focus=(70.0, 30.0, 99.0))
    avg = _gen(db, h1, s1, "counselor")["content"]["eeg"]
    one = _gen(db, h2, s2, "counselor")["content"]["eeg"]
    avg_conc = [t["concentration"] for t in avg["timeline"]]
    one_conc = [t["concentration"] for t in one["timeline"]]
    assert avg["status"] not in ("not_measured", "lost") and one["status"] not in ("not_measured", "lost")
    assert avg_conc != one_conc
    h3, s3, _ = _class(db, mode="individual", included=(True,), focus=(70.0,))
    solo = _gen(db, h3, s3, "counselor")["content"]["eeg"]
    assert [t["concentration"] for t in solo["timeline"]] == one_conc


def test_BT10_전원_제외면_EEG_비우고_안내만(db):
    host, session, _ = _class(db, included=(False, False))
    content = _gen(db, host, session, "counselor")["content"]
    assert content["eeg"]["status"] == "not_measured"
    assert content["eeg"]["notice"] == "참가자가 제외를 선택했어요"
    assert not content["eeg"].get("timeline")
    assert content["transcript_segments"] is None
    assert content["video"]["available"] is False


def test_BT13_제외자가_있으면_공통_기록_영상_요약_미포함_원본_유지(db):
    host, session, _ = _class(db, included=(True, False))
    content = _gen(db, host, session, "counselor")["content"]
    assert content["transcript_segments"] is None
    assert content["video"]["available"] is False
    assert content["ai_record"] == {"status": "not_available", "reason": "excluded"}
    record = db.query(SessionRecord).filter(SessionRecord.session_id == session.id).one()
    assert record.transcript == "전사 원문"
    assert record.video_s3_key == "video/x/merged.webm"
    assert record.ai_summary["segments"] == SEGMENTS


def test_BT13_전원_동의면_기록_영상_그대로(db):
    host, session, _ = _class(db, included=(True, True))
    content = _gen(db, host, session, "counselor")["content"]
    assert content["transcript_segments"] == SEGMENTS
    assert content["video"]["available"] is True


def test_BT10_제외한_참가자의_내담자_리포트는_행을_만들지_않는다(db):
    host, session, (p_in, p_out) = _class(db, included=(True, False))
    from app.services import report_service

    report_service.generate_client_reports_for_session(str(session.id), db)
    rows = db.query(Report).filter(Report.session_id == session.id, Report.type == "client").all()
    assert [r.participant_id for r in rows] == [p_in.id]


def test_BT10_수동_생성한_제외자_리포트는_안내만(db):
    host, session, (p_in, p_out) = _class(db, included=(True, False))
    report = _gen(db, host, session, "client", p_out)
    eeg = report["content"]["eeg"]
    assert eeg["status"] == "not_measured" and eeg["notice"] == "리포트에 반영되지 않아요"
    assert report["content"].get("ai_record", {}).get("status") != "available"


def test_BT12_AI_초안_입력에_제외자_데이터_없음(db):
    from app.services import report_comment_service as svc

    host, session, (p_out,) = _class(db, mode="individual", included=(False,), focus=(40.0,))
    report = _gen(db, host, session, "client", p_out)
    row = db.query(Report).filter(Report.id == report["id"]).one()
    ctx = svc._draft_context(row, session, db)
    assert "ai_summary" not in ctx and "counselor_notes" not in ctx and "eeg_narrative" not in ctx


def test_BT10_조회시_방어필터_구_스냅샷에서도_제외_기여분_제거(db):
    host, session, (p_in, p_out) = _class(db, included=(True, False))
    legacy = Report(
        session_id=session.id, user_id=host.id, participant_id=p_out.id, type="counselor",
        status="completed", generation_status="ready",
        content={
            "title": "구", "transcript_segments": SEGMENTS, "video": {"available": True, "status": "ready"},
            "ai_record": {"status": "available"},
            "eeg": {"status": "valid", "score": 55, "metrics": {}, "timeline": [{"t": 0, "concentration": 99}]},
        },
    )
    db.add(legacy)
    db.commit()
    from app.services import report_service

    got = report_service.get_report(str(legacy.id), str(host.id), db)
    c = got["content"]
    assert c["transcript_segments"] is None
    assert c["video"]["available"] is False
    assert c["eeg"]["status"] == "not_measured" and c["eeg"]["notice"] == "참가자가 제외를 선택했어요"
    listed = report_service.list_reports(str(host.id), db)["reports"]
    mine = [r for r in listed if r["id"] == str(legacy.id)][0]
    assert mine["content"]["transcript_segments"] is None


def test_BT10_구_내담자_리포트도_조회시_제외자는_안내로_대체(db):
    host, session, (p_in, p_out) = _class(db, included=(True, False))
    old = Report(
        session_id=session.id, user_id=None, participant_id=p_out.id, type="client",
        status="completed", generation_status="ready",
        content={"title": "내", "eeg": {"status": "valid", "score": 50, "metrics": {}, "timeline": []},
                 "counselor_comment": "코멘트"},
    )
    db.add(old)
    db.commit()
    from app.services import report_service

    got = report_service.list_reports(str(host.id), db)["reports"]
    row = [r for r in got if r["id"] == str(old.id)][0]
    assert row["content"]["eeg"]["status"] == "not_measured"
    assert row["content"]["counselor_comment"] is None


def test_BT14_선택_변경시_산출물_재생성(db):
    host, session, (p_in, p_out) = _class(db, included=(True, True))
    from app.services import report_service

    counselor = _gen(db, host, session, "counselor")
    assert counselor["content"]["transcript_segments"] == SEGMENTS
    client = _gen(db, host, session, "client", p_out)
    assert client["content"]["eeg"]["status"] not in ("not_measured", "lost")

    p = db.query(SessionParticipant).filter(SessionParticipant.id == p_out.id).one()
    p.report_included = False
    db.commit()
    assert report_service.refresh_reports_after_choice_change(session.id, p_out.id, db) == 2
    db.expire_all()
    c_rep = db.query(Report).filter(Report.session_id == session.id, Report.type == "counselor").one()
    k_rep = db.query(Report).filter(
        Report.session_id == session.id, Report.participant_id == p_out.id, Report.type == "client"
    ).one()
    assert c_rep.content["transcript_segments"] is None
    assert c_rep.content["report_scope"]["excluded_participants"] == 1
    assert k_rep.content["eeg"]["notice"] == "리포트에 반영되지 않아요"

    p = db.query(SessionParticipant).filter(SessionParticipant.id == p_out.id).one()
    p.report_included = True
    db.commit()
    report_service.refresh_reports_after_choice_change(session.id, p_out.id, db)
    db.expire_all()
    k_rep = db.query(Report).filter(Report.id == k_rep.id).one()
    assert k_rep.content["eeg"]["status"] not in ("not_measured", "lost")


def test_BT14_재생성_실패해도_제외_기여분은_즉시_걷어낸다(db, monkeypatch):
    host, session, (p_in, p_out) = _class(db, included=(True, True))
    from app.services import report_service

    _gen(db, host, session, "counselor")
    p = db.query(SessionParticipant).filter(SessionParticipant.id == p_out.id).one()
    p.report_included = False
    db.commit()
    monkeypatch.setattr(report_service, "generate_report_inline", Mock(side_effect=RuntimeError("boom")))
    report_service.refresh_reports_after_choice_change(session.id, p_out.id, db)
    db.expire_all()
    c_rep = db.query(Report).filter(Report.session_id == session.id, Report.type == "counselor").one()
    assert c_rep.content["transcript_segments"] is None


def test_BT11_메일_발송_링크_열람_제외자_차단(db, client, monkeypatch):
    from app.services import report_email_service as service

    host, session, (p_in, p_out) = _class(db, included=(True, False))
    rep_in = _gen(db, host, session, "client", p_in)
    rep_out = _gen(db, host, session, "client", p_out)
    for rid in (rep_in["id"], rep_out["id"]):
        r = db.query(Report).filter(Report.id == rid).one()
        r.status, r.generation_status = "completed", "ready"
    db.commit()
    sender = Mock(return_value=True)
    monkeypatch.setattr(service, "send_report_email", sender)

    assert service.deliver_report_email(rep_out["id"], db) == "excluded"
    assert service.deliver_report_email(rep_in["id"], db) == "sent"
    assert sender.call_count == 1

    token = sender.call_args.args[1].split("token=")[1]
    assert client.get(f"/api/v1/sessions/{session.id}/report-email/view", params={"token": token}).status_code == 200
    p = db.query(SessionParticipant).filter(SessionParticipant.id == p_in.id).one()
    p.report_included = False
    db.commit()
    assert client.get(f"/api/v1/sessions/{session.id}/report-email/view", params={"token": token}).status_code == 403
    with pytest.raises(Exception):
        service.get_report_view_content(token, db)


def test_BT11_메일_신청_제외자_거부(db, client):
    from app.services.email_verify_service import generate_email_verify_token
    from app.services.report_email_service import participant_token

    host, session, (p_in, p_out) = _class(db, included=(True, False))
    body = {
        "participant_id": str(p_out.id),
        "participant_token": participant_token(p_out),
        "email": "p1@example.com",
        "email_verify_token": generate_email_verify_token("p1@example.com"),
    }
    res = client.post(f"/api/v1/sessions/{session.id}/report-email", json=body)
    assert res.status_code == 409


def test_BT10_상담사_코멘트_파생_표시에서_제외자_코멘트_제거(db):
    host, session, (p_in, p_out) = _class(db, included=(True, False))
    for p in (p_in, p_out):
        db.add(Report(session_id=session.id, participant_id=p.id, type="client", status="pending_review",
                      content={"counselor_comment": f"코멘트-{p.guest_name}"}))
    db.commit()
    from app.services import report_service

    names = [c["participant_name"] for c in report_service._collect_client_comments(session.id, db)]
    assert names == [p_in.guest_name]


def test_AI_비서_입력은_제외자_리포트를_쓰지_않는다(db):
    from app.services import agent_policy

    host, session, (p_in, p_out) = _class(db, included=(True, False))
    user = User(email=f"c-{uuid4().hex[:6]}@test.com", name="내담자", role="client", password_hash="x")
    db.add(user)
    db.flush()
    p_out.user_id = user.id
    db.add(Report(session_id=session.id, user_id=user.id, participant_id=p_out.id, type="client",
                  status="completed", content={"headline": "h", "summary": "s"}))
    db.commit()
    assert agent_policy.approved_client_reports(user.id, db) == []
