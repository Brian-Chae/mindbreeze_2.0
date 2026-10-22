"""SDD-230 회원 개요(목록 보강·활동·리포트·연락처 열람) 검증 — verify.md V1~V13."""

import uuid
from datetime import date, datetime, timedelta, timezone

from app.services import client_overview_service as svc

NOW = datetime.now(timezone.utc)


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _h(c):
    return {"Authorization": f"Bearer {c['access_token']}"}


def _counselor(name="김상담"):
    from tests.conftest import create_test_counselor, create_test_org

    return create_test_counselor(f"c-{uuid.uuid4().hex[:8]}@test.com", name=name, org_code=create_test_org())


def _client_user(db, name="윤가온", phone="010-1234-5678", gender="female", birth=None):
    from app.models.client_profile import ClientProfile
    from app.models.user import User

    u = User(
        email=f"m-{uuid.uuid4().hex[:8]}@test.com", password_hash="x", name=name,
        role="client", status="active", verified_tier="email", phone=phone,
    )
    db.add(u)
    db.flush()
    db.add(ClientProfile(user_id=u.id, gender=gender, birth_date=birth, concerns=["수면"], interests=[]))
    db.commit()
    return u


def _link(db, counselor, user, status="active"):
    from app.models.client_counselor_link import ClientCounselorLink

    db.add(ClientCounselorLink(client_id=user.id, counselor_id=uuid.UUID(counselor["id"]), status=status))
    db.commit()


def _session(db, host_id, *, title="마음챙김", started=True, status="completed", when=None):
    from app.models.session import Session

    when = when or NOW - timedelta(days=2)
    s = Session(
        type="meditation", status=status, host_id=uuid.UUID(str(host_id)), duration_min=30, title=title,
        scheduled_at=when, started_at=when if started else None, participant_mode="group",
    )
    db.add(s)
    db.flush()
    return s


def _participant(db, session, user, **kw):
    from app.models.session import SessionParticipant

    p = SessionParticipant(session_id=session.id, user_id=user.id, **kw)
    db.add(p)
    db.flush()
    return p


def _report(db, session, participant, *, status="completed", type_="client", content=None):
    from app.models.record import Report

    r = Report(
        session_id=session.id, user_id=participant.user_id, participant_id=participant.id,
        type=type_, status=status, content=content or {},
    )
    db.add(r)
    db.flush()
    return r


def _setup():
    db = _db()
    c = _counselor()
    u = _client_user(db)
    _link(db, c, u)
    return db, c, u


# ── V1: 권한 ──
def test_v1_타상담사_비연결_종료연결은_403(client):
    db, c, u = _setup()
    other = _counselor("타상담")
    ended_user = _client_user(db, name="종료회원")
    _link(db, c, ended_user, status="ended")
    for who, target in ((other, u), (c, ended_user)):
        for method, path in (
            ("get", f"/api/v1/clients/{target.id}"),
            ("get", f"/api/v1/clients/{target.id}/activity"),
            ("get", f"/api/v1/clients/{target.id}/reports"),
            ("post", f"/api/v1/clients/{target.id}/contact-reveal"),
        ):
            res = getattr(client, method)(path, headers=_h(who))
            assert res.status_code == 403, (path, res.status_code)


# ── V2: 목록 서버 필터 ──
def test_v2_목록_검색_클래스_활동기간_total_일치(client):
    from app.models.class_program import Class, ClassMember

    db, c, u = _setup()
    u2 = _client_user(db, name="박하늘")
    _link(db, c, u2)
    s = _session(db, c["id"], when=NOW - timedelta(days=3))
    _participant(db, s, u, attendance_status="attended")
    cls = Class(created_by=uuid.UUID(c["id"]), title="아침 명상", default_duration_min=30)
    db.add(cls)
    db.flush()
    db.add(ClassMember(class_id=cls.id, user_id=u2.id, status="active", joined_via="host_invite"))
    db.commit()

    res = client.get("/api/v1/clients", headers=_h(c)).json()
    assert res["total"] == 2
    assert [o["title"] for o in res["class_options"]] == ["아침 명상"]
    by_name = {x["name"]: x for x in res["clients"]}
    assert by_name["박하늘"]["classes"][0]["title"] == "아침 명상"

    assert client.get("/api/v1/clients?q=박하", headers=_h(c)).json()["total"] == 1
    assert client.get(f"/api/v1/clients?class_id={cls.id}", headers=_h(c)).json()["total"] == 1
    r7 = client.get("/api/v1/clients?active_within_days=7", headers=_h(c)).json()
    assert [x["name"] for x in r7["clients"]] == ["윤가온"] and r7["total"] == 1
    assert client.get("/api/v1/clients?active_within_days=1", headers=_h(c)).json()["total"] == 0


