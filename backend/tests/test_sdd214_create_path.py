"""SDD-214 P1·P2 — 세션 생성 경로의 부모 동시 생성과 클래스 일관성 (verify CP-1~CP-9).

SQLite(기본 pytest)에서 서비스 동작을 검증한다. CHECK·복합 FK 같은 PG 제약 증거는 tests/pg/test_sdd214_create_path.py.
"""

import pytest

from app.models.class_program import Class, ClassInstructor
from app.models.counseling import CounselingRelationship, CounselingRelationshipCounselor
from app.models.session import Session
from tests.test_session import _create_payload, _register


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _all(db, model):
    return list(db.query(model).execution_options(include_hidden=True).all())


def _post(client, host, **overrides):
    res = client.post("/api/v1/sessions", json=_create_payload(**overrides), headers=host["auth"])
    assert res.status_code == 201, res.text
    return res.json()


def _row(db, session_id):
    return db.query(Session).execution_options(include_hidden=True).filter(Session.id == session_id).one()


def test_cp1_명상_생성은_클래스와_강사와_세션을_함께_만든다(client):
    host = _register(client, "cp1@test.com")
    body = _post(
        client, host, type="meditation", max_participants=8, participant_mode="group",
        title="아침 명상", notes="안내문", location_type="online", linkband_mode="optional",
    )
    db = _db()
    try:
        s = _row(db, body["id"])
        klass = db.get(Class, s.class_id)
        assert s.counseling_relationship_id is None
        assert (s.seq, s.host_state, s.session_kind) == (1, "assigned", "regular")
        assert klass.created_by == s.host_id
        assert klass.access_code == s.access_code
        assert (klass.title, klass.description, klass.capacity) == ("아침 명상", "안내문", 8)
        assert (klass.participant_mode, klass.linkband_mode, klass.location_type) == ("group", "optional", "online")
        assert klass.default_duration_min == s.duration_min
        assert (klass.record_audio, klass.record_video) == (s.record_audio, s.record_video)
        assert klass.organization_id == s.organization_id
        instructors = db.query(ClassInstructor).filter(ClassInstructor.class_id == klass.id).all()
        assert [(i.user_id, i.role, i.status) for i in instructors] == [(s.host_id, "lead", "active")]
    finally:
        db.close()


def test_cp1_그룹_상담유형도_명상_클래스에_배치된다(client):
    host = _register(client, "cp1g@test.com")
    body = _post(client, host, type="clinical", participant_mode="group", max_participants=4)
    db = _db()
    try:
        s = _row(db, body["id"])
        assert s.class_id is not None and s.counseling_relationship_id is None
        assert db.get(Class, s.class_id).participant_mode == "group"
    finally:
        db.close()


def test_cp2_상담_생성은_호스트별_보관용_관계를_재사용하고_seq를_잇는다(client):
    host = _register(client, "cp2@test.com")
    other = _register(client, "cp2o@test.com")
    a = _post(client, host, type="clinical")
    b = _post(client, host, type="hypnosis", scheduled_at=None)
    c = _post(client, other, type="clinical")
    db = _db()
    try:
        sa_, sb, sc = (_row(db, x["id"]) for x in (a, b, c))
        assert sa_.class_id is None and sa_.counseling_relationship_id is not None
        assert sa_.counseling_relationship_id == sb.counseling_relationship_id
        assert sc.counseling_relationship_id != sa_.counseling_relationship_id
        assert (sa_.seq, sb.seq, sc.seq) == (1, 2, 1)
        assert (sa_.host_state, sa_.session_kind) == ("assigned", "regular")
        rels = _all(db, CounselingRelationship)
        assert len(rels) == 2 and all(r.is_placeholder and r.status == "active" for r in rels)
        rel = db.get(CounselingRelationship, sa_.counseling_relationship_id)
        assert rel.counselor_id == sa_.host_id
        links = db.query(CounselingRelationshipCounselor).filter_by(relationship_id=rel.id).all()
        assert [(l.counselor_id, l.status) for l in links] == [(sa_.host_id, "active")]
    finally:
        db.close()


def test_cp3_분류_불가_X0이면_세션이_만들어지지_않는다(client, monkeypatch):
    from app.services import session_service
    from app.services.session_classifier import Classification, PARENT_UNCLASSIFIABLE, RULE_UNCLASSIFIABLE

    host = _register(client, "cp3@test.com")
    monkeypatch.setattr(
        session_service, "classify_session", lambda facts: Classification(PARENT_UNCLASSIFIABLE, RULE_UNCLASSIFIABLE)
    )
    res = client.post("/api/v1/sessions", json=_create_payload(), headers=host["auth"])
    assert res.status_code == 500
    db = _db()
    try:
        assert _all(db, Session) == [] and _all(db, Class) == [] and _all(db, CounselingRelationship) == []
    finally:
        db.close()


