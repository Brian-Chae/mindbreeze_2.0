"""SDD-218 회원 변화 추이와 지도사용 회차 요약 (spec R4·R5).

지켜야 할 경계:
- 변화는 **각 회차 내부의 전반→후반**만 본다. 회차 사이의 개선/악화는 계산하지 않는다.
- 원천은 `content.eeg.timeline` 뿐이다. `eeg.score` 는 추이에 쓰지 않는다.
- 미측정·미착용·미동의·유실·결석은 서로 다른 상태로 구분한다. 0 으로 대체하지 않는다.
- 점수·종합점수·순위·타인 대비·강사 비교를 만들지 않는다.
- 유효 착용 3명 미만 회차는 분포를 내보내지 않는다.
"""

import logging
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.class_membership import ClassMakeupAssignment
from app.models.class_program import Class, ClassMember
from app.models.record import Report
from app.models.session import Session, SessionParticipant

logger = logging.getLogger(__name__)

# 방향 판정 임계값. 이보다 작은 변화는 "비슷함" 으로 본다.
DIRECTION_EPSILON = 3.0
# 전·후 구간 각각 최소 이만큼의 표본이 있어야 산출한다.
MIN_HALF_SAMPLES = 3
# 이 인원 미만이면 분포를 노출하지 않는다 (개인 식별 방지).
MIN_COHORT = 3

# 추이에 쓰는 지표. score 는 의도적으로 제외한다.
TREND_METRICS = ("relaxation", "concentration", "stress")
# 값이 낮아지는 것이 좋은 지표
LOWER_IS_BETTER = frozenset({"stress"})


def _to_uuid(value) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _normalize(metric: str, value):
    """0~1 비율로 들어온 값을 0~100 스케일로 맞춘다 (기존 parse_timeline 과 같은 규칙)."""
    value = _number(value)
    if value is None:
        return None
    if 0 <= value < 1:
        return round(value * 1000 + 0.5) / 10
    return value


def split_halves(timeline) -> tuple[list, list] | None:
    """시계열을 시간 기준 전반/후반으로 가른다. 자를 수 없으면 None."""
    if not isinstance(timeline, list):
        return None
    points = []
    for item in timeline:
        if not isinstance(item, dict):
            continue
        t = _number(item.get("t"))
        minutes = t / 60 if t is not None else _number(item.get("min"))
        if minutes is None:
            continue
        points.append((minutes, item))
    if len(points) < MIN_HALF_SAMPLES * 2:
        return None
    points.sort(key=lambda p: p[0])
    midpoint = (points[0][0] + points[-1][0]) / 2
    first = [item for minutes, item in points if minutes < midpoint]
    second = [item for minutes, item in points if minutes >= midpoint]
    if len(first) < MIN_HALF_SAMPLES or len(second) < MIN_HALF_SAMPLES:
        return None
    return first, second


def _mean(points, metric: str):
    values = [
        v
        for v in (_normalize(metric, p.get(_timeline_key(metric))) for p in points)
        if v is not None
    ]
    if len(values) < MIN_HALF_SAMPLES:
        return None
    return sum(values) / len(values)


def _timeline_key(metric: str) -> str:
    # timeline 은 concentration 키를 쓴다. 외부 계약 이름과 맞춰 둔다.
    return metric


def _direction(metric: str, delta: float) -> str:
    if abs(delta) < DIRECTION_EPSILON:
        return "steady"
    improved = delta < 0 if metric in LOWER_IS_BETTER else delta > 0
    return "eased" if improved else "tensed"


