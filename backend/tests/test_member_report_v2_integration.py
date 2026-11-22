"""SDD-328 B5·B6 — v2 저장 연결(report_task)·조회 API·PDF 분기·v1 롤백 플래그(합성 DB, 외부 호출 없음)."""

import pytest

from app.schemas.member_report import MemberReport
from app.schemas.member_report_v2 import MemberReportV2
from app.services import member_report_builder as v1
from app.services import member_report_v2_builder as v2b
from app.tasks import report_task
from tests.sdd237_helpers import build_class_world
from tests.test_member_report_builder import _approved_report, _auth, _fill, db  # noqa: F401


@pytest.fixture(autouse=True)
def _no_side_effects(monkeypatch):
    monkeypatch.setattr(report_task, "_maybe_enqueue_class_narrative", lambda *a, **k: None)
    monkeypatch.setattr(v1, "_raw_array", lambda *a, **k: None)  # 원시 EEG(S3) 접근 금지
    monkeypatch.delenv("MEMBER_REPORT_SCHEMA", raising=False)


def test_기본은_v2로_저장된다(db):
    world = build_class_world(db, members=2, duration_min=64)
    for i, p in enumerate(world["participants"]):
        _fill(db, world, p, 60, seed=i)
    report = world["client_reports"][0]
    report_task.generate_report_inline(str(report.id), db)
    db.refresh(report)
    mr = report.content["member_report"]
    assert mr["schema_version"] == "member_report.v2"
    MemberReportV2.model_validate(mr)
    assert "eeg" in report.content  # 기존 서사형 경로 보존


def test_플래그_v1이면_v1_생성(db, monkeypatch):
    monkeypatch.setenv("MEMBER_REPORT_SCHEMA", "v1")
    world = build_class_world(db, members=1, duration_min=64)
    _fill(db, world, world["participants"][0], 60)
    report = world["client_reports"][0]
    report_task.generate_report_inline(str(report.id), db)
    db.refresh(report)
    assert report.content["member_report"]["schema_version"] == "member_report.v1"
    MemberReport.model_validate(report.content["member_report"])


def test_v2_생성_실패시_이전_member_report를_이월한다(db, monkeypatch):
    world = build_class_world(db, members=1, duration_min=64)
    _fill(db, world, world["participants"][0], 60)
    report = world["client_reports"][0]
    report_task.generate_report_inline(str(report.id), db)
    db.refresh(report)
    first = report.content["member_report"]

    def boom(*a, **k):
        raise RuntimeError("실패")

    monkeypatch.setattr(v2b, "build_member_report_v2", boom)
    report_task.generate_report_inline(str(report.id), db)
    db.refresh(report)
    assert report.status != "error" and report.content["member_report"] == first


def test_v1_저장분을_재산출하면_v2로_덮어쓴다(db, monkeypatch):
    monkeypatch.setenv("MEMBER_REPORT_SCHEMA", "v1")
    world = build_class_world(db, members=1, duration_min=64)
    _fill(db, world, world["participants"][0], 60)
    report = world["client_reports"][0]
    report_task.generate_report_inline(str(report.id), db)
    db.refresh(report)
    assert report.content["member_report"]["schema_version"] == "member_report.v1"
    monkeypatch.delenv("MEMBER_REPORT_SCHEMA")
    report_task.generate_report_inline(str(report.id), db)
    db.refresh(report)
    assert report.content["member_report"]["schema_version"] == "member_report.v2"


def test_본인_조회_API는_저장_JSON을_그대로_돌려주고_PDF는_v2로_분기(db, client):
    world = build_class_world(db, members=2, duration_min=64)
    report, p = _approved_report(db, world)
    r = client.get(f"/api/v1/me/reports/{report.id}/member-report", headers=_auth(p))
    assert r.status_code == 200 and r.json()["schema_version"] == "member_report.v2"
    pdf = client.get(f"/api/v1/me/reports/{report.id}/book.pdf", headers=_auth(p))
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


def test_v1_저장_리포트의_PDF는_v1_렌더러_그대로(db, client, monkeypatch):
    monkeypatch.setenv("MEMBER_REPORT_SCHEMA", "v1")
    world = build_class_world(db, members=2, duration_min=64)
    report, p = _approved_report(db, world)
    assert report.content["member_report"]["schema_version"] == "member_report.v1"
    pdf = client.get(f"/api/v1/me/reports/{report.id}/book.pdf", headers=_auth(p))
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
