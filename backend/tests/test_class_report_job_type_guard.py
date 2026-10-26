"""SDD-237 B6/P8: 일괄 작업·일괄 승인·대시보드 대기 수에 상담사용 클래스 리포트가 섞이지 않는다."""

import uuid

import pytest

from app.models.record import Report
from app.models.session import Session
from app.services import class_report_job_service as jobs
from app.services import dashboard_service, report_service
from tests.sdd237_helpers import build_class_world, make_user


@pytest.fixture(autouse=True)
def _enable(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)


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
def world(client, db):
    return build_class_world(db, members=2)


def test_classify_target은_counselor_리포트를_not_target으로_제외한다(world, db):
    assert jobs.classify_target(db, world["host"], world["counselor_report"]) == ("excluded", "not_target")
    assert jobs.classify_target(db, world["host"], world["client_reports"][0]) == ("pending", None)


def test_type_가드는_권한_검사보다_앞서므로_권한_없는_사용자에게도_not_target(world, db):
    stranger = make_user(db, name="무관")
    db.commit()
    assert jobs.classify_target(db, stranger, world["counselor_report"]) == ("excluded", "not_target")


def test_accept_job은_counselor_대상을_접수해도_처리하지_않는다(world, db, monkeypatch):
    calls = []
    monkeypatch.setattr(report_service, "approve_report", lambda *a, **k: calls.append(a))
    targets = [str(world["counselor_report"].id), str(world["client_reports"][0].id)]
    res = jobs.accept_job(db, actor_id=world["host"].id, class_id=world["cls"].id, action="approve",
                          operation_key="op-" + uuid.uuid4().hex[:8], targets=targets,
                          session_id=world["session"].id)
    assert res["accepted"] == 1
    jobs.run_job(db, res["job_id"])
    assert len(calls) == 1 and calls[0][0] == str(world["client_reports"][0].id)
    db.expire_all()
    assert db.get(Report, world["counselor_report"].id).status == "pending_review"


def test_approve_all은_클래스_회차의_counselor_리포트를_승인하지_않는다(world, db, monkeypatch):
    from app.services import report_email_service
    monkeypatch.setattr(report_email_service, "enqueue_report_email", lambda *a, **k: None)
    out = report_service.approve_all_reports(str(world["host"].id), db)
    db.expire_all()
    assert out == {"approved": 2}
    assert db.get(Report, world["counselor_report"].id).status == "pending_review"
    assert all(db.get(Report, r.id).status == "completed" for r in world["client_reports"])


def test_approve_all은_상담_도메인_counselor_리포트를_종전대로_승인한다(world, db):
    s = Session(id=uuid.uuid4(), type="clinical", status="completed", host_id=world["host"].id,
                is_template=True, duration_min=50)
    db.add(s)
    db.flush()
    rep = Report(id=uuid.uuid4(), session_id=s.id, user_id=world["host"].id, type="counselor",
                 status="pending_review", generation_status="ready", content={})
    db.add(rep)
    db.commit()
    # 클래스 회차 리포트를 먼저 모두 비워 상담 건만 남긴다
    for r in world["client_reports"]:
        r.status = "completed"
    db.commit()
    out = report_service.approve_all_reports(str(world["host"].id), db)
    db.expire_all()
    assert out == {"approved": 1}
    assert db.get(Report, rep.id).status == "completed"


def test_대시보드_승인_대기_수는_클래스_회차의_counselor_리포트를_세지_않는다(world, db):
    summaries = dashboard_service._build_summaries([world["session"]], db)
    assert summaries[0]["report_count"] == 3
    assert summaries[0]["pending_review_count"] == 2  # client 2건만, counselor 1건 제외


def test_대시보드_상담_회차는_counselor_리포트를_종전대로_센다(world, db):
    s = Session(id=uuid.uuid4(), type="clinical", status="completed", host_id=world["host"].id,
                is_template=True, duration_min=50)
    db.add(s)
    db.flush()
    db.add(Report(id=uuid.uuid4(), session_id=s.id, user_id=world["host"].id, type="counselor",
                  status="pending_review", generation_status="ready", content={}))
    db.commit()
    assert dashboard_service._build_summaries([s], db)[0]["pending_review_count"] == 1
