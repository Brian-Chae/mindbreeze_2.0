"""SDD-218 E4~E13, F1~F6: 회원 변화 추이와 지도사 집계.

경계: 회차 내부 전반→후반만, score 미사용, 미측정을 0 으로 대체 금지,
유효 착용 3명 미만 분포 비노출, 점수·순위 없음.
"""

import uuid

import pytest

from app.services import class_report_trend_service as trend


def _timeline(before: float, after: float, n: int = 8, metric: str = "relaxation"):
    """전반 n/2 포인트는 before, 후반 n/2 포인트는 after 값을 갖는 시계열."""
    points = []
    for i in range(n):
        value = before if i < n // 2 else after
        points.append({"t": i * 60, metric: value})
    return points


# ──────────────────────────── 변화 산출 ────────────────────────────

def test_e4_전반에서_후반으로의_변화를_낸다():
    content = {"eeg": {"status": "valid", "timeline": _timeline(50, 58)}}
    change = trend.compute_change(content)
    assert change["status"] == "computed"
    relax = change["metrics"]["relaxation"]
    assert relax["before"] == 50.0
    assert relax["after"] == 58.0
    assert relax["delta"] == 8.0
    assert relax["direction"] == "eased"


def test_긴장은_낮아질_때_좋아진_방향이다():
    content = {"eeg": {"status": "valid", "timeline": _timeline(47, 41, metric="stress")}}
    change = trend.compute_change(content)
    assert change["metrics"]["stress"]["direction"] == "eased"
    assert change["metrics"]["stress"]["delta"] == -6.0


def test_작은_변화는_비슷함으로_본다():
    content = {"eeg": {"status": "valid", "timeline": _timeline(50, 51)}}
    assert trend.compute_change(content)["metrics"]["relaxation"]["direction"] == "steady"


def test_e4_score는_추이에_쓰이지_않는다():
    """score 만 있고 timeline 이 없으면 산출하지 않는다."""
    content = {"eeg": {"status": "valid", "score": 87, "timeline": []}}
    change = trend.compute_change(content)
    assert change["status"] == "not_computed"
    assert "score" not in str(change)


def test_e5_timeline이_부족하면_미산출이다():
    content = {"eeg": {"status": "valid", "timeline": _timeline(50, 58, n=4)}}
    change = trend.compute_change(content)
    assert change["status"] == "not_computed"
    assert change["reason"] == "insufficient_timeline"
    assert "metrics" not in change


def test_e5_timeline이_없으면_값을_만들지_않는다():
    change = trend.compute_change({"eeg": {"status": "valid"}})
    assert change["status"] == "not_computed"
    # 0 이나 빈 지표를 만들어내지 않는다.
    assert change.get("metrics") is None


def test_e6_미측정은_0이_아니라_상태로_남는다():
    change = trend.compute_change({"eeg": {"status": "not_measured"}})
    assert change["status"] == "not_measured"
    assert "metrics" not in change


def test_eeg_블록이_없으면_미산출이다():
    assert trend.compute_change({})["status"] == "not_computed"
    assert trend.compute_change({"eeg": None})["status"] == "not_computed"


def test_0에서_1_사이_비율은_100_스케일로_환산된다():
    content = {"eeg": {"status": "valid", "timeline": _timeline(0.50, 0.58)}}
    relax = trend.compute_change(content)["metrics"]["relaxation"]
    assert relax["before"] == 50.0
    assert relax["after"] == 58.0


def test_e13_change_가산은_기존_키를_덮지_않는다():
    content = {
        "eeg": {"status": "valid", "metrics": {"relaxation_score": 61}, "narrative": "유지"},
        "summary": "기존 요약",
    }
    merged = trend.merge_change(content, {"status": "computed"})
    assert merged["summary"] == "기존 요약"
    assert merged["eeg"]["metrics"] == {"relaxation_score": 61}
    assert merged["eeg"]["narrative"] == "유지"
    assert merged["eeg"]["change"] == {"status": "computed"}
    # 원본은 변경되지 않는다.
    assert "change" not in content["eeg"]


