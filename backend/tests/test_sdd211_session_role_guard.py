"""SDD-211 R1 — 세션 생성·수정 5개 라우트의 역할 가드 (verify RG-1~RG-9).

가드 대상 라우트: POST /sessions, PUT /sessions/{id}, POST …/duplicate, …/save-as-template, …/new-run.
허용 역할은 counselor·org_admin·platform_admin(U4), 차단 대상은 client 뿐이다.
사용자는 DB 에 직접 만든다(권한 판정은 비밀번호와 무관).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import create_test_org

DETAIL_ROLE_DENIED = "이 작업을 수행할 권한이 없습니다"
DETAIL_HOST_ONLY = "host 코치만 가능합니다"

ALLOWED_ROLES = ["counselor", "org_admin", "platform_admin"]
ROUTE_NAMES = ["create", "update", "duplicate", "save_template", "new_run"]


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _make_user(role: str, suffix: str = "") -> dict:
    """사용자를 DB 에 직접 만들고 {id, h(Authorization 헤더)} 를 돌려준다. 상담사·기관 관리자는 기관 소속."""
    from app.core.security import create_access_token
    from app.models.organization import Organization
    from app.models.user import User
    from app.services import membership_service

    db = _db()
    try:
        org_id = None
        if role in ("counselor", "org_admin"):
            code = create_test_org(f"가드 기관 {role}{suffix}")
            org_id = db.query(Organization).filter(Organization.org_code == code).one().id
        user = User(
            email=f"rg-{role}{suffix}@test.com",
            password_hash="!",
            name=f"rg-{role}",
            role=role,
            status="active",
            verified_tier="email",
            org_id=org_id,
        )
        db.add(user)
        db.flush()
        if org_id is not None:
            membership_service.add_membership(db, user, org_id, status_="active")
        db.commit()
        uid = str(user.id)
    finally:
        db.close()
    return {"id": uid, "role": role, "h": {"Authorization": f"Bearer {create_access_token(subject=uid)}"}}


def _make_session(host: dict, *, status: str = "scheduled") -> str:
    """host 가 호스트인 세션을 DB 에 직접 만든다(역할과 무관하게 호스트 판정만 통과시키기 위함)."""
    from app.models.session import Session
    from app.models.user import User

    db = _db()
    try:
        org_id = db.query(User).filter(User.id == uuid.UUID(host["id"])).one().org_id
        s = Session(
            type="meditation",
            status=status,
            host_id=uuid.UUID(host["id"]),
            organization_id=org_id,
            duration_min=30,
            title="가드 대상 클래스",
            participant_mode="group",
            max_participants=5,
            scheduled_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db.add(s)
        db.commit()
        return str(s.id)
    finally:
        db.close()


def _call(client, route: str, headers: dict | None, sid: str | None):
    """5개 라우트를 같은 모양으로 호출한다. sid 가 필요한 라우트는 sid 를 쓴다."""
    h = headers or {}
    if route == "create":
        return client.post(
            "/api/v1/sessions",
            json={"type": "meditation", "duration_min": 30, "title": "가드 생성",
                  "participant_mode": "group", "max_participants": 5},
            headers=h,
        )
    if route == "update":
        return client.put(f"/api/v1/sessions/{sid}", json={"title": "가드 수정"}, headers=h)
    if route == "duplicate":
        return client.post(f"/api/v1/sessions/{sid}/duplicate", json={}, headers=h)
    if route == "save_template":
        return client.post(f"/api/v1/sessions/{sid}/save-as-template", json={}, headers=h)
    if route == "new_run":
        return client.post(f"/api/v1/sessions/{sid}/new-run", headers=h)
    raise AssertionError(route)


EXPECTED_OK = {"create": 201, "update": 200, "duplicate": 201, "save_template": 201, "new_run": 200}


@pytest.mark.parametrize("route", ROUTE_NAMES)
def test_RG1_client_토큰은_5개_라우트에서_403_권한문구(client, route):
    owner = _make_user("counselor", "-own")
    sid = _make_session(owner)
    stranger_client = _make_user("client")
    res = _call(client, route, stranger_client["h"], sid)
    assert (res.status_code, res.json()) == (403, {"detail": DETAIL_ROLE_DENIED}), res.text


@pytest.mark.parametrize("route", [r for r in ROUTE_NAMES if r != "create"])
def test_RG1_client_가_본인이_호스트인_세션도_403(client, route):
    """role=client 호스트 세션이 (이론상) 존재해도 역할 가드가 먼저 막는다."""
    c = _make_user("client")
    sid = _make_session(c)
    res = _call(client, route, c["h"], sid)
    assert (res.status_code, res.json()) == (403, {"detail": DETAIL_ROLE_DENIED}), res.text


@pytest.mark.parametrize("route", ROUTE_NAMES)
@pytest.mark.parametrize("role", ALLOWED_ROLES)
def test_RG2_RG3_RG9_역할별_레거시_동작과_D28_제어_차단(client, role, route):
    """RG-2(counselor·org_admin) + RG-3(platform_admin 현행 보존) + RG-9(역할×라우트 매트릭스 고정)."""
    actor = _make_user(role)
    sid = _make_session(actor)
    res = _call(client, route, actor["h"], sid)
    expected = 403 if role == "org_admin" and route != "create" else EXPECTED_OK[route]
    assert res.status_code == expected, res.text


@pytest.mark.parametrize("route", ROUTE_NAMES)
@pytest.mark.parametrize("role", ["client"])
def test_RG9_차단_역할_매트릭스(client, role, route):
    """차단되는 역할은 client 뿐이다. 이후 역할 목록이 바뀌면 이 표와 위 허용 매트릭스를 함께 고쳐야 한다."""
    owner = _make_user("counselor", "-own")
    sid = _make_session(owner)
    actor = _make_user(role)
    assert _call(client, route, actor["h"], sid).status_code == 403


@pytest.mark.parametrize("role", ["org_admin", "platform_admin"])
@pytest.mark.parametrize("route", [r for r in ROUTE_NAMES if r != "create"])
def test_RG2_허용_역할도_타인_세션은_호스트_판정_403_유지(client, role, route):
    """역할 가드는 통과해도 호스트 판정은 그대로다(권한 확대 금지, AZ-3)."""
    owner = _make_user("counselor", "-own")
    sid = _make_session(owner)
    actor = _make_user(role)
    res = _call(client, route, actor["h"], sid)
    assert (res.status_code, res.json()["detail"]) == (403, DETAIL_HOST_ONLY), res.text


@pytest.mark.parametrize("route", ROUTE_NAMES)
def test_RG4_비로그인_401(client, route):
    owner = _make_user("counselor", "-own")
    sid = _make_session(owner)
    assert _call(client, route, None, sid).status_code == 401


def test_RG5_client_가_타인_세션_PUT_은_403_이고_문구가_권한_문구로_바뀐다(client):
    owner = _make_user("counselor", "-own")
    sid = _make_session(owner)
    stranger_client = _make_user("client")
    res = client.put(f"/api/v1/sessions/{sid}", json={"title": "침범"}, headers=stranger_client["h"])
    assert res.status_code == 403
    assert res.json()["detail"] == DETAIL_ROLE_DENIED  # 이전: "host 상담사만 가능합니다"


def test_RG6_가드_밖_라우트의_문구는_불변(client):
    """가드를 걸지 않은 라우트(DELETE·상태 전이 등)의 비호스트 문구는 그대로 호스트 판정 문구다."""
    owner = _make_user("counselor", "-own")
    sid = _make_session(owner)
    other = _make_user("counselor", "-other")
    for method, path in [("delete", f"/api/v1/sessions/{sid}"), ("post", f"/api/v1/sessions/{sid}/open")]:
        res = getattr(client, method)(path, headers=other["h"])
        assert (res.status_code, res.json()["detail"]) == (403, DETAIL_HOST_ONLY), (path, res.text)


@pytest.mark.parametrize("route", ROUTE_NAMES)
def test_RG7_client_의_잘못된_body_는_422_가_아니라_403(client, route):
    """역할 가드는 의존성이라 body 검증(422)보다 먼저 평가된다."""
    owner = _make_user("counselor", "-own")
    sid = _make_session(owner)
    c = _make_user("client")
    bad = {"type": 12345, "duration_min": "문자", "title": 7}
    if route == "create":
        res = client.post("/api/v1/sessions", json=bad, headers=c["h"])
    elif route == "update":
        res = client.put(f"/api/v1/sessions/{sid}", json=bad, headers=c["h"])
    elif route == "duplicate":
        res = client.post(f"/api/v1/sessions/{sid}/duplicate", json=bad, headers=c["h"])
    elif route == "save_template":
        res = client.post(f"/api/v1/sessions/{sid}/save-as-template", json=bad, headers=c["h"])
    else:
        res = client.post(f"/api/v1/sessions/{sid}/new-run", json=bad, headers=c["h"])
    assert (res.status_code, res.json()["detail"]) == (403, DETAIL_ROLE_DENIED), res.text
