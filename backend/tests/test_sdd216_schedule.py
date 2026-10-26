"""V-10~12: 벽시계 반복·배정·일괄 이동의 독립 기대값."""

from datetime import datetime, timezone
from importlib import import_module, util
from uuid import UUID

import pytest
from fastapi import HTTPException

A = UUID("00000000-0000-0000-0000-000000000001")
B = UUID("00000000-0000-0000-0000-000000000002")
NOW = datetime(2026, 11, 2, 1, tzinfo=timezone.utc)


def schedule(**updates):
    assert util.find_spec("app.schemas.class_scheduling"), "편성 입력 계약이 필요합니다"
    schema = import_module("app.schemas.class_scheduling")
    data = dict(
        title="명상",
        recurrence_rule=dict(start_date="2026-11-02", weekdays=[1], time="19:00"),
        assignment_rule=dict(mode="all_one", host_ids=[str(A)]),
    )
    data.update(updates)
    return schema.ScheduleInput.model_validate(data)


def expand(**updates):
    payload = schedule(**updates)
    assert util.find_spec(
        "app.services.class_schedule_service"
    ), "편성 계산이 필요합니다"
    return import_module("app.services.class_schedule_service").expand_schedule(
        payload, NOW
    )


def test_fixed_eight_weeks_and_kst_to_utc():
    rows = expand()
    assert [r.scheduled_at.isoformat() for r in rows] == [
        "2026-11-02T10:00:00+00:00",
        "2026-11-09T10:00:00+00:00",
        "2026-11-16T10:00:00+00:00",
        "2026-11-23T10:00:00+00:00",
        "2026-11-30T10:00:00+00:00",
        "2026-12-07T10:00:00+00:00",
        "2026-12-14T10:00:00+00:00",
        "2026-12-21T10:00:00+00:00",
    ]
    assert [r.seq for r in rows] == list(range(1, 9))
    assert [r.host_id for r in rows] == [A] * 8


def test_multi_weekdays_biweekly_skip():
    rows = expand(
        planned_session_count=4,
        recurrence_rule=dict(
            start_date="2026-11-02",
            weekdays=[1, 3],
            interval_weeks=2,
            time="19:00",
            skip_dates=["2026-11-04"],
        ),
    )
    assert [r.scheduled_at.day for r in rows] == [2, 16, 18, 30]


def test_rolling_window_excludes_day28_and_respects_end():
    rows = expand(schedule_mode="rolling", ends_on="2026-11-16")
    assert [r.scheduled_at.day for r in rows] == [2, 9, 16]
    assert len(expand(schedule_mode="rolling")) == 4


@pytest.mark.parametrize(
    "rule,expected",
    [
        (dict(mode="rotate", host_ids=[str(A), str(B)]), [A, B, A, B, A, B, A, B]),
        (dict(mode="by_weekday", weekday_hosts={"1": str(B)}), [B] * 8),
        (
            dict(
                mode="per_session",
                host_ids=[
                    str(B),
                    str(A),
                    str(A),
                    str(B),
                    str(B),
                    str(A),
                    str(A),
                    str(B),
                ],
            ),
            [B, A, A, B, B, A, A, B],
        ),
    ],
)
def test_assignment_modes(rule, expected):
    assert [r.host_id for r in expand(assignment_rule=rule)] == expected


def test_rolling_per_session_repeats_confirmed_cycle():
    assert [
        r.host_id
        for r in expand(
            schedule_mode="rolling",
            assignment_rule=dict(mode="per_session", host_ids=[str(B), str(A)]),
        )
    ] == [B, A, B, A]


@pytest.mark.parametrize(
    "updates",
    [
        dict(recurrence_rule=dict(start_date="2026-11-01", weekdays=[7], time="19:00")),
        dict(recurrence_rule=dict(start_date="2026-11-02", weekdays=[], time="19:00")),
        dict(recurrence_rule=dict(start_date="2026-11-02", weekdays=[1], time="19:03")),
        dict(duration_min=6),
        dict(capacity=51),
        dict(title="  "),
        dict(assignment_rule=dict(mode="by_weekday", weekday_hosts={})),
        dict(assignment_rule=dict(mode="per_session", host_ids=[str(A)])),
    ],
)
def test_invalid_inputs_rejected(updates):
    with pytest.raises((ValueError, HTTPException)) as raised:
        expand(**updates)
    assert not isinstance(
        raised.value, AssertionError
    ), "기능 부재는 입력 거부의 증거가 아닙니다"
    assert getattr(raised.value, "status_code", 422) == 422


@pytest.mark.parametrize(
    "overrides",
    [
        {"scheduled_at": "2026-11-02T02:03:00+09:00"},
        {"scheduled_at": "2026-11-02T06:55:00+09:00"},
        {"location_type": "offline", "location_address": " "},
    ],
)
def test_manual_row_obeys_time_and_location_rules(overrides):
    from pydantic import ValidationError
    from app.schemas.class_scheduling import ScheduleRow

    with pytest.raises(ValidationError):
        ScheduleRow.model_validate(
            {
                "client_key": "manual",
                "seq": 1,
                "scheduled_at": "2026-11-02T10:00:00+09:00",
                **overrides,
            }
        )
