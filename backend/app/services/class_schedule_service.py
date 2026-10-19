"""시작일·한국 벽시계·정규 순번에 따른 순수 편성 계산."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.schemas.class_scheduling import ScheduleInput, ScheduleRow

KST = ZoneInfo("Asia/Seoul")


def expand_schedule(payload: ScheduleInput, now: datetime) -> list[ScheduleRow]:
    rule = payload.recurrence_rule
    start = datetime.combine(rule.start_date, rule.time, KST)
    if payload.schedule_mode == "fixed" and start <= now:
        raise HTTPException(422, detail={"code": "schedule_in_past"})
    today = now.astimezone(KST).date()
    day = (
        max(rule.start_date, today)
        if payload.schedule_mode == "rolling"
        else rule.start_date
    )
    anchor = rule.start_date - timedelta(days=rule.start_date.weekday())
    limit = (
        today + timedelta(days=28)
        if payload.schedule_mode == "rolling"
        else day + timedelta(weeks=52 * 53)
    )
    skipped = set(rule.skip_dates)
    rows = []
    while day < limit:
        if payload.ends_on and day > payload.ends_on:
            break
        scheduled_at = datetime.combine(day, rule.time, KST).astimezone(timezone.utc)
        if (
            day.isoweekday() in rule.weekdays
            and ((day - anchor).days // 7) % rule.interval_weeks == 0
            and day not in skipped
            and scheduled_at > now
        ):
            rows.append(
                ScheduleRow(
                    client_key=f"regular:{day}",
                    seq=len(rows) + 1,
                    scheduled_at=scheduled_at,
                    duration_min=payload.duration_min,
                    location_type=payload.location_type,
                    location_address=payload.location_address,
                )
            )
            if (
                payload.schedule_mode == "fixed"
                and len(rows) == payload.planned_session_count
            ):
                break
        day += timedelta(days=1)
    if payload.schedule_mode == "fixed" and len(rows) != payload.planned_session_count:
        raise HTTPException(422, detail={"code": "schedule_count_unreachable"})
    assignment = payload.assignment_rule
    hosts = assignment.host_ids
    if assignment.mode == "by_weekday" and set(rule.weekdays) - set(
        assignment.weekday_hosts
    ):
        raise HTTPException(422, detail={"code": "weekday_host_missing"})
    if (
        assignment.mode == "per_session"
        and payload.schedule_mode == "fixed"
        and hosts
        and len(hosts) != len(rows)
    ):
        raise HTTPException(422, detail={"code": "per_session_host_count"})
    overrides = {row.client_key: row for row in payload.rows}
    if len(overrides) != len(payload.rows) or set(overrides) - {
        row.client_key for row in rows
    }:
        raise HTTPException(422, detail={"code": "unknown_schedule_row"})
    result = []
    for i, row in enumerate(rows):
        host = None
        if assignment.mode == "by_weekday":
            host = assignment.weekday_hosts[
                row.scheduled_at.astimezone(KST).isoweekday()
            ]
        elif hosts:
            host = hosts[0] if assignment.mode == "all_one" else hosts[i % len(hosts)]
        row = row.model_copy(update={"host_id": host})
        if row.client_key in overrides:
            override = overrides[row.client_key]
            if (
                override.seq != row.seq
                or override.session_kind != "regular"
                or override.session_id is not None
                or override.scheduled_at <= now
            ):
                raise HTTPException(422, detail={"code": "invalid_schedule_override"})
            row = override.model_copy(update={"assignment_override": True})
        result.append(row)
    return result
