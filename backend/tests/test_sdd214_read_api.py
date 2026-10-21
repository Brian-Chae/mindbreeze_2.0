"""SDD-214 R 트랙: 클래스·상담 읽기 API (GET /classes · /classes/{id} · /classes/{id}/sessions · /counseling · /counseling/{id})
와 SessionResponse 가산 필드(class_id · class_title · seq · area).

핵심 불변식(TD11/RD-2): 새 API 는 현행 `GET /sessions` 가시 범위를 넓히지도 좁히지도 않는다.
시드는 세션 생성 경로(P1, 병렬 작업 중)에 의존하지 않도록 모델을 직접 만든다. 아래 `seed_*` 헬퍼만 P1 경로 호출로 교체하면 된다.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.models.class_program import Class, ClassInstructor
from app.models.counseling import CounselingRelationship, CounselingRelationshipCounselor
from app.models.record import Report, SessionRecord
from app.models.session import Session, SessionParticipant
from app.services import class_read_service
from tests.test_sdd015_class_code import _db, _promote, _register

API = "/api/v1"
PLACEHOLDER_LABEL = "내담자 미지정"
NOW = datetime.now(timezone.utc)


# ───────────────────────── 시드 헬퍼 (P1 경로 완성 후 교체 대상) ─────────────────────────


def _uid(value: str) -> uuid.UUID:
    return uuid.UUID(value)


def seed_session(
    db,
    *,
    host_id: str,
    class_id: uuid.UUID | None = None,
    relationship_id: uuid.UUID | None = None,
    seq: int,
    status: str = "scheduled",
    scheduled_at: datetime | None = None,
    type_: str = "meditation",
    title: str | None = "회차",
    hidden: bool = False,
    is_template: bool = False,
    participants: list[str] | None = None,
) -> Session:
    session = Session(
        type=type_,
        status=status,
        host_id=_uid(host_id),
        duration_min=30,
        title=title,
        scheduled_at=scheduled_at,
        participant_mode="group" if class_id else "one_on_one",
        max_participants=10,
        class_id=class_id,
        counseling_relationship_id=relationship_id,
        seq=None if is_template else seq,
        host_state=None if is_template else "assigned",
        is_template=is_template,
        hidden_at=NOW if hidden else None,
    )
    db.add(session)
    db.flush()
    for user_id in participants or []:
        db.add(SessionParticipant(session_id=session.id, user_id=_uid(user_id)))
    db.commit()
    return session


def seed_class(
    db,
    *,
    host_id: str,
    title: str = "MBSR 봄",
    status: str = "active",
    planned: int | None = None,
    access_code: str | None = "1234",
    hidden: bool = False,
) -> Class:
    cls = Class(
        created_by=_uid(host_id),
        title=title,
        status=status,
        schedule_mode="fixed",
        planned_session_count=planned,
        default_duration_min=30,
        participant_mode="group",
        capacity=10,
        access_code=access_code,
        hidden_at=NOW if hidden else None,
    )
    db.add(cls)
    db.flush()
    db.add(ClassInstructor(class_id=cls.id, user_id=_uid(host_id), role="lead", status="active"))
    db.commit()
    return cls


def seed_relationship(
    db, *, counselor_id: str, placeholder: bool = True, client_user_id: str | None = None, status: str = "active"
) -> CounselingRelationship:
    rel = CounselingRelationship(
        counselor_id=_uid(counselor_id),
        client_user_id=_uid(client_user_id) if client_user_id else None,
        is_placeholder=placeholder,
        modality_default="clinical",
        status=status,
    )
    db.add(rel)
    db.flush()
    db.add(CounselingRelationshipCounselor(relationship_id=rel.id, counselor_id=_uid(counselor_id), status="active"))
    db.commit()
    return rel


# ───────────────────────── 세계 구성 (세션은 POST /sessions 실제 생성 경로로 만든다) ─────────────────────────


def _when(days: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def post_session(client, headers: dict, **overrides) -> dict:
    payload = {"type": "meditation", "duration_min": 30, "title": "명상", "participant_mode": "group", "max_participants": 10}
    payload.update(overrides)
    res = client.post(f"{API}/sessions", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _row(db, session_id: str) -> Session:
    return db.query(Session).execution_options(include_hidden=True).filter(Session.id == _uid(session_id)).one()


def _add_participant(db, session_id, user_id: str, **flags) -> SessionParticipant:
    row = SessionParticipant(session_id=session_id, user_id=_uid(user_id), **flags)
    db.add(row)
    db.commit()
    return row


@pytest.fixture
def world(client):
    users = {
        "host_a": _register(client, "rd-host-a@example.com"),
        "host_b": _register(client, "rd-host-b@example.com"),
        "org_admin": _register(client, "rd-orgadmin@example.com"),
        "platform_admin": _register(client, "rd-platadmin@example.com"),
        "member_a": _register(client, "rd-member-a@example.com", role="client"),
        "member_b": _register(client, "rd-member-b@example.com", role="client"),
        "removed": _register(client, "rd-removed@example.com", role="client"),
        "waitcancel": _register(client, "rd-waitcancel@example.com", role="client"),
        "unrelated": _register(client, "rd-unrelated@example.com", role="client"),
    }
    _promote(users["org_admin"]["id"], "org_admin")
    _promote(users["platform_admin"]["id"], "platform_admin")
    ha, hb = users["host_a"], users["host_b"]
    ma, mb = users["member_a"]["id"], users["member_b"]["id"]

    # 명상 클래스 C1: 첫 회차는 생성 경로, 2회차부터는 Phase 3 이전이라 시드 헬퍼로 같은 클래스에 더한다.
    post_c1 = post_session(client, ha["h"], title="MBSR 봄", scheduled_at=_when(30))
    # C2: 생성 직후 오픈 상태로 바꿔 열린 세션 사례로 쓴다.
    post_c2 = post_session(client, hb["h"], title="걷기 명상", scheduled_at=_when(31))
    # 숨김 클래스: 생성 후 세션과 클래스를 함께 숨긴다.
    post_hidden = post_session(client, ha["h"], title="숨김 클래스", scheduled_at=_when(32))
    # 상담: 같은 호스트의 두 번 생성은 같은 보관용 관계에 seq 1·2 로 들어간다.
    post_r1 = post_session(client, ha["h"], type="clinical", participant_mode="one_on_one", max_participants=1, title="상담 1", scheduled_at=_when(40))
    post_r2 = post_session(client, ha["h"], type="clinical", participant_mode="one_on_one", max_participants=1, title="상담 2", scheduled_at=_when(41))
    post_template = client.post(f"{API}/sessions/{post_c2['id']}/save-as-template", json={}, headers=hb["h"])
    assert post_template.status_code == 201, post_template.text

    db = _db()
    c1s1 = _row(db, post_c1["id"])
    c1 = db.query(Class).filter(Class.id == c1s1.class_id).one()
    c1.planned_session_count = 4
    c1s1.status, c1s1.scheduled_at = "completed", NOW - timedelta(days=7)
    db.commit()
    c1s2 = seed_session(db, host_id=ha["id"], class_id=c1.id, seq=2, status="scheduled", scheduled_at=NOW + timedelta(days=7))
    c1s3 = seed_session(db, host_id=ha["id"], class_id=c1.id, seq=3, status="cancelled", scheduled_at=NOW + timedelta(days=14))
    c1hidden = seed_session(db, host_id=ha["id"], class_id=c1.id, seq=4, hidden=True, scheduled_at=NOW + timedelta(days=21))
    _add_participant(db, c1s1.id, ma)
    _add_participant(db, c1s2.id, ma)
    _add_participant(db, c1hidden.id, ma)
    _add_participant(db, c1s2.id, users["removed"]["id"], removed_at=NOW)
    _add_participant(db, c1s2.id, users["waitcancel"]["id"], is_waitlisted=True, waitlist_cancelled_at=NOW)

    c2s1 = _row(db, post_c2["id"])
    c2 = db.query(Class).filter(Class.id == c2s1.class_id).one()
    c2s1.status, c2s1.scheduled_at = "open", NOW + timedelta(hours=1)
    db.commit()
    _add_participant(db, c2s1.id, ma)
    _add_participant(db, c2s1.id, users["org_admin"]["id"])

    hidden_session = _row(db, post_hidden["id"])
    c_hidden = db.query(Class).filter(Class.id == hidden_session.class_id).one()
    hidden_session.hidden_at = c_hidden.hidden_at = NOW
    db.commit()

    r1, r2 = _row(db, post_r1["id"]), _row(db, post_r2["id"])
    rel = db.query(CounselingRelationship).filter(CounselingRelationship.id == r1.counseling_relationship_id).one()
    assert r2.counseling_relationship_id == rel.id
    r1.status, r1.scheduled_at = "completed", NOW - timedelta(days=3)
    r2.scheduled_at = NOW + timedelta(days=2)
    db.add(SessionRecord(session_id=r1.id, status="completed", transcript="비밀-전사-본문-XYZ"))
    db.add(Report(session_id=r1.id, user_id=_uid(mb), type="client", content={"summary": "비밀-리포트-본문-XYZ"}, generation_status="ready"))
    db.commit()
    _add_participant(db, r1.id, mb)
    _add_participant(db, r1.id, users["platform_admin"]["id"])

    template = db.query(Session).filter(Session.id == _uid(post_template.json()["id"])).one()

    result = {
        "users": users,
        "posts": {"c1": post_c1, "c2": post_c2, "r1": post_r1, "r2": post_r2},
        "c1": c1, "c1_sessions": [c1s1, c1s2, c1s3, c1hidden],
        "c2": c2, "c2_sessions": [c2s1],
        "c_hidden": c_hidden,
        "rel": rel, "rel_sessions": [r1, r2],
        "template": template,
    }
    yield result
    db.close()


def _h(world, key: str) -> dict:
    return world["users"][key]["h"]


def _session_ids_from_sessions_api(client, headers) -> set[str]:
    res = client.get(f"{API}/sessions", headers=headers)
    assert res.status_code == 200, res.text
    return {s["id"] for s in res.json()["sessions"]}


def _session_ids_from_parents(client, headers) -> set[str]:
    ids: set[str] = set()
    classes = client.get(f"{API}/classes", headers=headers)
    assert classes.status_code == 200, classes.text
    for item in classes.json()["classes"]:
        sessions = client.get(f"{API}/classes/{item['id']}/sessions", headers=headers)
        assert sessions.status_code == 200, sessions.text
        ids |= {s["id"] for s in sessions.json()["sessions"]}
    relations = client.get(f"{API}/counseling", headers=headers)
    assert relations.status_code == 200, relations.text
    for item in relations.json()["relationships"]:
        detail = client.get(f"{API}/counseling/{item['id']}", headers=headers)
        assert detail.status_code == 200, detail.text
        ids |= {s["id"] for s in detail.json()["sessions"]}
    return ids


# ───────────────────────── RD-1 / RD-13 라우트 ─────────────────────────


def test_RD1_5개_엔드포인트가_openapi에_등록된다(client):
    # SDD-220: 운영(기본 environment=production)에서는 /openapi.json 을 노출하지 않으므로 스키마를 앱에서 직접 읽는다.
    paths = client.app.openapi()["paths"]
    for path in (
        f"{API}/classes",
        f"{API}/classes/{{class_id}}",
        f"{API}/classes/{{class_id}}/sessions",
        f"{API}/counseling",
        f"{API}/counseling/{{relationship_id}}",
    ):
        assert path in paths and "get" in paths[path], path


def test_RD13_기존_class_접두사_라우트와_충돌하지_않는다(client):
    from app.main import app

    singular = {r.path for r in app.routes if getattr(r, "path", "").startswith(f"{API}/class/")}
    plural = {r.path for r in app.routes if getattr(r, "path", "").startswith((f"{API}/classes", f"{API}/counseling"))}
    assert singular and not (singular & plural)
    assert all(not p.startswith(f"{API}/classes") for p in singular)


def test_RD15_인증_없으면_401(client):
    for path in ("/classes", f"/classes/{uuid.uuid4()}", f"/classes/{uuid.uuid4()}/sessions", "/counseling", f"/counseling/{uuid.uuid4()}"):
        assert client.get(f"{API}{path}").status_code == 401, path


# ───────────────────────── RD-2 동치성 ─────────────────────────


@pytest.mark.parametrize(
    "role_key",
    ["host_a", "host_b", "org_admin", "platform_admin", "member_a", "member_b", "removed", "waitcancel", "unrelated"],
)
def test_RD2_새_API_로_도달하는_세션_집합은_GET_sessions_와_같다(client, world, role_key):
    headers = _h(world, role_key)
    if role_key == "org_admin":
        # SDD-216 D-28: 기존 본문 목록은 비우고 부모 운영 메타 경로를 사용한다.
        assert _session_ids_from_sessions_api(client, headers) == set()
        assert _session_ids_from_parents(client, headers) == {str(world["c2_sessions"][0].id)}
    else:
        assert _session_ids_from_parents(client, headers) == _session_ids_from_sessions_api(client, headers)


def test_RD2_시드가_역할별로_기대한_집합을_만든다(client, world):
    def ids(key):
        return _session_ids_from_sessions_api(client, _h(world, key))

    assert len(ids("host_a")) == 5  # 명상 3(숨김 제외) + 상담 2, 템플릿·숨김 클래스 제외
    assert ids("org_admin") == set()
    assert ids("platform_admin") == {str(world["rel_sessions"][0].id)}
    for key in ("unrelated", "removed", "waitcancel"):
        assert ids(key) == set(), key


# ───────────────────────── GET /classes ─────────────────────────


def test_클래스_목록_호스트_시점_필드와_진행률(client, world):
    res = client.get(f"{API}/classes", headers=_h(world, "host_a"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1  # 숨김 클래스 제외
    item = body["classes"][0]
    assert set(item) == {
        "id", "title", "status", "schedule_mode", "planned_session_count", "area",
        "progress", "session_count", "next_session", "has_open_session",
        "is_instant",  # SDD-226 가산
    }
    assert item["id"] == str(world["c1"].id)
    assert item["area"] == "meditation"
    assert item["planned_session_count"] == 4
    # 계획 4회 중 취소 1회는 분모에서 빠진다(RD-10)
    assert item["progress"] == {"completed": 1, "total": 3}
    assert item["session_count"] == 3  # 숨김 회차 제외, 취소 회차는 포함
    assert item["has_open_session"] is False
    nxt = item["next_session"]
    assert nxt["id"] == str(world["c1_sessions"][1].id) and nxt["seq"] == 2
    assert set(nxt) == {"id", "seq", "scheduled_at", "status", "host"}
    assert nxt["host"]["id"] == world["users"]["host_a"]["id"]


def test_클래스_목록_생성_경로가_만든_클래스는_계획_1회이고_열린_세션을_표시(client, world):
    item = client.get(f"{API}/classes", headers=_h(world, "host_b")).json()["classes"][0]
    assert item["planned_session_count"] == 1
    assert item["progress"] == {"completed": 0, "total": 1}
    assert item["has_open_session"] is True
    assert item["next_session"]["id"] == str(world["c2_sessions"][0].id)


def test_클래스_목록_회원은_참여한_회차가_속한_클래스만(client, world):
    ids = {c["id"] for c in client.get(f"{API}/classes", headers=_h(world, "member_a")).json()["classes"]}
    assert ids == {str(world["c1"].id), str(world["c2"].id)}
    assert client.get(f"{API}/classes", headers=_h(world, "unrelated")).json() == {"classes": [], "total": 0}


def test_클래스_목록_모든_회차가_완료면_다음_회차_없음(client, world):
    db = _db()
    try:
        host = world["users"]["host_a"]["id"]
        done = seed_class(db, host_id=host, title="끝난 클래스", status="completed", access_code=None)
        seed_session(db, host_id=host, class_id=done.id, seq=1, status="completed", scheduled_at=NOW - timedelta(days=1))
    finally:
        db.close()
    items = {c["title"]: c for c in client.get(f"{API}/classes", headers=_h(world, "host_a")).json()["classes"]}
    assert items["끝난 클래스"]["next_session"] is None
    assert items["끝난 클래스"]["progress"] == {"completed": 1, "total": 1}


def test_클래스_목록_status_필터와_페이지네이션(client, world):
    db = _db()
    try:
        host = world["users"]["host_a"]["id"]
        for i in range(3):
            c = seed_class(db, host_id=host, title=f"추가 {i}", status="completed", access_code=None)
            seed_session(db, host_id=host, class_id=c.id, seq=1, status="completed")
    finally:
        db.close()
    headers = _h(world, "host_a")
    completed = client.get(f"{API}/classes", params={"status": "completed"}, headers=headers).json()
    assert completed["total"] == 3 and all(c["status"] == "completed" for c in completed["classes"])
    page = client.get(f"{API}/classes", params={"page": 2, "limit": 2}, headers=headers).json()
    assert page["total"] == 4 and len(page["classes"]) == 2
    assert client.get(f"{API}/classes", params={"limit": 101}, headers=headers).status_code == 422


# ───────────────────────── GET /classes/{id} ─────────────────────────


def test_클래스_상세_호스트_시점은_강사와_코드를_포함(client, world):
    res = client.get(f"{API}/classes/{world['c1'].id}", headers=_h(world, "host_a"))
    assert res.status_code == 200, res.text
    body = res.json()
    for key in ("location_type", "location_address", "linkband_mode", "record_audio", "capacity", "participant_mode", "default_duration_min"):
        assert key in body
    host_view = body["host_view"]
    assert host_view["access_code"] == world["posts"]["c1"]["access_code"] and host_view["access_code"]
    assert [i["user_id"] for i in host_view["instructors"]] == [world["users"]["host_a"]["id"]]
    assert set(host_view["instructors"][0]) == {"user_id", "name", "role", "status"}


def test_RD6_회원_시점은_코드와_내부_필드가_없다(client, world):
    res = client.get(f"{API}/classes/{world['c1'].id}", headers=_h(world, "member_a"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["host_view"] is None
    text = res.text
    assert world["posts"]["c1"]["access_code"] not in text
    for forbidden in ("access_code", "organization_attribution_known", "email", "legacy_access_code", "created_by"):
        assert forbidden not in text.replace('"host_view":null', ""), forbidden


def test_RD3_클래스_접근_불가와_미존재는_같은_404(client, world):
    # 존재 여부 비노출(plan §7.1): 접근 불가·미존재·숨김이 바이트 단위로 같은 응답이다. 기존 /sessions 는 바꾸지 않는다.
    outsider = _h(world, "unrelated")
    missing = uuid.uuid4()
    paths = (
        lambda cid: f"{API}/classes/{cid}",
        lambda cid: f"{API}/classes/{cid}/sessions",
    )
    for build in paths:
        responses = [
            client.get(build(world["c1"].id), headers=outsider),      # 존재하지만 접근 불가
            client.get(build(missing), headers=outsider),             # 미존재
            client.get(build(world["c_hidden"].id), headers=_h(world, "host_a")),  # 숨김
        ]
        assert {(r.status_code, r.text) for r in responses} == {(404, responses[0].text)}, [(r.status_code, r.text) for r in responses]
        assert responses[0].json() == {"detail": "세션을 찾을 수 없습니다"}
    # 형식 오류는 존재 여부와 무관하므로 400 을 유지한다.
    assert client.get(f"{API}/classes/not-a-uuid", headers=outsider).status_code == 400


def test_RD3_기존_세션_상세_응답은_변경되지_않는다(client, world):
    outsider = _h(world, "unrelated")
    res = client.get(f"{API}/sessions/{world['c1_sessions'][0].id}", headers=outsider)
    assert (res.status_code, res.json()) == (403, {"detail": "접근 권한이 없습니다"})
    assert client.get(f"{API}/sessions/{uuid.uuid4()}", headers=outsider).status_code == 404
    assert client.get(f"{API}/sessions/not-a-uuid", headers=outsider).status_code == 400


def test_RD3_상담_접근_불가와_미존재는_같은_404(client, world):
    outsider = _h(world, "unrelated")
    responses = [
        client.get(f"{API}/counseling/{world['rel'].id}", headers=outsider),
        client.get(f"{API}/counseling/{uuid.uuid4()}", headers=outsider),
        client.get(f"{API}/counseling/{world['rel'].id}", headers=_h(world, "member_a")),  # 관계는 있으나 이 사용자의 회차 없음
    ]
    assert {(r.status_code, r.text) for r in responses} == {(404, responses[0].text)}
    assert responses[0].json() == {"detail": "세션을 찾을 수 없습니다"}
    assert client.get(f"{API}/counseling/not-a-uuid", headers=outsider).status_code == 400


def test_RD4_숨김_클래스는_목록_상세_회차에서_제외(client, world):
    headers = _h(world, "host_a")
    assert str(world["c_hidden"].id) not in {c["id"] for c in client.get(f"{API}/classes", headers=headers).json()["classes"]}
    assert client.get(f"{API}/classes/{world['c_hidden'].id}", headers=headers).status_code == 404
    assert client.get(f"{API}/classes/{world['c_hidden'].id}/sessions", headers=headers).status_code == 404


def test_RD4_숨김_회차는_회차_목록에서_제외(client, world):
    res = client.get(f"{API}/classes/{world['c1'].id}/sessions", headers=_h(world, "host_a"))
    assert res.status_code == 200
    body = res.json()
    assert [s["seq"] for s in body["sessions"]] == [1, 2, 3]
    assert body["total"] == 3
    assert str(world["c1_sessions"][3].id) not in res.text


def test_RD5_제거_대기취소_참여자는_회원_시점에서_제외(client, world):
    for key in ("removed", "waitcancel"):
        headers = _h(world, key)
        assert client.get(f"{API}/classes", headers=headers).json()["total"] == 0, key
        assert client.get(f"{API}/classes/{world['c1'].id}", headers=headers).status_code == 404, key
        assert client.get(f"{API}/classes/{world['c1'].id}/sessions", headers=headers).status_code == 404, key
        assert client.get(f"{API}/counseling", headers=headers).json()["total"] == 0, key


def test_RD5_참여자_행이_되살아나면_다시_보인다(client, world):
    db = _db()
    try:
        row = db.query(SessionParticipant).execution_options(include_removed=True).filter(
            SessionParticipant.user_id == _uid(world["users"]["waitcancel"]["id"])
        ).one()
        row.waitlist_cancelled_at = None
        db.commit()
    finally:
        db.close()
    headers = _h(world, "waitcancel")
    assert client.get(f"{API}/classes", headers=headers).json()["total"] == 1
    assert _session_ids_from_parents(client, headers) == _session_ids_from_sessions_api(client, headers) != set()


def test_클래스_회차_목록_필드와_순서(client, world):
    sessions = client.get(f"{API}/classes/{world['c1'].id}/sessions", headers=_h(world, "member_a")).json()["sessions"]
    # 회원은 자신이 참여한 회차만 본다(GET /sessions 와 동일 범위): seq 1·2
    assert [s["seq"] for s in sessions] == [1, 2]
    assert set(sessions[0]) == {"id", "seq", "scheduled_at", "status", "session_kind", "host", "host_state", "state_version", "duration_min", "location_type", "location_address", "assignment_override"}
    assert set(sessions[0]["host"]) == {"id", "name"}
    assert sessions[0]["session_kind"] == "regular" and sessions[0]["host_state"] == "assigned"


# ───────────────────────── 상담 ─────────────────────────


def test_상담_목록_상담사_시점(client, world):
    res = client.get(f"{API}/counseling", headers=_h(world, "host_a"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    item = body["relationships"][0]
    assert set(item) == {
        "id", "status", "area", "counselor", "client_display", "modality_default",
        "session_count", "next_session", "latest_session",
    }
    assert item["id"] == str(world["rel"].id)
    assert item["area"] == "counseling"
    assert item["client_display"] == PLACEHOLDER_LABEL
    assert item["session_count"] == 2
    assert item["counselor"] == {"id": world["users"]["host_a"]["id"], "name": item["counselor"]["name"]}
    assert item["next_session"]["seq"] == 2
    assert item["latest_session"]["seq"] == 1 and item["latest_session"]["status"] == "completed"


def test_상담_목록_회원은_참여한_회차가_속한_관계만(client, world):
    assert [r["id"] for r in client.get(f"{API}/counseling", headers=_h(world, "member_b")).json()["relationships"]] == [str(world["rel"].id)]
    assert client.get(f"{API}/counseling", headers=_h(world, "member_a")).json()["total"] == 0


def test_RD11_상담_상세는_회차와_진행_상태_값만(client, world):
    res = client.get(f"{API}/counseling/{world['rel'].id}", headers=_h(world, "member_b"))
    assert res.status_code == 200, res.text
    body = res.json()
    # member_b 는 1회차에만 참여 → 2회차는 가시 범위 밖
    assert [s["seq"] for s in body["sessions"]] == [1]
    row = body["sessions"][0]
    assert set(row) == {"id", "seq", "scheduled_at", "status", "type", "record_status", "report_status"}
    assert row["record_status"] == "completed" and row["report_status"] == "ready"
    assert body["client_display"] == PLACEHOLDER_LABEL


def test_RD7_어떤_응답에도_본문이_없다(client, world):
    forbidden = ("비밀-전사-본문-XYZ", "비밀-리포트-본문-XYZ", "transcript", "eeg", "raw_data", "audio_url", "counselor_notes", "markers", "content")
    class_paths = ("/classes", f"/classes/{world['c1'].id}", f"/classes/{world['c1'].id}/sessions")
    counseling_paths = ("/counseling", f"/counseling/{world['rel'].id}")
    cases = (
        ("host_a", class_paths + counseling_paths),
        ("member_a", class_paths),
        ("member_b", counseling_paths),
    )
    for who, paths in cases:
        for path in paths:
            res = client.get(f"{API}{path}", headers=_h(world, who))
            assert res.status_code == 200, (who, path, res.status_code)
            for word in forbidden:
                assert word not in res.text, (who, path, word)


def test_RD8_관리자_응답은_회원_시점과_같이_마스킹된다(client, world):
    # org_admin 은 C2 의 참여자, platform_admin 은 상담 1회차의 참여자일 뿐이다 — 관리자라는 이유로 더 보이지 않는다.
    org = _h(world, "org_admin")
    classes = client.get(f"{API}/classes", headers=org).json()
    assert [c["id"] for c in classes["classes"]] == [str(world["c2"].id)]
    detail = client.get(f"{API}/classes/{world['c2'].id}", headers=org)
    assert detail.status_code == 200 and detail.json()["host_view"] is None
    code = world["posts"]["c2"]["access_code"]
    assert code and code not in detail.text and "instructors" not in detail.text
    assert client.get(f"{API}/classes/{world['c1'].id}", headers=org).status_code == 404
    assert client.get(f"{API}/counseling", headers=org).json()["total"] == 0
    assert client.get(f"{API}/counseling/{world['rel'].id}", headers=org).status_code == 404

    platform = _h(world, "platform_admin")
    assert client.get(f"{API}/classes", headers=platform).json()["total"] == 0
    rel = client.get(f"{API}/counseling/{world['rel'].id}", headers=platform)
    assert rel.status_code == 200
    assert [x["seq"] for x in rel.json()["sessions"]] == [1]  # 참여한 회차만
    assert rel.json()["sessions"][0]["report_status"] is None  # 타인의 리포트 진행 상태는 보이지 않는다
    assert "비밀" not in rel.text


def test_상담_비보관용_관계의_내담자_표시는_상담사와_본인에게만(client, world):
    db = _db()
    try:
        ha, mb = world["users"]["host_a"]["id"], world["users"]["member_b"]["id"]
        rel = seed_relationship(db, counselor_id=ha, placeholder=False, client_user_id=mb)
        seed_session(db, host_id=ha, relationship_id=rel.id, seq=1, type_="hypnosis", participants=[mb])
        rel_id = str(rel.id)
    finally:
        db.close()
    counselor_view = client.get(f"{API}/counseling/{rel_id}", headers=_h(world, "host_a")).json()
    member_view = client.get(f"{API}/counseling/{rel_id}", headers=_h(world, "member_b")).json()
    assert counselor_view["client_display"] == "client-rd-member-b"
    assert member_view["client_display"] == "client-rd-member-b"


def test_상담_관계_status_필터(client, world):
    headers = _h(world, "host_a")
    assert client.get(f"{API}/counseling", params={"status": "closed"}, headers=headers).json()["total"] == 0
    assert client.get(f"{API}/counseling", params={"status": "active"}, headers=headers).json()["total"] == 1


# ───────────────────────── RD-12 성능(N+1 없음) ─────────────────────────


def _count_queries(db, call) -> int:
    engine = db.get_bind()
    counter = {"n": 0}

    def _on_execute(*_args, **_kwargs):
        counter["n"] += 1

    event.listen(engine, "before_cursor_execute", _on_execute)
    try:
        call()
    finally:
        event.remove(engine, "before_cursor_execute", _on_execute)
    return counter["n"]


def test_RD12_목록_질의_수는_항목_수에_비례하지_않는다(client, world):
    db = _db()
    host = world["users"]["host_a"]
    member = world["users"]["member_a"]["id"]
    counter = {"n": 0}
    try:
        def make(n: int) -> None:
            for _ in range(n):
                counter["n"] += 1
                body = post_session(client, host["h"], title=f"부하 {counter['n']}", scheduled_at=_when(100 + counter["n"]))
                first = _row(db, body["id"])
                _add_participant(db, first.id, member)
                second = seed_session(db, host_id=host["id"], class_id=first.class_id, seq=2, scheduled_at=NOW + timedelta(days=200 + counter["n"]), participants=[member])
                assert second.class_id == first.class_id
                rel = seed_relationship(db, counselor_id=host["id"], placeholder=False)
                seed_session(db, host_id=host["id"], relationship_id=rel.id, seq=1, type_="clinical")

        def _get(path: str) -> None:
            assert client.get(f"{API}{path}", headers=host["h"]).status_code == 200

        make(2)
        small = (_count_queries(db, lambda: _get("/classes")), _count_queries(db, lambda: _get("/counseling")))
        make(20)
        large = (_count_queries(db, lambda: _get("/classes")), _count_queries(db, lambda: _get("/counseling")))
    finally:
        db.close()
    assert large == small, (small, large)
    assert max(large) <= 10


# ───────────────────────── R4: SessionResponse 가산 필드 ─────────────────────────

PRESERVED_KEYS = (
    "id", "run_id", "type", "status", "host_id", "title", "duration_min", "max_participants",
    "participant_mode", "location_type", "access_code", "scheduled_at", "linkband_mode", "is_template",
)


def test_R4_POST_명상_생성_응답의_가산_필드는_정확한_값(client, world):
    host = world["users"]["host_a"]
    body = post_session(client, host["h"], title="가산 확인", scheduled_at=_when(60))
    db = _db()
    try:
        row = _row(db, body["id"])
        assert row.class_id is not None
        assert (body["class_id"], body["class_title"], body["seq"], body["area"]) == (
            str(row.class_id), "가산 확인", 1, "meditation",
        )
    finally:
        db.close()


def test_R4_POST_상담_생성_응답의_가산_필드는_정확한_값(client, world):
    host = world["users"]["host_b"]
    first = post_session(client, host["h"], type="clinical", participant_mode="one_on_one", max_participants=1, scheduled_at=_when(70))
    second = post_session(client, host["h"], type="hypnosis", participant_mode="one_on_one", max_participants=1, scheduled_at=_when(71))
    for body, seq in ((first, 1), (second, 2)):
        assert (body["class_id"], body["class_title"], body["seq"], body["area"]) == (None, None, seq, "counseling")
    assert client.get(f"{API}/counseling", headers=host["h"]).json()["relationships"][0]["session_count"] == 2


def test_R4_POST_응답은_GET_상세와_기존_필드_값이_같고_가산_필드도_일치(client, world):
    host = world["users"]["host_a"]
    created = post_session(client, host["h"], title="보존 확인", scheduled_at=_when(80), max_participants=7)
    fetched = client.get(f"{API}/sessions/{created['id']}", headers=host["h"]).json()
    assert created["title"] == "보존 확인" and created["max_participants"] == 7 and created["status"] == "scheduled"
    assert created["host_id"] == host["id"] and created["type"] == "meditation"
    for key in PRESERVED_KEYS:
        assert created[key] == fetched[key], key
    for key in ("class_id", "class_title", "seq", "area"):
        assert created[key] == fetched[key], key
        assert created[key] is not None, key
    assert fetched["class_title"] == "보존 확인" and fetched["seq"] == 1 and fetched["area"] == "meditation"


def test_R4_목록_응답에도_정확한_가산_값(client, world):
    rows = {s["id"]: s for s in client.get(f"{API}/sessions", headers=_h(world, "host_a")).json()["sessions"]}
    class_row = rows[str(world["c1_sessions"][1].id)]
    assert (class_row["class_id"], class_row["class_title"], class_row["seq"], class_row["area"]) == (
        str(world["c1"].id), "MBSR 봄", 2, "meditation",
    )
    rel_row = rows[str(world["rel_sessions"][1].id)]
    assert (rel_row["class_id"], rel_row["class_title"], rel_row["seq"], rel_row["area"]) == (None, None, 2, "counseling")


def test_R4_다른_엔드포인트_응답에도_가산_필드가_붙는다(client, world):
    host = world["users"]["host_a"]
    sid = post_session(client, host["h"], title="수정 대상", scheduled_at=_when(95))["id"]
    updated = client.put(f"{API}/sessions/{sid}", json={"notes": "메모"}, headers=host["h"])
    assert updated.status_code == 200, updated.text
    assert (updated.json()["class_title"], updated.json()["seq"], updated.json()["area"]) == ("수정 대상", 1, "meditation")
    duplicated = client.post(f"{API}/sessions/{sid}/duplicate", json={"scheduled_at": _when(90)}, headers=host["h"])
    assert duplicated.status_code == 201, duplicated.text
    assert duplicated.json()["area"] == "meditation" and duplicated.json()["class_id"] != updated.json()["class_id"]


def test_R4_템플릿_응답은_부모가_없어_가산_필드가_전부_null(client, world):
    template = client.post(
        f"{API}/sessions/{world['posts']['c2']['id']}/save-as-template", json={}, headers=_h(world, "host_b")
    ).json()
    assert template["is_template"] is True
    assert (template["class_id"], template["class_title"], template["seq"], template["area"]) == (None, None, None, None)


# ───────────────────────── 진행률 · 다음 회차 (RD-10) ─────────────────────────


def _make_class(db, host_id: str, title: str, planned: int | None, specs: list[tuple[str, datetime | None]]) -> Class:
    cls = seed_class(db, host_id=host_id, title=title, planned=planned, access_code=None)
    for seq, (status, at) in enumerate(specs, start=1):
        seed_session(db, host_id=host_id, class_id=cls.id, seq=seq, status=status, scheduled_at=at, participants=[])
    return cls


def _summary(db, host_id: str, title: str, now: datetime) -> dict:
    items, _ = class_read_service.list_classes(host_id, db, now=now)
    return next(i for i in items if i["title"] == title)


def test_RD10_계획_횟수가_있어도_취소_회차는_분모에서_제외(client, world):
    db = _db()
    try:
        host = world["users"]["host_a"]["id"]
        _make_class(db, host, "계획 있음 취소 2", 8, [("completed", NOW - timedelta(days=2)), ("cancelled", None), ("cancelled", None), ("scheduled", NOW + timedelta(days=1))])
        _make_class(db, host, "계획 있음 취소 없음", 8, [("completed", NOW - timedelta(days=2)), ("scheduled", NOW + timedelta(days=1))])
        assert _summary(db, host, "계획 있음 취소 2", NOW)["progress"] == {"completed": 1, "total": 6}
        assert _summary(db, host, "계획 있음 취소 없음", NOW)["progress"] == {"completed": 1, "total": 8}
    finally:
        db.close()


def test_RD10_계획_횟수가_없으면_분모는_취소_제외_가시_회차(client, world):
    db = _db()
    try:
        host = world["users"]["host_a"]["id"]
        _make_class(db, host, "계획 없음 취소 1", None, [("completed", NOW - timedelta(days=2)), ("cancelled", None), ("scheduled", NOW + timedelta(days=1))])
        assert _summary(db, host, "계획 없음 취소 1", NOW)["progress"] == {"completed": 1, "total": 2}
    finally:
        db.close()


def test_RD10_취소가_계획보다_많아도_분모는_음수가_되지_않는다(client, world):
    db = _db()
    try:
        host = world["users"]["host_a"]["id"]
        _make_class(db, host, "과다 취소", 1, [("cancelled", None), ("cancelled", None)])
        assert _summary(db, host, "과다 취소", NOW)["progress"] == {"completed": 0, "total": 0}
    finally:
        db.close()


def test_RD10_다음_회차는_순번이_아니라_가장_가까운_미래_일정(client, world):
    # 순번 역전: seq 2 가 seq 3 보다 늦은 일정이다.
    db = _db()
    try:
        host = world["users"]["host_a"]["id"]
        cls = _make_class(db, host, "순번 역전", None, [("completed", NOW - timedelta(days=1)), ("scheduled", NOW + timedelta(days=10)), ("scheduled", NOW + timedelta(days=3))])
        nxt = _summary(db, host, "순번 역전", NOW)["next_session"]
        assert nxt["seq"] == 3
        assert nxt["id"] == str(db.query(Session).filter(Session.class_id == cls.id, Session.seq == 3).one().id)
    finally:
        db.close()


def test_RD10_다음_회차는_취소_완료_회차와_과거_일정을_건너뛴다(client, world):
    db = _db()
    try:
        host = world["users"]["host_a"]["id"]
        _make_class(db, host, "건너뛰기", None, [
            ("cancelled", NOW + timedelta(days=1)),       # 취소 — 가장 가깝지만 제외
            ("completed", NOW + timedelta(days=2)),       # 완료 — 제외
            ("scheduled", NOW - timedelta(days=1)),       # 과거 미종료 — 후보 아님
            ("scheduled", NOW + timedelta(days=5)),
            ("scheduled", None),                          # 일정 미정 — 후보 아님
        ])
        assert _summary(db, host, "건너뛰기", NOW)["next_session"]["seq"] == 4
    finally:
        db.close()


def test_RD10_다음_회차_시각_경계는_현재_시각을_포함하고_1초_전은_제외(client, world):
    db = _db()
    try:
        host = world["users"]["host_a"]["id"]
        boundary = datetime(2030, 1, 1, 9, 0, 0, tzinfo=timezone.utc)
        _make_class(db, host, "경계 정각", None, [("scheduled", boundary)])
        _make_class(db, host, "경계 1초 전", None, [("scheduled", boundary - timedelta(seconds=1))])
        assert _summary(db, host, "경계 정각", boundary)["next_session"]["seq"] == 1
        assert _summary(db, host, "경계 1초 전", boundary)["next_session"] is None
    finally:
        db.close()


def test_RD10_같은_일정이면_순번이_작은_회차가_다음_회차(client, world):
    db = _db()
    try:
        host = world["users"]["host_a"]["id"]
        at = NOW + timedelta(days=4)
        _make_class(db, host, "동시각", None, [("scheduled", at), ("scheduled", at)])
        assert _summary(db, host, "동시각", NOW)["next_session"]["seq"] == 1
    finally:
        db.close()


def test_RD10_열린_세션_유무는_open_과_in_progress(client, world):
    db = _db()
    try:
        host = world["users"]["host_a"]["id"]
        _make_class(db, host, "진행 중", None, [("in_progress", NOW - timedelta(minutes=5))])
        _make_class(db, host, "대기 중", None, [("scheduled", NOW + timedelta(days=1))])
        assert _summary(db, host, "진행 중", NOW)["has_open_session"] is True
        assert _summary(db, host, "대기 중", NOW)["has_open_session"] is False
    finally:
        db.close()
