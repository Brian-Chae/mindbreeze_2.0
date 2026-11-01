"""SDD-264 B1~B3 — 폰 생성량(기대량) 보고 PUT /sessions/{sid}/ingest-expected (V-X10~V-X22).

단조·멱등·final 규칙과 권한을 검증한다. 정답은 독립 SQL 로 대조한다.
"""

import uuid

import pytest
import sqlalchemy as sa

from app.models.session import Session, SessionParticipant
from app.models.session_ingest_expected import SessionIngestExpected
from tests.sdd237_helpers import auth_for, build_class_world, make_user


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    session = next(app.dependency_overrides[get_db]())
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def world(client, db):
    return build_class_world(db, members=3, status="in_progress", ended=False)


def put(client, world, who, body, *, headers=None, session_id=None):
    sid = session_id or world["session"].id
    return client.put(f"/api/v1/sessions/{sid}/ingest-expected", json=body,
                      headers=headers if headers is not None else auth_for(who))


def user_of(db, participant):
    from app.models.user import User

    return db.get(User, participant.user_id)


def base(feature=100, eeg=50, ppg=20, acc=20, final=False):
    return {"feature": feature, "raw": {"eeg": eeg, "ppg": ppg, "acc": acc}, "final": final}


def stored(db, participant):
    db.expire_all()
    return db.get(SessionIngestExpected, participant.id)


# ── 기본 저장 · 멱등 (V-X14) ─────────────────────────────────────
def test_V_X14_같은_보고_2회는_멱등(client, db, world):
    p = world["participants"][0]
    u = user_of(db, p)
    r1 = put(client, world, u, base())
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert b1["changed"] is True and b1["ignored"] == []
    assert b1["expected"] == {"feature": 100, "raw": {"eeg": 50, "ppg": 20, "acc": 20}}
    assert b1["participant_id"] == str(p.id) and b1["final"] is False
    r2 = put(client, world, u, base())
    assert r2.status_code == 200
    assert r2.json()["changed"] is False
    n = db.execute(sa.select(sa.func.count()).select_from(SessionIngestExpected)
                   .where(SessionIngestExpected.participant_id == p.id)).scalar()
    assert n == 1


# ── 단조 (V-X15, V-X16) ──────────────────────────────────────────
def test_V_X15_낮은_값_재보고는_무시(client, db, world):
    p = world["participants"][0]
    u = user_of(db, p)
    put(client, world, u, base(feature=100))
    r = put(client, world, u, base(feature=80))
    assert r.status_code == 200
    body = r.json()
    assert body["expected"]["feature"] == 100
    assert body["ignored"] == ["feature"]
    assert stored(db, p).feature == 100


def test_V_X16_일부_필드만_증가(client, db, world):
    p = world["participants"][0]
    u = user_of(db, p)
    put(client, world, u, base(feature=100, eeg=50))
    r = put(client, world, u, base(feature=120, eeg=40))
    body = r.json()
    assert body["expected"]["feature"] == 120 and body["expected"]["raw"]["eeg"] == 50
    assert body["ignored"] == ["raw.eeg"] and body["changed"] is True
    row = stored(db, p)
    assert (row.feature, row.raw_eeg) == (120, 50)


# ── final (V-X17, V-X18) ─────────────────────────────────────────
def test_V_X17_뒤처진_보고의_final_은_무시(client, db, world):
    p = world["participants"][0]
    u = user_of(db, p)
    put(client, world, u, base(feature=100, final=False))
    r = put(client, world, u, base(feature=90, final=True))
    assert r.json()["final"] is False
    assert stored(db, p).final is False


def test_V_X18_final_확정_후_이어올림_증가_재보고(client, db, world):
    p = world["participants"][0]
    u = user_of(db, p)
    put(client, world, u, base(feature=100, final=True))
    assert stored(db, p).final is True
    # 같은 값의 final=false 재보고는 확정을 되돌리지 않는다
    r = put(client, world, u, base(feature=100, final=False))
    assert r.json()["final"] is True and r.json()["changed"] is False
    # 이어올림으로 총량 증가 + final=true
    r = put(client, world, u, base(feature=130, final=True))
    assert r.json()["final"] is True and r.json()["expected"]["feature"] == 130
    # 증가한 보고가 final=false 면 final 도 false 로 (다시 측정 중)
    r = put(client, world, u, base(feature=150, final=False))
    assert r.json()["final"] is False


def test_raw_생략_보고는_저장값을_건드리지_않는다(client, db, world):
    p = world["participants"][0]
    u = user_of(db, p)
    r = put(client, world, u, {"feature": 10, "final": False})
    assert r.status_code == 200
    assert r.json()["expected"] == {"feature": 10, "raw": {"eeg": None, "ppg": None, "acc": None}}
    put(client, world, u, base(feature=10))
    r = put(client, world, u, {"feature": 12, "final": False})
    assert r.json()["expected"]["raw"] == {"eeg": 50, "ppg": 20, "acc": 20}


