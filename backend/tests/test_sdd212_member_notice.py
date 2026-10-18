"""SDD-212 T8 — 회원 `리뷰 중` 지연 안내 가산 필드 `in_review_delayed` (verify U-01~U-05, U-08)

true 조건: 회원에게 마스킹된(승인 전) 리포트이면서, 생성이 아직 끝나지 않았고(pending/processing),
세션 종료 후 지연 임계(D-3 평상시 15분)를 넘은 경우. 상담사 확인 대기(생성 완료) 건은 false.
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from app.config import settings
from app.schemas.report import ReportResponse
from tests.test_sdd211_member_report_visibility import (
    LEAK_FOREVER,
    _db,
    _detail,
    _expected_preserved,
    _leak_violations,
    _list,
    _masking_violations,
    _scenario,
)


def _end_session(sid: str, minutes_ago: float | None) -> None:
    from app.models.session import Session

    db = _db()
    try:
        session = db.query(Session).filter(Session.id == UUID(sid)).first()
        session.ended_at = None if minutes_ago is None else datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
        db.commit()
    finally:
        db.close()


def _set_generation(report_id: str, generation_status: str) -> None:
    from app.models.record import Report

    db = _db()
    try:
        db.query(Report).filter(Report.id == UUID(report_id)).one().generation_status = generation_status
        db.commit()
    finally:
        db.close()


def _rows(client, env: dict, status: str) -> list[dict]:
    rid = env["ids"][status]
    list_row = next(r for r in _list(client, env["member"])["reports"] if r["id"] == rid)
    detail = _detail(client, env["member"], rid)
    assert detail.status_code == 200, detail.text
    return [list_row, detail.json()]


def test_스키마_가산_필드_기본값은_false():
    field = ReportResponse.model_fields.get("in_review_delayed")
    assert field is not None and field.default is False


def test_설정_지연_임계_기본값은_D3_평상시_15분():
    assert settings.pipeline_report_delay_notice_seconds == 15 * 60


@pytest.mark.parametrize("generation_status", ["processing", "pending"])
def test_U01_생성_미완료이고_종료_후_임계를_넘으면_지연_안내(client, generation_status):
    env = _scenario(client, ("pending_analysis",))
    _end_session(env["sids"]["pending_analysis"], minutes_ago=20)
    _set_generation(env["ids"]["pending_analysis"], generation_status)

    for row in _rows(client, env, "pending_analysis"):
        assert row["in_review"] is True
        assert row["in_review_delayed"] is True


def test_U01_종료_후_임계_이내면_안내하지_않는다(client):
    env = _scenario(client, ("pending_analysis",))
    _end_session(env["sids"]["pending_analysis"], minutes_ago=5)

    for row in _rows(client, env, "pending_analysis"):
        assert row["in_review"] is True and row["in_review_delayed"] is False


def test_U01_세션이_아직_끝나지_않았으면_안내하지_않는다(client):
    env = _scenario(client, ("pending_analysis",))
    _end_session(env["sids"]["pending_analysis"], minutes_ago=None)

    for row in _rows(client, env, "pending_analysis"):
        assert row["in_review_delayed"] is False


def test_U01_임계는_설정으로_조정된다(client, monkeypatch):
    env = _scenario(client, ("pending_analysis",))
    _end_session(env["sids"]["pending_analysis"], minutes_ago=20)
    monkeypatch.setattr(settings, "pipeline_report_delay_notice_seconds", 60 * 60)

    for row in _rows(client, env, "pending_analysis"):
        assert row["in_review_delayed"] is False


def test_U02_생성이_끝나_상담사_확인_대기면_지연_안내가_없다(client):
    env = _scenario(client, ("pending_review",))
    _end_session(env["sids"]["pending_review"], minutes_ago=120)

    for row in _rows(client, env, "pending_review"):
        assert row["in_review"] is True
        assert row["in_review_delayed"] is False


def test_U02_생성_실패_건은_지연이_아니므로_안내가_없다(client):
    env = _scenario(client, ("error",))
    _end_session(env["sids"]["error"], minutes_ago=120)

    for row in _rows(client, env, "error"):
        assert row["in_review_delayed"] is False


def test_U03_승인된_리포트는_두_필드_모두_false이고_본문이_노출된다(client):
    env = _scenario(client, ("completed",))
    _end_session(env["sids"]["completed"], minutes_ago=120)

    for row in _rows(client, env, "completed"):
        assert row["in_review"] is False and row["in_review_delayed"] is False
        assert row["content"].get("headline") == "APPROVED_HEADLINE"


def test_U05_지연_안내_중에도_본문_지표_코멘트는_마스킹된다(client):
    env = _scenario(client, ("pending_analysis",))
    _end_session(env["sids"]["pending_analysis"], minutes_ago=30)

    for row in _rows(client, env, "pending_analysis"):
        assert row["in_review_delayed"] is True
        problems = _masking_violations(
            row, expected=_expected_preserved(env, "pending_analysis"), leak_tokens=LEAK_FOREVER
        )
        assert not problems, "\n".join(problems)
        assert not _leak_violations(row, LEAK_FOREVER)


def test_U08_상담사_응답은_가산_필드가_false로_변화가_없다(client):
    from tests.test_sdd211_member_report_visibility import _make_host

    host = _make_host("t212-u08-host@test.com")
    env = _scenario(client, ("pending_analysis",), tag="RAW", host=host)
    _end_session(env["sids"]["pending_analysis"], minutes_ago=60)

    rows = client.get("/api/v1/reports", headers=host["auth"]).json()["reports"]
    detail = client.get(f"/api/v1/reports/{env['ids']['pending_analysis']}", headers=host["auth"]).json()
    assert all(row.get("in_review_delayed") is False for row in rows)
    assert detail.get("in_review_delayed") is False
    assert detail["content"].get("headline") == "RAW_HEADLINE", "상담사에게는 마스킹 없음(불변)"