def test_cp3_부모_생성이_실패하면_세션도_남지_않는다(client, monkeypatch):
    from app.services import session_service

    host = _register(client, "cp3b@test.com")

    def _boom(*args, **kwargs):
        raise RuntimeError("부모 생성 실패")

    monkeypatch.setattr(session_service, "_attach_parent", _boom)
    with pytest.raises(RuntimeError):
        client.post("/api/v1/sessions", json=_create_payload(type="meditation"), headers=host["auth"])
    db = _db()
    try:
        assert _all(db, Session) == [] and _all(db, Class) == []
    finally:
        db.close()


def test_cp5_템플릿_생성과_템플릿_저장은_부모가_없다(client):
    host = _register(client, "cp5t@test.com")
    tpl = _post(client, host, type="meditation", is_template=True)
    src = _post(client, host, type="meditation")
    res = client.post(f"/api/v1/sessions/{src['id']}/save-as-template", json={}, headers=host["auth"])
    assert res.status_code in (200, 201), res.text
    db = _db()
    try:
        for sid in (tpl["id"], res.json()["id"]):
            s = _row(db, sid)
            assert s.is_template and s.class_id is None and s.counseling_relationship_id is None
            assert s.seq is None and s.host_state is None
        assert len(_all(db, Class)) == 1
    finally:
        db.close()


def test_cp5_복제본은_새_부모를_가진다(client):
    host = _register(client, "cp5d@test.com")
    src = _post(client, host, type="meditation", title="원본")
    res = client.post(f"/api/v1/sessions/{src['id']}/duplicate", json={}, headers=host["auth"])
    assert res.status_code in (200, 201), res.text
    db = _db()
    try:
        a, b = _row(db, src["id"]), _row(db, res.json()["id"])
        assert b.class_id is not None and b.class_id != a.class_id
        assert (b.seq, b.host_state) == (1, "assigned")
        klass = db.get(Class, b.class_id)
        assert klass.access_code == b.access_code and klass.title == "원본"
    finally:
        db.close()


def test_cp5_상담_복제본은_같은_보관용_관계의_다음_회차다(client):
    host = _register(client, "cp5r@test.com")
    src = _post(client, host, type="clinical")
    res = client.post(f"/api/v1/sessions/{src['id']}/duplicate", json={}, headers=host["auth"])
    assert res.status_code in (200, 201), res.text
    db = _db()
    try:
        a, b = _row(db, src["id"]), _row(db, res.json()["id"])
        assert a.counseling_relationship_id == b.counseling_relationship_id
        assert (a.seq, b.seq) == (1, 2)
        assert len(_all(db, CounselingRelationship)) == 1
    finally:
        db.close()


def test_cp5_템플릿에서_복제하면_실제_부모가_생긴다(client):
    host = _register(client, "cp5tt@test.com")
    tpl = _post(client, host, type="meditation", is_template=True)
    res = client.post(f"/api/v1/sessions/{tpl['id']}/duplicate", json={}, headers=host["auth"])
    assert res.status_code in (200, 201), res.text
    db = _db()
    try:
        s = _row(db, res.json()["id"])
        assert not s.is_template and s.class_id is not None and s.seq == 1
    finally:
        db.close()


def test_cp5_new_run은_세션도_부모도_새로_만들지_않는다(client):
    host = _register(client, "cp5n@test.com")
    src = _post(client, host, type="meditation", scheduled_at=None)
    before = len(_all(_db(), Session)), len(_all(_db(), Class))
    res = client.post(f"/api/v1/sessions/{src['id']}/new-run", headers=host["auth"])
    assert res.status_code == 200, res.text
    db = _db()
    try:
        assert (len(_all(db, Session)), len(_all(db, Class))) == before
    finally:
        db.close()


