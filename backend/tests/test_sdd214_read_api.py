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


# ───────────────────────── 세계 구성 ─────────────────────────


@pytest.fixture
def world(client):
    users = {
        "host_a": _register(client, "rd-host-a@test.com"),
        "host_b": _register(client, "rd-host-b@test.com"),
        "org_admin": _register(client, "rd-orgadmin@test.com"),
        "platform_admin": _register(client, "rd-platadmin@test.com"),
        "member_a": _register(client, "rd-member-a@test.com", role="client"),
        "member_b": _register(client, "rd-member-b@test.com", role="client"),
        "removed": _register(client, "rd-removed@test.com", role="client"),
        "unrelated": _register(client, "rd-unrelated@test.com", role="client"),
    }
    _promote(users["org_admin"]["id"], "org_admin")
    _promote(users["platform_admin"]["id"], "platform_admin")

    db = _db()
    ha, hb = users["host_a"]["id"], users["host_b"]["id"]
    ma, mb = users["member_a"]["id"], users["member_b"]["id"]

    c1 = seed_class(db, host_id=ha, title="MBSR 봄", planned=4)
    c1s1 = seed_session(db, host_id=ha, class_id=c1.id, seq=1, status="completed", scheduled_at=NOW - timedelta(days=7), participants=[ma])
    c1s2 = seed_session(db, host_id=ha, class_id=c1.id, seq=2, status="scheduled", scheduled_at=NOW + timedelta(days=7), participants=[ma, users["removed"]["id"]])
    c1s3 = seed_session(db, host_id=ha, class_id=c1.id, seq=3, status="cancelled", scheduled_at=NOW + timedelta(days=14))
    c1hidden = seed_session(db, host_id=ha, class_id=c1.id, seq=4, hidden=True, scheduled_at=NOW + timedelta(days=21), participants=[ma])
    removed_row = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == c1s2.id, SessionParticipant.user_id == _uid(users["removed"]["id"]))
        .first()
    )
    removed_row.removed_at = NOW
    db.commit()

    c2 = seed_class(db, host_id=hb, title="걷기 명상", planned=None, access_code="5678")
    c2s1 = seed_session(db, host_id=hb, class_id=c2.id, seq=1, status="open", scheduled_at=NOW + timedelta(hours=1), participants=[ma])

    c_hidden = seed_class(db, host_id=ha, title="숨김 클래스", hidden=True, access_code="9999")
    seed_session(db, host_id=ha, class_id=c_hidden.id, seq=1, hidden=True)

    rel = seed_relationship(db, counselor_id=ha)
    r1 = seed_session(db, host_id=ha, relationship_id=rel.id, seq=1, status="completed", type_="clinical", scheduled_at=NOW - timedelta(days=3), participants=[mb])
    r2 = seed_session(db, host_id=ha, relationship_id=rel.id, seq=2, status="scheduled", type_="clinical", scheduled_at=NOW + timedelta(days=2))
    db.add(SessionRecord(session_id=r1.id, status="completed", transcript="비밀-전사-본문-XYZ"))
    db.add(Report(session_id=r1.id, user_id=_uid(mb), type="client", content={"summary": "비밀-리포트-본문-XYZ"}, generation_status="ready"))
    db.commit()

    template = seed_session(db, host_id=ha, seq=0, is_template=True, title="템플릿")

    result = {
        "users": users,
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
    paths = client.get("/openapi.json").json()["paths"]
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
    ["host_a", "host_b", "org_admin", "platform_admin", "member_a", "member_b", "removed", "unrelated"],
)
def test_RD2_새_API_로_도달하는_세션_집합은_GET_sessions_와_같다(client, world, role_key):
    headers = _h(world, role_key)
    assert _session_ids_from_parents(client, headers) == _session_ids_from_sessions_api(client, headers)