def test_전후_구간이_한쪽만_있으면_미산출이다():
    timeline = [{"t": i * 60, "relaxation": 50} for i in range(3)]
    assert trend.compute_change(
        {"eeg": {"status": "valid", "timeline": timeline}})["status"] == "not_computed"


def test_split_halves는_시간순으로_가른다():
    timeline = [{"t": 300, "relaxation": 9}] + [{"t": i * 60, "relaxation": 1} for i in range(6)]
    halves = trend.split_halves(timeline)
    assert halves is not None
    first, second = halves
    assert len(first) >= trend.MIN_HALF_SAMPLES
    assert len(second) >= trend.MIN_HALF_SAMPLES


# ──────────────────────────── 금지 사항 ────────────────────────────

def test_f6_산출_결과에_점수_순위_비교가_없다():
    content = {"eeg": {"status": "valid", "score": 91, "timeline": _timeline(50, 58)}}
    change = trend.compute_change(content)
    flat = str(change)
    for banned in ("score", "rank", "percentile", "average", "compare"):
        assert banned not in flat, f"금지 표현 노출: {banned}"


def test_추이_지표에_score가_포함되지_않는다():
    assert "score" not in trend.TREND_METRICS
    assert set(trend.TREND_METRICS) == {"relaxation", "concentration", "stress"}


def test_f2_소표본_기준은_3명이다():
    assert trend.MIN_COHORT == 3


# ──────────────────────────── DB 통합 (E1~E11, F1~F5) ────────────────────────────

from app.models.class_membership import ClassMakeupAssignment  # noqa: E402
from app.models.class_program import Class, ClassInstructor, ClassMember  # noqa: E402
from app.models.organization import Organization  # noqa: E402
from app.models.record import Report  # noqa: E402
from app.models.session import Session, SessionParticipant  # noqa: E402
from app.models.user import User  # noqa: E402


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    s = next(app.dependency_overrides[get_db]())
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def _mk_user(db, role="client"):
    u = User(id=uuid.uuid4(), email=f"{uuid.uuid4().hex[:10]}@e.com", name="이름",
             role=role, status="active", password_hash="x")
    db.add(u)
    db.flush()
    return u


@pytest.fixture
def cls_world(db):
    """8회차 중 3회차를 구성한 클래스. 회원 1명이 2회차부터 합류."""
    org = Organization(id=uuid.uuid4(), name="기관", kind="center",
                       org_code=uuid.uuid4().hex[:6])
    db.add(org)
    db.flush()
    host = _mk_user(db, "counselor")
    cls = Class(id=uuid.uuid4(), organization_id=org.id, created_by=host.id,
                title="MBSR", status="active", default_duration_min=60)
    db.add(cls)
    db.flush()
    db.add(ClassInstructor(id=uuid.uuid4(), class_id=cls.id, user_id=host.id, role="lead"))

    from datetime import datetime, timedelta, timezone
    base = datetime(2026, 3, 4, 19, 0, tzinfo=timezone.utc)
    sessions = []
    for i in range(3):
        s = Session(id=uuid.uuid4(), type="meditation", status="completed", host_id=host.id,
                    class_id=cls.id, duration_min=60, scheduled_at=base + timedelta(weeks=i))
        db.add(s)
        sessions.append(s)
    db.flush()

    viewer = _mk_user(db)
    member = ClassMember(id=uuid.uuid4(), class_id=cls.id, user_id=viewer.id,
                         kind="member", status="active", joined_via="invite")
    db.add(member)
    db.flush()
    db.commit()
    return {"org": org, "host": host, "cls": cls, "sessions": sessions,
            "viewer": viewer, "member": member}


def _attend(db, world, session, user, *, member=None, status="attended",
            kind="regular", consent_eeg=True, included=True):
    p = SessionParticipant(id=uuid.uuid4(), session_id=session.id, user_id=user.id,
                           member_id=(member or world["member"]).id,
                           attendance_status=status, attendance_kind=kind,
                           consent_eeg=consent_eeg, report_included=included)
    db.add(p)
    db.flush()
    return p


def _report(db, session, participant, user, *, status="completed", content=None):
    r = Report(id=uuid.uuid4(), session_id=session.id, participant_id=participant.id,
               user_id=user.id, type="client", status=status, content=content or {})
    db.add(r)
    db.flush()
    return r


