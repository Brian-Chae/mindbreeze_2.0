"""SDD-237 B3: 리포트 생성 체인의 class_report 저장 훅 (수정본 이월·상담 불변)."""

import copy
import uuid

import pytest

from app.models.record import Report
from app.models.session import Session
from app.services import class_report_narrative as nar
from app.tasks import report_task
from tests.sdd237_helpers import add_windows, build_class_world, make_user


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
    w = build_class_world(db, members=3)
    for p in w["participants"][:2]:
        add_windows(db, w["session"], p, 300)
    return w


def _regen(db, report):
    return report_task.generate_report_inline(str(report.id), db)


def test_명상_클래스_상담사_리포트에_class_report_블록이_저장된다(world, db):
    rep = _regen(db, world["counselor_report"])
    cr = rep.content["class_report"]
    assert cr["schema_version"] == 1 and cr["status"] in ("measured", "partial")
    assert cr["scope"]["measured"] == 2
    fields = cr["narrative"]["fields"]
    assert fields["headline"]["source"] == "rule" and fields["headline"]["rule_text"]
    assert cr["narrative"]["input_hash"] == nar.compute_input_hash(cr)
    # 기존 혼합 집계(content.eeg)는 지우지 않는다
    assert "eeg" in rep.content


def test_이름과_이메일이_블록에_저장되지_않는다(world, db):
    rep = _regen(db, world["counselor_report"])
    dumped = str(rep.content["class_report"])
    for name in ("회원1", "회원2", "회원3", "채 상담사", "@e.com"):
        assert name not in dumped


def test_회원_리포트에는_class_report가_없다(world, db):
    for r in world["client_reports"]:
        out = _regen(db, r)
        assert "class_report" not in out.content


def test_재생성해도_수정본은_유지되고_통계가_바뀌면_stale이다(world, db):
    rep = _regen(db, world["counselor_report"])
    content = copy.deepcopy(rep.content)
    f = content["class_report"]["narrative"]["fields"]["headline"]
    f.update(edited_text="내가 고친 한 줄", edited_by=str(world["host"].id), edited_at="2026-10-23T10:00:00Z",
             edited_input_hash=content["class_report"]["narrative"]["input_hash"], source="edited")
    rep.content = content
    db.commit()

    same = _regen(db, rep)
    h = same.content["class_report"]["narrative"]["fields"]["headline"]
    assert h["source"] == "edited" and h["edited_text"] == "내가 고친 한 줄"
    assert nar.is_stale(h, same.content["class_report"]["narrative"]["input_hash"]) is False

    # 통계 입력이 바뀐 뒤 재생성 → 수정본 유지 + stale
    add_windows(db, world["session"], world["participants"][2], 300)
    again = _regen(db, same)
    h2 = again.content["class_report"]["narrative"]["fields"]["headline"]
    assert h2["edited_text"] == "내가 고친 한 줄"
    assert nar.is_stale(h2, again.content["class_report"]["narrative"]["input_hash"]) is True


def test_AI_초안과_시도_이력은_재생성에서_보존된다(world, db):
    rep = _regen(db, world["counselor_report"])
    content = copy.deepcopy(rep.content)
    narr = content["class_report"]["narrative"]
    narr["ai_attempt"] = {"hash": narr["input_hash"], "outcome": "ok", "at": "2026-10-23T10:00:00Z"}
    narr["fields"]["flow"]["ai_draft"] = "AI 문장"
    narr["fields"]["flow"]["ai_draft_input_hash"] = narr["input_hash"]
    narr["fields"]["flow"]["source"] = "ai"
    rep.content = content
    db.commit()
    again = _regen(db, rep)
    n2 = again.content["class_report"]["narrative"]
    assert n2["ai_attempt"]["outcome"] == "ok"
    assert n2["fields"]["flow"]["source"] == "ai" and n2["fields"]["flow"]["ai_draft"] == "AI 문장"


def test_통계_계산_예외여도_리포트_상태는_바뀌지_않고_이전_블록이_보존된다(world, db, monkeypatch):
    rep = _regen(db, world["counselor_report"])
    before_status, before_gen = rep.status, rep.generation_status
    prev_block = copy.deepcopy(rep.content["class_report"])

    def boom(*a, **k):
        raise RuntimeError("계산 실패")

    monkeypatch.setattr("app.services.class_report_stats_service.compute_class_stats", boom)
    again = _regen(db, rep)
    assert again.status == before_status and again.generation_status == before_gen
    assert again.content["class_report"] == prev_block
    assert again.generation_error is None


def test_처음부터_계산이_실패하면_error_블록을_저장한다(world, db, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("계산 실패")

    monkeypatch.setattr("app.services.class_report_stats_service.compute_class_stats", boom)
    rep = _regen(db, world["counselor_report"])
    assert rep.content["class_report"]["status"] == "error"
    assert rep.status in ("pending_review", "completed")
    assert rep.generation_error is None


def test_상담_세션_리포트에는_class_report가_생기지_않는다(client, db):
    host = make_user(db, name="상담사")
    s = Session(id=uuid.uuid4(), type="clinical", status="completed", host_id=host.id,
                is_template=True, duration_min=50)
    db.add(s)
    db.flush()
    rep = Report(id=uuid.uuid4(), session_id=s.id, user_id=host.id, type="counselor",
                 status="pending_analysis", content={"status": "generating"})
    db.add(rep)
    db.commit()
    out = _regen(db, rep)
    assert "class_report" not in out.content
    assert set(out.content) >= {"title", "eeg", "ai_record", "markers"}