def test_RD2_시드가_비어있지_않다는_확인(client, world):
    assert len(_session_ids_from_sessions_api(client, _h(world, "host_a"))) == 5  # 명상 3(숨김 제외) + 상담 2, 템플릿 제외
    assert _session_ids_from_sessions_api(client, _h(world, "unrelated")) == set()
    assert _session_ids_from_sessions_api(client, _h(world, "org_admin")) == set()


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
    }
    assert item["id"] == str(world["c1"].id)
    assert item["area"] == "meditation"
    assert item["planned_session_count"] == 4
    assert item["progress"] == {"completed": 1, "total": 4}
    assert item["session_count"] == 3  # 숨김 회차 제외
    assert item["has_open_session"] is False
    nxt = item["next_session"]
    assert nxt["id"] == str(world["c1_sessions"][1].id) and nxt["seq"] == 2
    assert set(nxt) == {"id", "seq", "scheduled_at", "status", "host"}
    assert nxt["host"]["id"] == world["users"]["host_a"]["id"]


def test_클래스_목록_계획_횟수_없으면_분모는_취소_제외_가시_회차(client, world):
    item = client.get(f"{API}/classes", headers=_h(world, "host_b")).json()["classes"][0]
    assert item["planned_session_count"] is None
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
    assert host_view["access_code"] == "1234"
    assert [i["user_id"] for i in host_view["instructors"]] == [world["users"]["host_a"]["id"]]
    assert set(host_view["instructors"][0]) == {"user_id", "name", "role", "status"}