def test_e11_합류_전_회차는_합류_전_상태로_남는다(db, cls_world):
    w = cls_world
    # 1회차는 참여 기록 없음(합류 전), 2·3회차만 참여
    for s in w["sessions"][1:]:
        p = _attend(db, w, s, w["viewer"])
        _report(db, s, p, w["viewer"],
                content={"eeg": {"status": "valid", "timeline": _timeline(50, 58)}})
    db.commit()

    result = trend.member_trend(db, class_id=w["cls"].id, viewer_user_id=w["viewer"].id)
    assert result["sessions"][0]["participation"]["state"] == "not_enrolled"
    assert result["sessions"][0]["change"] is None
    assert result["measured_session_count"] == 2


def test_e1_승인_전_리포트는_노출되지_않는다(db, cls_world):
    w = cls_world
    p = _attend(db, w, w["sessions"][0], w["viewer"])
    _report(db, w["sessions"][0], p, w["viewer"], status="pending_review",
            content={"eeg": {"status": "valid", "timeline": _timeline(50, 58)}})
    db.commit()

    result = trend.member_trend(db, class_id=w["cls"].id, viewer_user_id=w["viewer"].id)
    first = result["sessions"][0]
    assert first["report"] is None
    assert first["change"] is None


def test_e2_타인은_본인_추이를_볼_수_없다(db, cls_world):
    from fastapi import HTTPException

    w = cls_world
    outsider = _mk_user(db)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        trend.member_trend(db, class_id=w["cls"].id, viewer_user_id=outsider.id)
    assert exc.value.status_code == 404


def test_e9_결석은_결석으로_구분된다(db, cls_world):
    w = cls_world
    _attend(db, w, w["sessions"][0], w["viewer"], status="excused")
    db.commit()
    result = trend.member_trend(db, class_id=w["cls"].id, viewer_user_id=w["viewer"].id)
    assert result["sessions"][0]["participation"]["state"] == "absent"
    assert result["sessions"][0]["measurement"] == "not_worn"
    assert result["sessions"][0]["change"] is None


def test_e6_e7_미착용과_미동의는_다른_상태다(db, cls_world):
    w = cls_world
    # 미착용: 동의는 했으나 측정 자료 없음
    p0 = _attend(db, w, w["sessions"][0], w["viewer"], consent_eeg=True)
    _report(db, w["sessions"][0], p0, w["viewer"],
            content={"eeg": {"status": "not_measured"}})
    # 미동의: 측정 동의 자체가 없음
    p1 = _attend(db, w, w["sessions"][1], w["viewer"], consent_eeg=False)
    _report(db, w["sessions"][1], p1, w["viewer"],
            content={"eeg": {"status": "not_measured"}})
    db.commit()

    result = trend.member_trend(db, class_id=w["cls"].id, viewer_user_id=w["viewer"].id)
    assert result["sessions"][0]["measurement"] == "not_worn"
    assert result["sessions"][1]["measurement"] == "not_consented"
    # 어느 쪽도 0 으로 대체되지 않는다.
    assert result["sessions"][0]["change"] is None
    assert result["sessions"][1]["change"] is None
    assert result["measured_session_count"] == 0


def test_e10_보강은_원회차와_연결된다(db, cls_world):
    w = cls_world
    source = _attend(db, w, w["sessions"][0], w["viewer"], status="excused")
    target = _attend(db, w, w["sessions"][1], w["viewer"], kind="makeup")
    db.add(ClassMakeupAssignment(
        id=uuid.uuid4(), class_id=w["cls"].id, member_id=w["member"].id,
        source_participant_id=source.id, source_session_id=w["sessions"][0].id,
        target_participant_id=target.id, target_session_id=w["sessions"][1].id))
    db.commit()

    result = trend.member_trend(db, class_id=w["cls"].id, viewer_user_id=w["viewer"].id)
    second = result["sessions"][1]
    assert second["participation"]["is_makeup"] is True
    assert second["participation"]["makeup_for_session_id"] == str(w["sessions"][0].id)