# ── V3: 다른 참여자 미노출 ──
def test_v3_같은_세션_다른_참여자_데이터_미노출(client):
    db, c, u = _setup()
    other = _client_user(db, name="다른참여자")
    s = _session(db, c["id"], title="그룹 수업")
    _participant(db, s, u, attendance_status="attended")
    po = _participant(db, s, other, attendance_status="attended", checkin_state="completed", checkin_at=NOW - timedelta(days=1))
    _report(db, s, po)
    db.commit()
    act = client.get(f"/api/v1/clients/{u.id}/activity", headers=_h(c)).json()
    assert [i["type"] for i in act["items"]] == ["session"]
    assert client.get(f"/api/v1/clients/{u.id}/reports", headers=_h(c)).json() == {"reports": [], "changes": []}
    assert "다른참여자" not in str(act)


# ── V4: 접근 불가 세션 ──
def test_v4_타상담사_호스트_세션은_활동에_미포함(client):
    db, c, u = _setup()
    other = _counselor("타상담")
    s = _session(db, other["id"], title="타 상담사 수업")
    _participant(db, s, u, attendance_status="attended")
    db.commit()
    assert client.get(f"/api/v1/clients/{u.id}/activity", headers=_h(c)).json()["items"] == []
    row = client.get("/api/v1/clients", headers=_h(c)).json()["clients"][0]
    assert row["last_activity_at"] is None and row["last_session_at"] is None


# ── V5: AI 비공개 ──
def test_v5_ai_비공개면_안부체크인_제외(client, monkeypatch):
    from app.config import settings
    from app.models.agent import AgentCheckin

    db, c, u = _setup()
    db.add(AgentCheckin(client_id=u.id, counselor_id=uuid.UUID(c["id"]), closed_at=NOW - timedelta(hours=3), turn_count=5, summary="요약"))
    db.commit()
    on = client.get(f"/api/v1/clients/{u.id}/activity", headers=_h(c)).json()
    assert on["ai_included"] is True and [i["type"] for i in on["items"]] == ["ai_checkin"]
    monkeypatch.setattr(settings, "ai_features_enabled", False)
    off = client.get(f"/api/v1/clients/{u.id}/activity", headers=_h(c)).json()
    assert off["ai_included"] is False and off["items"] == []
    row = client.get("/api/v1/clients", headers=_h(c)).json()["clients"][0]
    assert row["last_activity_at"] is None


# ── V6/V7: 예정·결석 제외, last_session_at 실값 ──
def test_v6_v7_예정_결석_제외_last_session_at(client):
    db, c, u = _setup()
    sched = _session(db, c["id"], title="예정", started=False, status="scheduled", when=NOW + timedelta(days=2))
    _participant(db, sched, u, attendance_status="expected")
    absent = _session(db, c["id"], title="결석", when=NOW - timedelta(days=5))
    _participant(db, absent, u, attendance_status="absent")
    done_at = NOW - timedelta(days=4)
    done = _session(db, c["id"], title="참여", when=done_at)
    _participant(db, done, u, attendance_status="attended")
    db.commit()
    items = client.get(f"/api/v1/clients/{u.id}/activity", headers=_h(c)).json()["items"]
    assert [i["title"] for i in items] == ["참여"]
    row = client.get("/api/v1/clients", headers=_h(c)).json()["clients"][0]
    assert row["last_session_at"] is not None
    assert datetime.fromisoformat(row["last_session_at"]).date() == done_at.date()
    assert row["last_activity_source"] == "수업·상담 참여"


# ── V8: 마스킹 · reveal ──
def test_v8_마스킹_기본_원문은_reveal만(client):
    db, c, u = _setup()
    u.phone = "010-1234-5678"
    db.commit()
    lst = client.get("/api/v1/clients", headers=_h(c)).json()["clients"][0]
    assert lst["phone_masked"] == "010-****-5678"
    assert "1234" not in str(lst)
    det = client.get(f"/api/v1/clients/{u.id}", headers=_h(c)).json()
    assert det["phone"] is None and det["birth_date"] is None
    assert det["phone_masked"] == "010-****-5678"
    rev = client.post(f"/api/v1/clients/{u.id}/contact-reveal", headers=_h(c))
    assert rev.status_code == 200 and rev.json()["phone"] == "010-1234-5678"


def test_v8_mask_phone_형식():
    assert svc.mask_phone("01012345678") == "010-****-5678"
    assert svc.mask_phone("0212345678") == "021-***-5678"
    assert svc.mask_phone(None) is None and svc.mask_phone("") is None


# ── V9: 만 나이 ──
def test_v9_만나이_생일_경계_KST():
    today = date(2026, 10, 22)
    assert svc.calc_age(date(1990, 10, 22), today) == 36
    assert svc.calc_age(date(1990, 10, 23), today) == 35
    assert svc.calc_age(date(2000, 2, 29), date(2026, 2, 28)) == 25
    assert svc.calc_age(None, today) is None
    assert svc.calc_age(date(2030, 1, 1), today) is None
    # UTC 14:30 = KST 다음날 23:30 아님 → 15:00 UTC 경계
    assert svc.kst_today(datetime(2026, 10, 21, 15, 30, tzinfo=timezone.utc)) == date(2026, 10, 22)
    assert svc.kst_today(datetime(2026, 10, 21, 14, 59, tzinfo=timezone.utc)) == date(2026, 10, 21)