def test_RD6_회원_시점은_코드와_내부_필드가_없다(client, world):
    res = client.get(f"{API}/classes/{world['c1'].id}", headers=_h(world, "member_a"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["host_view"] is None
    text = res.text
    assert "1234" not in text
    for forbidden in ("access_code", "organization_attribution_known", "email", "legacy_access_code", "created_by"):
        assert forbidden not in text.replace('"host_view":null', ""), forbidden


def test_RD3_클래스_접근_오류는_세션_상세와_같은_상태코드와_메시지(client, world):
    outsider = _h(world, "unrelated")
    sid = world["c1_sessions"][0].id
    session_res = client.get(f"{API}/sessions/{sid}", headers=outsider)
    class_res = client.get(f"{API}/classes/{world['c1'].id}", headers=outsider)
    assert (class_res.status_code, class_res.json()) == (session_res.status_code, session_res.json()) == (403, {"detail": "접근 권한이 없습니다"})

    missing = uuid.uuid4()
    s404 = client.get(f"{API}/sessions/{missing}", headers=outsider)
    c404 = client.get(f"{API}/classes/{missing}", headers=outsider)
    assert (c404.status_code, c404.json()) == (s404.status_code, s404.json())

    s400 = client.get(f"{API}/sessions/not-a-uuid", headers=outsider)
    c400 = client.get(f"{API}/classes/not-a-uuid", headers=outsider)
    assert (c400.status_code, c400.json()) == (s400.status_code, s400.json())
    assert client.get(f"{API}/classes/{missing}/sessions", headers=outsider).status_code == 404


def test_RD3_상담_접근_오류도_같은_상태코드와_메시지(client, world):
    outsider = _h(world, "unrelated")
    session_res = client.get(f"{API}/sessions/{world['rel_sessions'][0].id}", headers=outsider)
    res = client.get(f"{API}/counseling/{world['rel'].id}", headers=outsider)
    assert (res.status_code, res.json()) == (session_res.status_code, session_res.json())
    missing = uuid.uuid4()
    assert client.get(f"{API}/counseling/{missing}", headers=outsider).status_code == 404
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


def test_RD5_제거된_참여자는_회원_시점에서_제외(client, world):
    headers = _h(world, "removed")
    assert client.get(f"{API}/classes", headers=headers).json()["total"] == 0
    assert client.get(f"{API}/classes/{world['c1'].id}", headers=headers).status_code == 403
    assert client.get(f"{API}/classes/{world['c1'].id}/sessions", headers=headers).status_code == 403


def test_클래스_회차_목록_필드와_순서(client, world):
    sessions = client.get(f"{API}/classes/{world['c1'].id}/sessions", headers=_h(world, "member_a")).json()["sessions"]
    # 회원은 자신이 참여한 회차만 본다(GET /sessions 와 동일 범위): seq 1·2
    assert [s["seq"] for s in sessions] == [1, 2]
    assert set(sessions[0]) == {"id", "seq", "scheduled_at", "status", "session_kind", "host", "host_state"}
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


def test_RD8_센터_관리자는_현행_가시_범위를_넘지_않는다(client, world):
    headers = _h(world, "org_admin")
    assert client.get(f"{API}/counseling", headers=headers).json()["total"] == 0
    assert client.get(f"{API}/classes", headers=headers).json()["total"] == 0
    assert client.get(f"{API}/counseling/{world['rel'].id}", headers=headers).status_code == 403


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
    try:
        def make(n: int) -> None:
            for i in range(n):
                c = seed_class(db, host_id=host["id"], title=f"부하 {i}", access_code=None)
                for seq in (1, 2):
                    seed_session(db, host_id=host["id"], class_id=c.id, seq=seq, scheduled_at=NOW + timedelta(days=seq), participants=[world["users"]["member_a"]["id"]])
                r = seed_relationship(db, counselor_id=host["id"], placeholder=False)
                seed_session(db, host_id=host["id"], relationship_id=r.id, seq=1, type_="clinical")

        make(2)
        def _get(path: str) -> None:
            assert client.get(f"{API}{path}", headers=host["h"]).status_code == 200

        small = (_count_queries(db, lambda: _get("/classes")), _count_queries(db, lambda: _get("/counseling")))
        make(20)
        large = (_count_queries(db, lambda: _get("/classes")), _count_queries(db, lambda: _get("/counseling")))
    finally:
        db.close()
    assert large == small, (small, large)
    assert max(large) <= 10


# ───────────────────────── R4: SessionResponse 가산 필드 ─────────────────────────


def test_세션_응답_가산_필드_명상(client, world):
    sid = world["c1_sessions"][1].id
    body = client.get(f"{API}/sessions/{sid}", headers=_h(world, "host_a")).json()
    assert body["class_id"] == str(world["c1"].id)
    assert body["class_title"] == "MBSR 봄"
    assert body["seq"] == 2
    assert body["area"] == "meditation"


def test_세션_응답_가산_필드_상담과_목록(client, world):
    rows = {s["id"]: s for s in client.get(f"{API}/sessions", headers=_h(world, "host_a")).json()["sessions"]}
    rel_row = rows[str(world["rel_sessions"][0].id)]
    assert rel_row["area"] == "counseling" and rel_row["seq"] == 1
    assert rel_row["class_id"] is None and rel_row["class_title"] is None
    class_row = rows[str(world["c1_sessions"][0].id)]
    assert class_row["area"] == "meditation" and class_row["class_title"] == "MBSR 봄"


def test_세션_응답_가산_필드_부모_없는_세션은_전부_null(client, world):
    host = world["users"]["host_a"]
    res = client.post(f"{API}/sessions", json={"type": "meditation", "duration_min": 30, "title": "부모 없음"}, headers=host["h"])
    assert res.status_code == 201, res.text
    body = res.json()
    for key in ("class_id", "class_title", "seq", "area"):
        assert key in body


def test_세션_응답_기존_필드는_바뀌지_않는다(client, world):
    body = client.get(f"{API}/sessions/{world['c1_sessions'][1].id}", headers=_h(world, "host_a")).json()
    for key in ("id", "run_id", "type", "status", "host_id", "host_name", "access_code", "participants", "waitlist_count", "created_at"):
        assert key in body
    assert json.dumps(body, default=str)  # 직렬화 가능
