"""기관 전용 공개 페이지 API QA — GET /api/v1/o/{org_code}

인증 없이 호출되며 개인정보가 노출되지 않아야 한다.
"""

import uuid

from app.services import email_verify_service
from tests.conftest import create_test_org

VALID_PASSWORD = "Passw0rd!"


def _consents() -> dict:
    return {"tos": True, "privacy": True, "sensitive": True}


def _db():
    """client fixture와 같은 인메모리 DB 세션 획득."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _register_counselor(client, email: str, org_code: str, name: str = "김상담") -> dict:
    payload = {
        "org_code": org_code,
        "email": email,
        "password": VALID_PASSWORD,
        "name": name,
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = client.post("/api/v1/auth/register/counselor", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body["access_token"]
    return {
        "id": body["user"]["id"],
        "email": email,
        "h": {"Authorization": f"Bearer {token}"},
    }


def _create_class(client, headers: dict, **overrides) -> dict:
    payload = {"type": "meditation", "duration_min": 30, "title": "명상 클래스"}
    payload.update(overrides)
    res = client.post("/api/v1/sessions", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _set_specialties(user_id: str, specialties: list[str]) -> None:
    """공개 페이지 전문분야 노출 검증용 — CounselorProfile을 직접 만든다."""
    from app.models.counselor_profile import CounselorProfile

    db = _db()
    try:
        uid = uuid.UUID(user_id)
        profile = db.query(CounselorProfile).filter(CounselorProfile.user_id == uid).first()
        if profile is None:
            from app.services import onboarding_service

            profile = CounselorProfile(
                user_id=uid,
                counselor_code=onboarding_service.generate_counselor_code(db),
                specialties=specialties,
            )
            db.add(profile)
        else:
            profile.specialties = specialties
        db.commit()
    finally:
        db.close()


def _set_user_status(user_id: str, status_value: str) -> None:
    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        user.status = status_value
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------


def test_01_기관코드로_공개페이지_조회(client):
    code = create_test_org("공개센터")
    counselor = _register_counselor(client, "pub01@test.com", code, name="이지도")
    _set_specialties(counselor["id"], ["명상", "불안"])
    cls = _create_class(client, counselor["h"], title="아침 명상", max_participants=20)

    res = client.get(f"/api/v1/o/{code}")
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["org_name"] == "공개센터"
    assert body["org_code"] == code
    assert body["intro"] is None

    assert len(body["counselors"]) == 1
    c = body["counselors"][0]
    assert c["id"] == counselor["id"]
    assert c["name"] == "이지도"
    assert c["specialties"] == ["명상", "불안"]

    assert len(body["classes"]) == 1
    k = body["classes"][0]
    assert k["id"] == cls["id"]
    assert k["title"] == "아침 명상"
    assert k["type"] == "meditation"
    assert k["status"] == "ready"
    assert k["access_code"] == cls["access_code"]
    assert k["max_participants"] == 20
    assert k["participant_count"] == 0


def test_02_인증없이_호출_가능(client):
    """Authorization 헤더 없이도 200이어야 한다."""
    code = create_test_org("무인증센터")
    res = client.get(f"/api/v1/o/{code}")
    assert res.status_code == 200
    assert res.json()["org_name"] == "무인증센터"


def test_03_없는_기관코드_404(client):
    assert client.get("/api/v1/o/ZZZZZZ").status_code == 404
    # 길이가 맞지 않는 코드도 404
    assert client.get("/api/v1/o/AB").status_code == 404


def test_04_완료_취소_클래스는_제외(client):
    code = create_test_org("상태필터센터")
    counselor = _register_counselor(client, "pub04@test.com", code)

    live = _create_class(client, counselor["h"], title="진행 예정")
    done = _create_class(client, counselor["h"], title="완료될 클래스")
    cancelled = _create_class(client, counselor["h"], title="취소될 클래스")

    client.post(f"/api/v1/sessions/{done['id']}/start", headers=counselor["h"])
    client.post(f"/api/v1/sessions/{done['id']}/end", headers=counselor["h"])
    client.post(f"/api/v1/sessions/{cancelled['id']}/cancel", headers=counselor["h"])

    body = client.get(f"/api/v1/o/{code}").json()
    titles = [k["title"] for k in body["classes"]]
    assert titles == ["진행 예정"]
    assert live["id"] == body["classes"][0]["id"]


def test_05_진행중_클래스_노출_및_시작시각(client):
    code = create_test_org("진행중센터")
    counselor = _register_counselor(client, "pub05@test.com", code)
    cls = _create_class(client, counselor["h"], title="진행중 명상")
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])

    body = client.get(f"/api/v1/o/{code}").json()
    assert len(body["classes"]) == 1
    k = body["classes"][0]
    assert k["status"] == "in_progress"
    assert k["started_at"] is not None


def test_06_참여자수는_게스트_포함(client):
    code = create_test_org("참여자센터")
    counselor = _register_counselor(client, "pub06@test.com", code)
    cls = _create_class(client, counselor["h"], max_participants=10)

    # 게스트 2명 + 로그인 내담자 1명
    join_url = f"/api/v1/sessions/by-code/{cls['access_code']}/join"
    client.post(join_url, json={"name": "게스트1"})
    client.post(join_url, json={"name": "게스트2"})

    member_email = "pubmember06@test.com"
    member = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": member_email,
            "password": VALID_PASSWORD,
            "name": "내담자",
            "email_verify_token": email_verify_service.generate_email_verify_token(member_email),
            "consents": _consents(),
        },
    )
    assert member.status_code == 201
    token = member.json()["access_token"]
    client.post(join_url, json={}, headers={"Authorization": f"Bearer {token}"})

    body = client.get(f"/api/v1/o/{code}").json()
    assert body["classes"][0]["participant_count"] == 3


def test_07_상담사_개인정보_미노출(client):
    code = create_test_org("프라이버시센터")
    counselor = _register_counselor(client, "pub07@test.com", code)

    res = client.get(f"/api/v1/o/{code}")
    assert res.status_code == 200
    raw = res.text
    body = res.json()

    # 이메일·전화·주소·사업자번호가 응답 어디에도 없어야 한다
    assert "pub07@test.com" not in raw
    assert counselor["email"] not in raw
    for field in ("email", "phone", "address", "biz_number", "ceo_name"):
        assert field not in body["counselors"][0]
        assert field not in body

    assert set(body["counselors"][0].keys()) == {"id", "name", "specialties"}


def test_08_비활성_상담사_제외(client):
    code = create_test_org("비활성센터")
    active = _register_counselor(client, "pub08a@test.com", code, name="활성상담사")
    inactive = _register_counselor(client, "pub08b@test.com", code, name="비활성상담사")
    _set_user_status(inactive["id"], "suspended")

    body = client.get(f"/api/v1/o/{code}").json()
    names = [c["name"] for c in body["counselors"]]
    assert names == ["활성상담사"]
    assert active["id"] == body["counselors"][0]["id"]


def test_09_다른_기관_상담사_클래스는_섞이지_않는다(client):
    code_a = create_test_org("A센터")
    code_b = create_test_org("B센터")
    a = _register_counselor(client, "pub09a@test.com", code_a, name="A상담사")
    b = _register_counselor(client, "pub09b@test.com", code_b, name="B상담사")
    _create_class(client, a["h"], title="A 클래스")
    _create_class(client, b["h"], title="B 클래스")

    body_a = client.get(f"/api/v1/o/{code_a}").json()
    assert [c["name"] for c in body_a["counselors"]] == ["A상담사"]
    assert [k["title"] for k in body_a["classes"]] == ["A 클래스"]

    body_b = client.get(f"/api/v1/o/{code_b}").json()
    assert [c["name"] for c in body_b["counselors"]] == ["B상담사"]
    assert [k["title"] for k in body_b["classes"]] == ["B 클래스"]


def test_10_상담사_없는_기관은_빈_배열(client):
    code = create_test_org("빈센터")
    body = client.get(f"/api/v1/o/{code}").json()
    assert body["counselors"] == []
    assert body["classes"] == []


def test_11_프로필_없는_상담사는_전문분야_빈배열(client):
    code = create_test_org("무프로필센터")
    _register_counselor(client, "pub11@test.com", code)
    body = client.get(f"/api/v1/o/{code}").json()
    assert body["counselors"][0]["specialties"] == []


def test_12_소문자_기관코드도_조회된다(client):
    code = create_test_org("대소문자센터")
    res = client.get(f"/api/v1/o/{code.lower()}")
    assert res.status_code == 200
    assert res.json()["org_code"] == code