# ── 입력 검증 (V-X21) ────────────────────────────────────────────
@pytest.mark.parametrize("body,field", [
    ({"feature": -1, "final": False}, "feature"),
    ({"feature": 1.5, "final": False}, "feature"),
    ({"feature": True, "final": False}, "feature"),
    ({"feature": "10", "final": False}, "feature"),
    ({"feature": 10_000_001, "final": False}, "feature"),
    ({"final": False}, "feature"),
    ({"feature": 1}, "final"),
    ({"feature": 1, "final": "yes"}, "final"),
    ({"feature": 1, "final": False, "extra": 1}, "extra"),
    ({"feature": 1, "final": False, "raw": {"eeg": 1, "ppg": 2}}, "raw"),
    ({"feature": 1, "final": False, "raw": {"eeg": 1, "ppg": 2, "acc": -3}}, "raw.acc"),
    ({"feature": 1, "final": False, "raw": {"eeg": 1, "ppg": 2, "acc": 3, "x": 4}}, "raw"),
    ({"feature": 1, "final": False, "raw": [1, 2, 3]}, "raw"),
])
def test_V_X21_잘못된_본문은_422(client, db, world, body, field):
    u = user_of(db, world["participants"][0])
    r = put(client, world, u, body)
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == {"code": "invalid_message", "field": field}


def test_V_X21_경계값_상한과_0은_허용(client, db, world):
    u = user_of(db, world["participants"][0])
    r = put(client, world, u, {"feature": 0, "raw": {"eeg": 0, "ppg": 0, "acc": 0}, "final": True})
    assert r.status_code == 200
    r = put(client, world, u, {"feature": 10_000_000, "final": False})
    assert r.status_code == 200


# ── 종료된 회차 (V-X22) ──────────────────────────────────────────
def test_V_X22_종료된_회차에도_보고_허용(client, db):
    w = build_class_world(db, members=1, status="completed", ended=True)
    u = user_of(db, w["participants"][0])
    r = put(client, w, u, base(final=True))
    assert r.status_code == 200, r.text
    assert r.json()["final"] is True


# ── 권한 (V-X10~V-X12) ───────────────────────────────────────────
def test_V_X10_호스트_대리_보고는_403(client, db, world):
    p = world["participants"][0]
    r = put(client, world, world["host"], {**base(), "participant_id": str(p.id)})
    assert r.status_code == 403, r.text


def test_V_X11_타인_participant_id_는_403(client, db, world):
    a, b = world["participants"][0], world["participants"][1]
    r = put(client, world, user_of(db, a), {**base(), "participant_id": str(b.id)})
    assert r.status_code == 403, r.text
    assert stored(db, b) is None


def test_V_X11_인증_없으면_401(client, db, world):
    p = world["participants"][0]
    r = put(client, world, None, {**base(), "participant_id": str(p.id)}, headers={})
    assert r.status_code == 401, r.text


def test_V_X11_본인_participant_id_명시는_허용(client, db, world):
    p = world["participants"][0]
    r = put(client, world, user_of(db, p), {**base(), "participant_id": str(p.id)})
    assert r.status_code == 200, r.text
    assert r.json()["participant_id"] == str(p.id)


def test_V_X12_대기열_참여자는_403(client, db, world):
    p = world["participants"][0]
    p.is_waitlisted = True
    db.commit()
    r = put(client, world, user_of(db, p), base())
    assert r.status_code == 403, r.text


def test_V_X12_수집_거부_참여자는_403(client, db, world):
    p = world["participants"][0]
    p.eeg_collection_consented = False
    db.commit()
    r = put(client, world, user_of(db, p), base())
    assert r.status_code == 403, r.text


def test_없는_세션은_404_잘못된_id_는_400(client, db, world):
    u = user_of(db, world["participants"][0])
    assert put(client, world, u, base(), session_id=uuid.uuid4()).status_code == 404
    assert put(client, world, u, base(), session_id="not-a-uuid").status_code == 400


def test_다른_회차_참여자는_본인으로_인정되지_않는다(client, db, world):
    other = build_class_world(db, members=1, status="in_progress", ended=False)
    u = user_of(db, other["participants"][0])
    r = put(client, world, u, base())
    assert r.status_code in (403, 404), r.text


# ── 서비스 직접: 동시성은 PG 시험(test_ingest_expected_pg.py) ─────
def test_행은_참여자당_1개_회차_삭제시_함께_삭제(client, db, world):
    p = world["participants"][0]
    put(client, world, user_of(db, p), base())
    assert stored(db, p).session_id == world["session"].id
    cols = {c.name for c in SessionIngestExpected.__table__.columns}
    assert {"participant_id", "session_id", "feature", "raw_eeg", "raw_ppg", "raw_acc", "final",
            "first_reported_at", "reported_at", "updated_at"} <= cols
