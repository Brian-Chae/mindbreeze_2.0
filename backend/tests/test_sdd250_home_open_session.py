"""SDD-250 TS1~TS4 — 홈 '다음 일정' 후보용 열린 회차(open_session) 가산 필드."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from app.models.class_program import Class
from app.services.class_read_service import _class_summary, _home_open_session
from tests.test_sdd214_read_api import world  # noqa: F401 — 픽스처 재사용

NOW = datetime(2030, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def _row(status, scheduled=None, started=None, seq=1, host=None):
    return SimpleNamespace(
        id=uuid4(), status=status, scheduled_at=scheduled, started_at=started, seq=seq,
        host_id=host, host_state="assigned" if host else "unassigned", session_kind="regular",
    )


def _summary(rows, rule=None):
    cls = Class(id=uuid4(), title="t", status="active", schedule_mode="fixed", planned_session_count=1, recurrence_rule=rule)
    return _class_summary(cls, rows, {}, NOW)


def test_TS1_열린_즉석_회차는_open_session_이고_next_session은_비어_있다():
    row = _row("in_progress", scheduled=NOW - timedelta(minutes=3), started=NOW - timedelta(minutes=3), host=uuid4())
    out = _summary([row], {"version": 1, "start_now": True})
    assert out["open_session"]["id"] == str(row.id)
    assert out["open_session"]["status"] == "in_progress"
    assert out["open_session"]["host"]["id"] == str(row.host_id)
    assert out["next_session"] is None  # 기존 의미(미래 예정만) 유지
    assert out["is_instant"] is True
    assert out["has_open_session"] is True and out["open_session_id"] == str(row.id)


def test_TS2_시작_6시간_초과_열린_회차는_홈_후보에서_제외되지만_기존_필드는_유지():
    old = _row("open", scheduled=NOW - timedelta(hours=7))
    fresh = _row("open", scheduled=NOW - timedelta(hours=5), seq=2)
    assert _summary([old])["open_session"] is None
    assert _summary([old])["has_open_session"] is True
    assert _summary([old])["open_session_id"] == str(old.id)
    assert _summary([fresh])["open_session"]["id"] == str(fresh.id)


def test_TS2_경계_정확히_6시간은_포함_1초_넘으면_제외():
    assert _home_open_session([_row("open", scheduled=NOW - timedelta(hours=6))], NOW) is not None
    assert _home_open_session([_row("open", scheduled=NOW - timedelta(hours=6, seconds=1))], NOW) is None


def test_TS2_started_at이_더_최근이면_그_기준으로_판정():
    row = _row("in_progress", scheduled=NOW - timedelta(hours=9), started=NOW - timedelta(hours=1))
    assert _home_open_session([row], NOW) is row


def test_TS3_종료_취소_회차와_시각_없는_회차는_제외():
    rows = [_row("completed", scheduled=NOW), _row("cancelled", scheduled=NOW), _row("open")]
    assert _summary(rows)["open_session"] is None


def test_진행_중이_입장_중보다_우선():
    a = _row("open", scheduled=NOW - timedelta(minutes=1), seq=1)
    b = _row("in_progress", scheduled=NOW - timedelta(hours=2), seq=2)
    assert _home_open_session([a, b], NOW) is b


def test_미래_예정인데_열린_회차도_후보():
    row = _row("open", scheduled=NOW + timedelta(minutes=30))
    assert _home_open_session([row], NOW) is row


def test_TS4_API_응답에_open_session_키가_가산된다(client, world):  # noqa: F811
    from tests.test_sdd214_read_api import API, _h

    res = client.get(f"{API}/classes", headers=_h(world, "host_b"))
    assert res.status_code == 200, res.text
    item = res.json()["classes"][0]
    assert "open_session" in item
    assert item["has_open_session"] is True and item["open_session_id"] is not None