def test_f1_유효_착용_3명_이상이면_분포를_낸다(db, cls_world):
    w = cls_world
    session = w["sessions"][0]
    for _ in range(3):
        u = _mk_user(db)
        m = ClassMember(id=uuid.uuid4(), class_id=w["cls"].id, user_id=u.id,
                        kind="member", status="active", joined_via="invite")
        db.add(m)
        db.flush()
        p = _attend(db, w, session, u, member=m)
        _report(db, session, p, u,
                content={"eeg": {"status": "valid", "timeline": _timeline(50, 58)}})
    db.commit()

    summary = trend.session_summary(db, class_id=w["cls"].id, session_id=session.id)
    assert summary["valid_cohort"] == 3
    assert summary["distribution"] is not None
    assert summary["distribution"]["relaxation"]["eased"] == 3
    assert summary["hidden_reason"] is None


def test_f2_유효_착용_2명이면_분포를_숨긴다(db, cls_world):
    w = cls_world
    session = w["sessions"][0]
    for _ in range(2):
        u = _mk_user(db)
        m = ClassMember(id=uuid.uuid4(), class_id=w["cls"].id, user_id=u.id,
                        kind="member", status="active", joined_via="invite")
        db.add(m)
        db.flush()
        p = _attend(db, w, session, u, member=m)
        _report(db, session, p, u,
                content={"eeg": {"status": "valid", "timeline": _timeline(50, 58)}})
    db.commit()

    summary = trend.session_summary(db, class_id=w["cls"].id, session_id=session.id)
    assert summary["valid_cohort"] == 2
    assert summary["distribution"] is None
    assert summary["hidden_reason"] == "small_cohort"


def test_f5_리포트_반영_제외자는_집계에서_빠진다(db, cls_world):
    w = cls_world
    session = w["sessions"][0]
    for i in range(3):
        u = _mk_user(db)
        m = ClassMember(id=uuid.uuid4(), class_id=w["cls"].id, user_id=u.id,
                        kind="member", status="active", joined_via="invite")
        db.add(m)
        db.flush()
        # 한 명은 반영 제외
        p = _attend(db, w, session, u, member=m, included=(i != 0))
        _report(db, session, p, u,
                content={"eeg": {"status": "valid", "timeline": _timeline(50, 58)}})
    db.commit()

    summary = trend.session_summary(db, class_id=w["cls"].id, session_id=session.id)
    assert summary["valid_cohort"] == 2
    assert summary["distribution"] is None


def test_f8_집계에_개인별_수치가_없다(db, cls_world):
    w = cls_world
    session = w["sessions"][0]
    for _ in range(3):
        u = _mk_user(db)
        m = ClassMember(id=uuid.uuid4(), class_id=w["cls"].id, user_id=u.id,
                        kind="member", status="active", joined_via="invite")
        db.add(m)
        db.flush()
        p = _attend(db, w, session, u, member=m)
        _report(db, session, p, u,
                content={"eeg": {"status": "valid", "timeline": _timeline(50, 58)}})
    db.commit()

    summary = trend.session_summary(db, class_id=w["cls"].id, session_id=session.id)
    flat = str(summary)
    # 개인 식별자나 개인 수치가 섞이지 않는다.
    assert "participant_id" not in flat
    assert "user_id" not in flat
    assert "member_id" not in flat


def test_출석_요약은_결석과_보강을_구분한다(db, cls_world):
    w = cls_world
    session = w["sessions"][0]
    _attend(db, w, session, w["viewer"], status="attended")
    for status, kind in (("excused", "regular"), ("attended", "makeup")):
        u = _mk_user(db)
        m = ClassMember(id=uuid.uuid4(), class_id=w["cls"].id, user_id=u.id,
                        kind="member", status="active", joined_via="invite")
        db.add(m)
        db.flush()
        _attend(db, w, session, u, member=m, status=status, kind=kind)
    db.commit()

    summary = trend.session_summary(db, class_id=w["cls"].id, session_id=session.id)
    assert summary["attendance"]["attended"] == 2
    assert summary["attendance"]["absent"] == 1
    assert summary["makeup_linked"] == 1
