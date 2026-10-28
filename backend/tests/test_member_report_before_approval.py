"""회원 클래스 리포트 승인 전 열람(404 → 리뷰 중 200) + 목록 승인 대상 표시 회귀 테스트."""

import pytest

from app.core.security import create_access_token
from datetime import timedelta

from app.models.class_program import ClassMember
from tests.sdd237_helpers import START, build_class_world as _build


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


def build_class_world(db, **kw):
    w = _build(db, **kw)
    # 회원 가입 시각을 회차 이전으로 — 'before_join' 판정에 걸리지 않게 한다.
    for m in db.query(ClassMember).filter(ClassMember.class_id == w["cls"].id, ClassMember.kind == "member"):
        m.joined_at = START - timedelta(days=7)
    db.commit()
    return w


def _auth(user_id):
    return {"Authorization": f"Bearer {create_access_token(str(user_id))}"}


def test_승인_전_본인_클래스_리포트는_404가_아니라_리뷰중_200(client, db):
    w = build_class_world(db, members=2)
    own = w["client_reports"][0]
    own.status = "pending_review"
    own.is_read = False
    db.commit()
    res = client.get(f"/api/v1/reports/{own.id}", headers=_auth(w["participants"][0].user_id))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["in_review"] is True
    assert body["pdf_url"] is None
    db.refresh(own)
    assert own.is_read is False  # 승인 후 NEW 가 정상 표시되도록 읽음 처리하지 않는다


def test_승인_전이라도_타인_리포트는_여전히_404(client, db):
    w = build_class_world(db, members=2)
    other = w["client_reports"][1]
    other.status = "pending_review"
    db.commit()
    res = client.get(f"/api/v1/reports/{other.id}", headers=_auth(w["participants"][0].user_id))
    assert res.status_code == 404


def test_승인_후에는_정상_본문(client, db):
    w = build_class_world(db, members=1)
    own = w["client_reports"][0]
    own.status = "completed"
    db.commit()
    res = client.get(f"/api/v1/reports/{own.id}", headers=_auth(w["participants"][0].user_id))
    assert res.status_code == 200
    assert res.json()["in_review"] is False


def test_클래스_회차_상담사용_리포트는_승인_대상이_아니다(client, db):
    w = build_class_world(db, members=1)
    cr = w["counselor_report"]
    cr.status = "pending_review"
    db.commit()
    res = client.get(f"/api/v1/reports/{cr.id}", headers=w["auth"])
    assert res.status_code == 200
    assert res.json()["approval_required"] is False
    own = w["client_reports"][0]
    own.status = "pending_review"
    db.commit()
    res = client.get(f"/api/v1/reports/{own.id}", headers=w["auth"])
    assert res.json()["approval_required"] is True