def test_cp7_PUT은_가시_세션이_1개인_클래스에_설정을_반영한다(client):
    host = _register(client, "cp7@test.com")
    body = _post(client, host, type="meditation", scheduled_at=None, title="전", max_participants=5)
    res = client.put(
        f"/api/v1/sessions/{body['id']}",
        json={
            "title": "후", "notes": "새 안내", "max_participants": 9, "duration_min": 30,
            "participant_mode": "group", "linkband_mode": "required", "location_type": "online",
            "record_audio": False, "record_video": False, "chat_enabled": True, "sfu_enabled": True,
            "reminder_offsets": [60],
        },
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text
    db = _db()
    try:
        s = _row(db, body["id"])
        k = db.get(Class, s.class_id)
        assert (k.title, k.description, k.capacity, k.default_duration_min) == ("후", "새 안내", 9, 30)
        assert (k.participant_mode, k.linkband_mode, k.location_type) == ("group", "required", "online")
        assert (k.record_audio, k.record_video, k.chat_enabled, k.sfu_enabled) == (False, False, True, True)
        assert k.reminder_offsets == [60]
    finally:
        db.close()


def test_cp7_상담_세션_PUT은_클래스를_건드리지_않는다(client):
    host = _register(client, "cp7r@test.com")
    body = _post(client, host, type="clinical")
    res = client.put(f"/api/v1/sessions/{body['id']}", json={"title": "변경"}, headers=host["auth"])
    assert res.status_code == 200, res.text
    assert _all(_db(), Class) == []


def test_cp8_마지막_가시_세션을_숨기면_클래스도_숨겨진다(client):
    host = _register(client, "cp8@test.com")
    body = _post(client, host, type="meditation", scheduled_at=None)
    res = client.delete(f"/api/v1/sessions/{body['id']}", headers=host["auth"])
    assert res.status_code in (200, 204), res.text
    db = _db()
    try:
        s = _row(db, body["id"])
        assert s.hidden_at is not None
        assert db.query(Class).count() == 0
        assert db.query(Class).execution_options(include_hidden=True).one().hidden_at is not None
    finally:
        db.close()


def test_cp8_가시_세션이_남아_있으면_클래스는_유지된다(client):
    host = _register(client, "cp8k@test.com")
    a = _post(client, host, type="meditation", scheduled_at=None)
    b = _post(client, host, type="meditation", scheduled_at=None)
    db = _db()
    try:
        # 다회차 클래스는 Phase 3 이 만든다. 같은 클래스에 가시 세션 2개가 있는 상태를 직접 구성한다.
        sa_, sb = _row(db, a["id"]), _row(db, b["id"])
        sb.class_id, sb.seq = sa_.class_id, 2
        db.commit()
        keep_id = sa_.class_id
    finally:
        db.close()
    res = client.delete(f"/api/v1/sessions/{b['id']}", headers=host["auth"])
    assert res.status_code in (200, 204), res.text
    db = _db()
    try:
        assert db.get(Class, keep_id).hidden_at is None
    finally:
        db.close()


def test_cp8_상담_세션을_숨겨도_보관용_관계는_유지된다(client):
    host = _register(client, "cp8r@test.com")
    body = _post(client, host, type="clinical", scheduled_at=None)
    res = client.delete(f"/api/v1/sessions/{body['id']}", headers=host["auth"])
    assert res.status_code in (200, 204), res.text
    assert len(_all(_db(), CounselingRelationship)) == 1
    assert _db().query(CounselingRelationship).filter(CounselingRelationship.hidden_at.is_not(None)).count() == 0


def test_cp9_생성_경로는_링크와_개인정보_테이블에_쓰지_않는다(client):
    from sqlalchemy import func, select

    from app.models.class_program import ClassMember, ClassMemberEvent
    from app.models.counseling import CounselingGuest, CounselingRelationshipEvent, GuestClaimEvent
    from app.models.client_counselor_link import ClientCounselorLink

    host = _register(client, "cp9@test.com")
    _post(client, host, type="meditation", scheduled_at=None)
    _post(client, host, type="clinical", scheduled_at=None)
    db = _db()
    try:
        for model in (
            ClientCounselorLink, ClassMember, ClassMemberEvent, CounselingGuest,
            CounselingRelationshipEvent, GuestClaimEvent,
        ):
            assert db.execute(select(func.count()).select_from(model)).scalar_one() == 0, model.__name__
    finally:
        db.close()


def test_cp4_생성_지점은_분류_함수_하나만_쓴다():
    import inspect

    from app.services import session_service

    src = inspect.getsource(session_service)
    assert src.count("classify_session(") == 1
    assert src.count("_attach_parent(") >= 3  # 정의 1 + create_session + _clone_session_config


def test_cp1_종료_세션의_코드를_재사용해도_클래스_코드_충돌이_없다(client, monkeypatch):
    from app.services import class_code_service

    host = _register(client, "cp1c@test.com")
    a = _post(client, host, type="meditation", scheduled_at=None)
    db = _db()
    try:
        _row(db, a["id"]).status = "completed"
        db.commit()
    finally:
        db.close()
    monkeypatch.setattr(class_code_service, "generate_class_code", lambda db: a["access_code"])
    b = _post(client, host, type="meditation", scheduled_at=None)
    db = _db()
    try:
        sa_, sb = _row(db, a["id"]), _row(db, b["id"])
        assert db.get(Class, sb.class_id).access_code == b["access_code"] == a["access_code"]
        assert db.get(Class, sa_.class_id).access_code is None
    finally:
        db.close()