# ── V10: cursor ──
def test_v10_cursor_중복_누락_없음_기간_유형_교집합(client):
    db, c, u = _setup()
    for i in range(5):
        s = _session(db, c["id"], title=f"회차{i}", when=NOW - timedelta(days=i + 1))
        _participant(db, s, u, attendance_status="attended")
    old = _session(db, c["id"], title="오래전", when=NOW - timedelta(days=100))
    _participant(db, old, u, attendance_status="attended")
    db.commit()
    seen, cursor = [], None
    while True:
        url = f"/api/v1/clients/{u.id}/activity?limit=2" + (f"&cursor={cursor}" if cursor else "")
        body = client.get(url, headers=_h(c)).json()
        seen += [i["title"] for i in body["items"]]
        cursor = body["next_cursor"]
        if not cursor:
            break
    assert seen == [f"회차{i}" for i in range(5)]  # 30일 밖(오래전) 제외, 중복 없음
    assert client.get(f"/api/v1/clients/{u.id}/activity?days=365", headers=_h(c)).json()["items"][-1]["title"] == "오래전"
    assert client.get(f"/api/v1/clients/{u.id}/activity?types=checkin", headers=_h(c)).json()["items"] == []
    assert client.get(f"/api/v1/clients/{u.id}/activity?cursor=bad", headers=_h(c)).status_code == 422


def test_v10_체크인_측정은_독립_이벤트(client):
    from app.models.record import EEGRecord

    db, c, u = _setup()
    s = _session(db, c["id"], title="명상")
    p = _participant(db, s, u, attendance_status="attended", checkin_state="completed", checkin_at=NOW - timedelta(days=2, minutes=-5))
    db.add(EEGRecord(session_id=s.id, user_id=u.id, participant_id=p.id, s3_key="k", duration_sec=600, file_count=3))
    db.commit()
    types = sorted(i["type"] for i in client.get(f"/api/v1/clients/{u.id}/activity", headers=_h(c)).json()["items"])
    assert types == ["checkin", "measurement", "session"]


# ── V11/V12/V13: 리포트·변화·접속 필드 없음 ──
def _timeline(first, second):
    pts = [{"t": i * 60, "relaxation": v, "concentration": 50, "stress": 50} for i, v in enumerate(first + second)]
    return pts


def test_v11_v12_리포트_상태_변화_서사_점수없음(client):
    db, c, u = _setup()
    s1 = _session(db, c["id"], title="1회차", when=NOW - timedelta(days=6))
    p1 = _participant(db, s1, u, attendance_status="attended")
    content = {"eeg": {"status": "valid", "timeline": _timeline([40, 41, 40, 42], [55, 56, 57, 55])}}
    r_ok = _report(db, s1, p1, content=content)
    s2 = _session(db, c["id"], title="2회차", when=NOW - timedelta(days=3))
    p2 = _participant(db, s2, u, attendance_status="attended")
    _report(db, s2, p2, status="pending_review")
    s3 = _session(db, c["id"], title="3회차", when=NOW - timedelta(days=1))
    p3 = _participant(db, s3, u, attendance_status="attended")
    _report(db, s3, p3, content={"eeg": {"status": "not_measured"}})
    s4 = _session(db, c["id"], title="4회차", when=NOW - timedelta(days=9))
    p4 = _participant(db, s4, u, attendance_status="attended")
    _report(db, s4, p4, status="error", type_="counselor")
    db.commit()
    body = client.get(f"/api/v1/clients/{u.id}/reports", headers=_h(c)).json()
    labels = {r["title"]: r["status_label"] for r in body["reports"]}
    assert labels == {"1회차": "승인됨", "2회차": "검토 중", "3회차": "승인됨", "4회차": "생성 실패"}
    by_title = {ch["title"]: ch for ch in body["changes"]}
    assert set(by_title) == {"1회차", "3회차"}  # 승인 리포트만
    assert by_title["1회차"]["state"] == "computed"
    relax = next(m for m in by_title["1회차"]["metrics"] if m["key"] == "relaxation")
    assert relax["delta"] > 0 and relax["direction"] == "eased"
    assert by_title["3회차"]["state"] == "not_measured" and by_title["3회차"]["metrics"] == []
    text = str(body)
    for banned in ("score", "total", "rank", "average", "overall"):
        assert banned not in text.lower(), banned
    assert str(r_ok.id) in text


def test_v12_표본_부족은_수치없이_비교자료_부족():
    out = svc.summarize_change({"status": "not_computed", "reason": "insufficient_timeline"})
    assert out == {"state": "insufficient", "summary": "비교 자료 부족", "metrics": []}
    assert svc.summarize_change(None)["state"] == "no_data"


def test_v13_접속_필드_없음(client):
    db, c, u = _setup()
    text = (
        str(client.get("/api/v1/clients", headers=_h(c)).json())
        + str(client.get(f"/api/v1/clients/{u.id}", headers=_h(c)).json())
        + str(client.get(f"/api/v1/clients/{u.id}/activity", headers=_h(c)).json())
    ).lower()
    for banned in ("online", "last_seen", "last_login", "last_active_at"):
        assert banned not in text