def compute_change(content: dict) -> dict:
    """회차 1건의 전반→후반 변화를 낸다.

    산출할 수 없으면 값을 만들지 않고 사유를 담아 돌려준다.
    """
    eeg = (content or {}).get("eeg")
    if not isinstance(eeg, dict):
        return {"status": "not_computed", "reason": "no_eeg"}

    status = eeg.get("status")
    if status is None:
        status = "valid" if eeg.get("available") is True else "not_measured"
    if status == "not_measured":
        # 미착용·미동의·유실을 뭉뚱그리지 않는다. 상위에서 구분해 붙인다.
        return {"status": "not_measured", "excluded": bool(eeg.get("excluded"))}
    if status != "valid":
        return {"status": "not_computed", "reason": "invalid_status"}

    halves = split_halves(eeg.get("timeline"))
    if halves is None:
        return {"status": "not_computed", "reason": "insufficient_timeline"}

    first, second = halves
    metrics = {}
    for metric in TREND_METRICS:
        before, after = _mean(first, metric), _mean(second, metric)
        if before is None or after is None:
            # 지표별로 결손이 다를 수 있다. 없는 지표는 넣지 않는다(0 치환 금지).
            continue
        delta = after - before
        metrics[metric] = {
            "before": round(before, 1),
            "after": round(after, 1),
            "delta": round(delta, 1),
            "direction": _direction(metric, delta),
        }
    if not metrics:
        return {"status": "not_computed", "reason": "insufficient_timeline"}
    return {"status": "computed", "metrics": metrics}


def merge_change(content: dict, change: dict) -> dict:
    """`content.eeg.change` 에 가산한다. 기존 키를 덮지 않는다 (verify E13)."""
    merged = dict(content or {})
    eeg = dict(merged.get("eeg") or {})
    eeg["change"] = change
    merged["eeg"] = eeg
    return merged


# ──────────────────────────── 회원 추이 (R4) ────────────────────────────

def _participation_state(participant, makeup_by_target: dict) -> dict:
    """출석 상태를 화면 계약대로 구분한다."""
    status = participant.attendance_status
    kind = participant.attendance_kind
    state = {
        "attended": "attended",
        "excused": "absent",
        "withdrawn": "withdrawn",
        "expected": "expected",
    }.get(status, status)
    out = {"state": state, "is_makeup": kind == "makeup"}
    assignment = makeup_by_target.get(participant.id)
    if assignment is not None:
        out["makeup_for_session_id"] = str(assignment.source_session_id)
    return out


def _measurement_state(content: dict, participant) -> str:
    """미착용·미동의·유실을 구분한다. 어느 것도 0 으로 바꾸지 않는다."""
    eeg = (content or {}).get("eeg")
    if not isinstance(eeg, dict):
        return "not_worn"
    if eeg.get("excluded"):
        return "excluded"
    status = eeg.get("status")
    if status is None:
        status = "valid" if eeg.get("available") is True else "not_measured"
    if status == "valid":
        return "measured"
    if participant is not None and not participant.consent_eeg:
        return "not_consented"
    if eeg.get("reason") == "data_loss" or eeg.get("data_loss"):
        return "data_lost"
    return "not_worn"


