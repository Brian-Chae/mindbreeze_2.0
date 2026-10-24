"""SDD-237 B6/S24·S25: 명상 자동 승인 — 무데이터 리포트 제외, 자동 초안에서 비공개 메모 제외."""

import uuid

import pytest

from app.models.record import Report, SessionRecord
from app.models.session import Session
from app.services import notification_service, report_comment_service, report_email_service, report_service
from tests.sdd237_helpers import add_record, build_class_world


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    session = next(app.dependency_overrides[get_db]())
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def world(client, db, monkeypatch):
    w = build_class_world(db, members=3, host_extra={"auto_approve_report": True})
    for r in w["client_reports"]:
        r.generation_status = "ready"
    monkeypatch.setattr(report_email_service, "enqueue_report_email", lambda *a, **k: None)
    monkeypatch.setattr(report_comment_service, "_call_gemini", lambda *a, **k: None)  # 실제 AI 호출 금지
    db.commit()
    return w


def _set(db, report, eeg):
    report.status = "pending_review"
    report.generation_status = "ready"
    report.content = {"eeg": eeg} if eeg is not None else {}
    db.commit()


def test_자동_승인_켬_명상_무데이터_리포트는_검토_대기로_남고_부작용이_없다(world, db, monkeypatch):
    approved, notified = [], []
    real_approve = report_service.approve_report
    monkeypatch.setattr(report_service, "approve_report",
                        lambda rid, hid, d: approved.append(rid) or real_approve(rid, hid, d))
    monkeypatch.setattr(notification_service, "notify_event", lambda *a, **k: notified.append(a))
    a, b, c = world["client_reports"]
    _set(db, a, {"status": "not_measured"})
    _set(db, b, None)
    _set(db, c, {"status": "valid"})
    report_service.generate_client_reports_for_session(str(world["session"].id), db)
    db.expire_all()
    assert db.get(Report, a.id).status == "pending_review"
    assert db.get(Report, b.id).status == "pending_review"
    assert db.get(Report, c.id).status == "completed"            # 측정 리포트는 종전대로 즉시 승인
    assert approved == [str(c.id)]
    assert {n[1] for n in notified} == {c.user_id}                # 알림은 승인된 c 에게만(a·b 에게는 0)


def test_무데이터_리포트도_수동_승인은_가능하다(world, db):
    a = world["client_reports"][0]
    _set(db, a, {"status": "not_measured"})
    report_service.generate_client_reports_for_session(str(world["session"].id), db)
    out = report_service.approve_report(str(a.id), str(world["host"].id), db)
    assert out["status"] == "completed"


def test_자동_승인_끔이면_측정_여부와_무관하게_검토_대기(world, db):
    world["host"].auto_approve_report = False
    a, b, c = world["client_reports"]
    _set(db, a, {"status": "valid"})
    _set(db, b, {"status": "not_measured"})
    _set(db, c, {"status": "valid"})
    report_service.generate_client_reports_for_session(str(world["session"].id), db)
    db.expire_all()
    assert {db.get(Report, r.id).status for r in (a, b, c)} == {"pending_review"}


def test_리포트_반영_제외_안내_리포트는_종전_동작을_유지한다(world, db):
    a = world["client_reports"][0]
    _set(db, a, {"status": "not_measured", "excluded": True})
    world["participants"][0].report_included = False
    db.commit()
    report_service.generate_client_reports_for_session(str(world["session"].id), db)
    db.expire_all()
    assert db.get(Report, a.id).status == "completed"


def test_상담_도메인은_무데이터여도_종전대로_자동_승인한다(world, db, monkeypatch):
    """분기는 report_domain == meditation 에서만 적용된다. 상담 판정은 변경 전과 같다."""
    assert report_service.report_domain(Session(class_id=None)) == "counseling"
    assert report_service._skip_auto_approve_no_data(Session(class_id=None),
                                                     Report(content={"eeg": {"status": "not_measured"}})) is False
    meditation = Session(class_id=uuid.uuid4())
    assert report_service._skip_auto_approve_no_data(meditation, Report(content={"eeg": {"status": "not_measured"}})) is True
    assert report_service._skip_auto_approve_no_data(meditation, Report(content={})) is True
    assert report_service._skip_auto_approve_no_data(meditation, Report(content={"eeg": {"status": "valid"}})) is False
    assert report_service._skip_auto_approve_no_data(
        meditation, Report(content={"eeg": {"status": "not_measured", "excluded": True}})) is False
    for status in ("degraded", "invalid", "lost", "insufficient"):  # 품질 경고는 본체 SDD 범위 — 이번엔 종전 그대로
        assert report_service._skip_auto_approve_no_data(meditation, Report(content={"eeg": {"status": status}})) is False


# ── S25 자동 초안 입력에서 비공개 메모 제외 ─────────────────────────
def _capture_context(monkeypatch):
    seen = []

    def fake(context):
        seen.append(dict(context))
        return "초안", "rule"

    monkeypatch.setattr(report_comment_service, "_generate_draft", fake)
    return seen


def test_명상_자동_승인_초안_입력에_counselor_notes가_없다(world, db, monkeypatch):
    seen = _capture_context(monkeypatch)
    add_record(db, world["session"], "비공개 메모: 민감한 내용")
    # 그룹이 아닌 값으로 바꿔도(방어) 명상 자동 승인 경로는 메모를 쓰지 않는다
    world["session"].participant_mode = "one_on_one"
    db.commit()
    a = world["client_reports"][0]
    _set(db, a, {"status": "valid"})
    report_service.generate_client_reports_for_session(str(world["session"].id), db)
    assert seen, "자동 초안이 생성돼야 한다"
    for ctx in seen:
        assert "counselor_notes" not in ctx
        assert "민감한 내용" not in str(ctx)


def test_include_private_notes_기본값은_현행_유지_상담_불변(world, db, monkeypatch):
    seen = _capture_context(monkeypatch)
    add_record(db, world["session"], "상담사 메모")
    world["session"].participant_mode = "one_on_one"
    db.commit()
    a = world["client_reports"][0]
    a.content = {"eeg": {"status": "valid"}}
    db.commit()
    report_comment_service.ensure_auto_comment(a, db)                           # 기본값
    assert seen[-1].get("counselor_notes") == "상담사 메모"
    a2 = world["client_reports"][1]
    a2.content = {"eeg": {"status": "valid"}}
    report_comment_service.ensure_auto_comment(a2, db, include_private_notes=False)
    assert "counselor_notes" not in seen[-1]
