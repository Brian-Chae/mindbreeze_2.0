"""리포트 자동 승인 기본값 켜짐 (대표 결정 2026-10-28) + 무데이터 명상 제외(SDD-237) 유지."""

import pytest

from app.models.record import Report
from app.models.user import User
from app.services import report_comment_service, report_email_service, report_service
from tests.sdd237_helpers import build_class_world, make_user


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


def test_새_상담사의_자동_승인_기본값은_켜짐(db):
    u = make_user(db, role="counselor")
    db.commit()
    db.expire_all()
    assert db.get(User, u.id).auto_approve_report is True
    assert report_service.get_auto_approve_setting(str(u.id), db) == {"enabled": True}


def test_서버_기본값_메타데이터는_true():
    col = User.__table__.c.auto_approve_report
    assert col.default.arg is True
    assert str(col.server_default.arg) == "true"


def test_기본값_상담사도_무데이터_명상_리포트는_자동_승인_제외(db, monkeypatch):
    w = build_class_world(db, members=2)  # host_extra 없음 → 모델 기본값
    assert w["host"].auto_approve_report is True
    monkeypatch.setattr(report_email_service, "enqueue_report_email", lambda *a, **k: None)
    monkeypatch.setattr(report_comment_service, "_call_gemini", lambda *a, **k: None)
    a, b = w["client_reports"]
    for r, eeg in ((a, {"status": "valid"}), (b, {"status": "not_measured"})):
        r.status, r.generation_status, r.content = "pending_review", "ready", {"eeg": eeg}
    db.commit()
    report_service.generate_client_reports_for_session(str(w["session"].id), db)
    db.expire_all()
    assert db.get(Report, a.id).status == "completed"
    assert db.get(Report, b.id).status == "pending_review"