def member_trend(db: DBSession, *, class_id, viewer_user_id) -> dict:
    """본인 추이. 승인된 본인 리포트만 쓴다 (verify E1·E2)."""
    class_id, viewer_user_id = _to_uuid(class_id), _to_uuid(viewer_user_id)

    member = (
        db.query(ClassMember)
        .filter(ClassMember.class_id == class_id, ClassMember.user_id == viewer_user_id)
        .first()
    )
    if member is None:
        from fastapi import HTTPException

        raise HTTPException(404, detail={"code": "membership_not_found"})

    sessions = (
        db.query(Session)
        .filter(Session.class_id == class_id)
        .order_by(Session.scheduled_at.nulls_last(), Session.created_at)
        .all()
    )
    session_order = {s.id: i + 1 for i, s in enumerate(sessions)}

    participants = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id.in_([s.id for s in sessions] or [None]),
            SessionParticipant.user_id == viewer_user_id,
        )
        .all()
    )
    by_session = {p.session_id: p for p in participants}

    makeups = (
        db.query(ClassMakeupAssignment)
        .filter(
            ClassMakeupAssignment.class_id == class_id,
            ClassMakeupAssignment.member_id == member.id,
        )
        .all()
    )
    makeup_by_target = {m.target_participant_id: m for m in makeups}

    # 승인된 본인 리포트만 읽는다. 승인 전 리포트는 존재조차 내보내지 않는다.
    reports = (
        db.query(Report)
        .filter(
            Report.participant_id.in_([p.id for p in participants] or [None]),
            Report.type == "client",
            Report.status == "completed",
        )
        .all()
    )
    report_by_participant = {r.participant_id: r for r in reports}

    items = []
    measured_count = 0
    for session in sessions:
        participant = by_session.get(session.id)
        if participant is None:
            # 합류 전/이탈 후 — 참여 기록 자체가 없다. 빈 값이 아니라 상태다.
            items.append(
                {
                    "session_id": str(session.id),
                    "order": session_order[session.id],
                    "scheduled_at": session.scheduled_at.isoformat()
                    if session.scheduled_at
                    else None,
                    "participation": {"state": "not_enrolled", "is_makeup": False},
                    "measurement": "none",
                    "report": None,
                    "change": None,
                }
            )
            continue

        report = report_by_participant.get(participant.id)
        content = (report.content or {}) if report else {}
        measurement = _measurement_state(content, participant)
        if measurement == "measured":
            measured_count += 1

        change = None
        if report is not None and measurement == "measured":
            existing = (content.get("eeg") or {}).get("change")
            change = existing if isinstance(existing, dict) else compute_change(content)

        items.append(
            {
                "session_id": str(session.id),
                "order": session_order[session.id],
                "scheduled_at": session.scheduled_at.isoformat()
                if session.scheduled_at
                else None,
                "participation": _participation_state(participant, makeup_by_target),
                "measurement": measurement,
                # 승인된 리포트만 링크한다.
                "report": {"id": str(report.id)} if report else None,
                "change": change,
            }
        )

    return {
        "class_id": str(class_id),
        "member_id": str(member.id),
        "measured_session_count": measured_count,
        "sessions": items,
    }


# ──────────────────────────── 지도사 집계 (R5) ────────────────────────────

def session_summary(db: DBSession, *, class_id, session_id) -> dict:
    """회차 출석 요약과 익명 방향 분포.

    개인별 수치·순위·비교는 만들지 않는다. 유효 착용 3명 미만이면 분포를 숨긴다.
    """
    class_id, session_id = _to_uuid(class_id), _to_uuid(session_id)

    participants = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == session_id)
        .all()
    )
    attendance = {"attended": 0, "absent": 0, "withdrawn": 0, "expected": 0}
    makeup_linked = 0
    for participant in participants:
        if participant.removed_at is not None:
            continue
        key = {
            "attended": "attended",
            "excused": "absent",
            "withdrawn": "withdrawn",
            "expected": "expected",
        }.get(participant.attendance_status)
        if key:
            attendance[key] += 1
        if participant.attendance_kind == "makeup":
            makeup_linked += 1

    reports = (
        db.query(Report)
        .filter(
            Report.session_id == session_id,
            Report.type == "client",
            Report.status == "completed",
        )
        .all()
    )

    counts = {metric: {"eased": 0, "steady": 0, "tensed": 0} for metric in TREND_METRICS}
    cohort = 0
    for report in reports:
        participant = next(
            (p for p in participants if p.id == report.participant_id), None
        )
        if participant is not None and not participant.report_included:
            # 리포트 반영 제외자는 집계에 넣지 않는다.
            continue
        content = report.content or {}
        if _measurement_state(content, participant) != "measured":
            continue
        existing = (content.get("eeg") or {}).get("change")
        change = existing if isinstance(existing, dict) else compute_change(content)
        if change.get("status") != "computed":
            continue
        cohort += 1
        for metric, value in (change.get("metrics") or {}).items():
            if metric in counts and value.get("direction") in counts[metric]:
                counts[metric][value["direction"]] += 1

    distribution = None
    hidden_reason = None
    if cohort >= MIN_COHORT:
        distribution = counts
    else:
        # 인원이 적으면 개인이 드러난다. 숫자 대신 사유를 준다.
        hidden_reason = "small_cohort"

    return {
        "class_id": str(class_id),
        "session_id": str(session_id),
        "attendance": attendance,
        "makeup_linked": makeup_linked,
        "valid_cohort": cohort,
        "min_cohort": MIN_COHORT,
        "distribution": distribution,
        "hidden_reason": hidden_reason,
    }
