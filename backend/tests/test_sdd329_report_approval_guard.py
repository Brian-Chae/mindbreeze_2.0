"""SDD-329 B: 리포트 생성 중 승인이 끝났다면 승인 상태를 되돌리지 않는다 + 같은 리포트 동시 생성 차단."""
import pytest

from app.models.record import Report
from app.tasks import report_task
from tests.sdd237_helpers import build_class_world


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


@pytest.fixture(autouse=True)
def _no_side_effects(monkeypatch):
    monkeypatch.setattr(report_task, "_maybe_enqueue_class_narrative", lambda *a, **k: None)
    monkeypatch.setattr(report_task, "_maybe_enqueue_client_report_email", lambda *a, **k: None)
    monkeypatch.setattr(report_task, "_acquire_generation_lock", lambda rid: (True, None))


def _approve_in_other_session(report_id):
    """생성 도중 다른 트랜잭션(자동 승인)이 리포트를 승인·커밋한 상황."""
    from app.core.database import SessionLocal

    other = SessionLocal()
    try:
        r = other.query(Report).filter(Report.id == report_id).first()
        r.status = "completed"
        r.content = {**(r.content or {}), "approved": True}
        other.commit()
    finally:
        other.close()


def test_생성중_승인되면_저장후에도_completed_유지(db, monkeypatch):
    world = build_class_world(db, members=1)
    report = world["client_reports"][0]
    report.status = "pending_review"
    db.commit()
    rid = report.id

    real = report_task._attach_member_report

    def attach_then_approve(*a, **k):
        real(*a, **k)
        _approve_in_other_session(rid)  # 생성 후반(저장 직전) 승인이 끼어든다

    monkeypatch.setattr(report_task, "_attach_member_report", attach_then_approve)
    out = report_task.generate_report_inline(str(rid), db)
    db.expire_all()
    fresh = db.query(Report).filter(Report.id == rid).first()
    assert out is not None
    assert fresh.status == "completed"
    assert fresh.content.get("approved") is True


def test_승인되지_않은_리포트는_기존대로_pending_review(db):
    world = build_class_world(db, members=1)
    report = world["client_reports"][0]
    report.status = "pending_review"
    db.commit()
    report_task.generate_report_inline(str(report.id), db)
    db.expire_all()
    fresh = db.query(Report).filter(Report.id == report.id).first()
    assert fresh.status == "pending_review"
    assert not fresh.content.get("approved")


def test_이미_승인된_리포트_재생성은_승인_유지(db):
    world = build_class_world(db, members=1)
    report = world["client_reports"][0]
    report.status = "completed"
    report.content = {"approved": True}
    db.commit()
    report_task.generate_report_inline(str(report.id), db)
    db.expire_all()
    fresh = db.query(Report).filter(Report.id == report.id).first()
    assert fresh.status == "completed" and fresh.content.get("approved") is True


def test_역행_차단은_로그를_남긴다(db, monkeypatch, caplog):
    world = build_class_world(db, members=1)
    report = world["client_reports"][0]
    report.status = "pending_review"
    db.commit()
    rid = report.id
    real = report_task._attach_member_report
    monkeypatch.setattr(report_task, "_attach_member_report",
                        lambda *a, **k: (real(*a, **k), _approve_in_other_session(rid)))
    with caplog.at_level("WARNING"):
        report_task.generate_report_inline(str(rid), db)
    assert any("승인 역행 차단" in r.message for r in caplog.records)


def test_동시_생성은_락으로_하나만_진행(db, monkeypatch):
    world = build_class_world(db, members=1)
    report = world["client_reports"][0]
    monkeypatch.setattr(report_task, "_acquire_generation_lock", lambda rid: (False, None))
    called = {"n": 0}
    monkeypatch.setattr(report_task, "_generate_report_inline",
                        lambda *a, **k: called.__setitem__("n", called["n"] + 1))
    out = report_task.generate_report_inline(str(report.id), db)
    assert called["n"] == 0
    assert out is not None and out.id == report.id


def test_락_획득시_생성_진행후_해제(db, monkeypatch):
    world = build_class_world(db, members=1)
    report = world["client_reports"][0]
    released = []
    monkeypatch.setattr(report_task, "_acquire_generation_lock", lambda rid: (True, "tok"))
    monkeypatch.setattr(report_task, "_release_generation_lock", lambda rid, t: released.append(t))
    report_task.generate_report_inline(str(report.id), db)
    assert released == ["tok"]


def test_Redis_장애면_락없이_진행(monkeypatch):
    monkeypatch.undo()
    import app.services.pipeline_backlog_service as pbs

    def boom():
        raise ConnectionError("redis down")

    monkeypatch.setattr(pbs, "get_redis_client", boom)
    assert report_task._acquire_generation_lock("x") == (True, None)
