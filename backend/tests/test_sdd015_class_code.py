"""SDD-015 — 클래스 코드 라이트 모델 QA

verify.md 시나리오 1~4, 6 을 검증한다.
"""

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


def _register(client, email: str, role: str = "counselor", org_code: str | None = None) -> dict:
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": f"{role}-{email.split('@')[0]}",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    if role == "counselor":
        payload["org_code"] = org_code if org_code is not None else create_test_org()
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body["access_token"]
    return {
        "id": body["user"]["id"],
        "token": token,
        "h": {"Authorization": f"Bearer {token}"},
    }


def _promote(user_id: str, role: str, org_id: str | None = None) -> None:
    """테스트 편의를 위해 DB에서 직접 역할/소속을 조정한다."""
    import uuid

    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        user.role = role
        if org_id is not None:
            user.org_id = uuid.UUID(org_id)
        db.commit()
    finally:
        db.close()


def _create_class(client, headers: dict, **overrides) -> dict:
    """일정 없는 즉석 클래스 생성."""
    payload = {"type": "meditation", "duration_min": 30, "title": "명상 클래스"}
    payload.update(overrides)
    res = client.post("/api/v1/sessions", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# ---------------------------------------------------------------------------
# 1. 기관 등록 (system_admin)
# ---------------------------------------------------------------------------


def test_01_platform_admin_기관등록_org_code_발급(client):
    admin = _register(client, "sysadmin01@test.com")
    _promote(admin["id"], "platform_admin")

    res = client.post("/api/v1/admin/orgs", json={"name": "마인드브리즈 센터"}, headers=admin["h"])
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == "마인드브리즈 센터"
    assert body["org_code"] and len(body["org_code"]) == 6


def test_02_기관_코드는_서로_중복되지_않는다(client):
    admin = _register(client, "sysadmin02@test.com")
    _promote(admin["id"], "platform_admin")

    codes = set()
    for i in range(5):
        res = client.post("/api/v1/admin/orgs", json={"name": f"센터{i}"}, headers=admin["h"])
        assert res.status_code == 201
        codes.add(res.json()["org_code"])
    assert len(codes) == 5

    listed = client.get("/api/v1/admin/orgs", headers=admin["h"])
    assert listed.status_code == 200
    assert codes.issubset({o["org_code"] for o in listed.json()})


def test_03_일반_사용자는_기관등록_403(client):
    counselor = _register(client, "notadmin03@test.com")
    res = client.post("/api/v1/admin/orgs", json={"name": "무단 센터"}, headers=counselor["h"])
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# 2. 상담사 가입 (기관 코드 필수)
# ---------------------------------------------------------------------------


def test_04_유효한_기관코드로_상담사_가입_성공(client):
    code = create_test_org("가입테스트센터")
    counselor = _register(client, "c04@test.com", org_code=code)
    assert counselor["id"]

    # org_id 가 실제로 연결됐는지 확인
    import uuid

    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(counselor["id"])).first()
        assert user.org_id is not None
    finally:
        db.close()


def test_05_잘못된_기관코드_가입_거부_400(client):
    payload = {
        "org_code": "ZZZZZZ",
        "email": "c05@test.com",
        "password": VALID_PASSWORD,
        "name": "상담사",
        "email_verify_token": email_verify_service.generate_email_verify_token("c05@test.com"),
        "consents": _consents(),
    }
    res = client.post("/api/v1/auth/register/counselor", json=payload)
    assert res.status_code == 400
    assert "유효하지 않은 기관 코드" in res.json()["detail"]


def test_06_기관코드_없이_상담사_가입_거부_400(client):
    payload = {
        "email": "c06@test.com",
        "password": VALID_PASSWORD,
        "name": "상담사",
        "email_verify_token": email_verify_service.generate_email_verify_token("c06@test.com"),
        "consents": _consents(),
    }
    res = client.post("/api/v1/auth/register/counselor", json=payload)
    assert res.status_code == 400
    assert "기관 코드를 입력" in res.json()["detail"]


# ---------------------------------------------------------------------------
# 3. 클래스 생성 · 시작 · 종료 (일정 없이)
# ---------------------------------------------------------------------------


def test_07_일정없이_클래스_생성_ready_및_코드발급(client):
    counselor = _register(client, "c07@test.com")
    body = _create_class(client, counselor["h"])

    assert body["scheduled_at"] is None
    assert body["status"] == "ready"
    assert body["access_code"] and len(body["access_code"]) == 6
    assert body["started_at"] is None and body["ended_at"] is None


def test_08_클래스_코드는_중복되지_않는다(client):
    counselor = _register(client, "c08@test.com")
    codes = {_create_class(client, counselor["h"], title=f"클래스{i}")["access_code"] for i in range(5)}
    assert len(codes) == 5


def test_09_start_end_전이와_시각기록(client):
    counselor = _register(client, "c09@test.com")
    cls = _create_class(client, counselor["h"])
    sid = cls["id"]

    started = client.post(f"/api/v1/sessions/{sid}/start", headers=counselor["h"])
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "in_progress"
    assert started.json()["started_at"] is not None

    ended = client.post(f"/api/v1/sessions/{sid}/end", headers=counselor["h"])
    assert ended.status_code == 200, ended.text
    assert ended.json()["status"] == "completed"
    assert ended.json()["ended_at"] is not None


def test_10_ready_클래스_취소_가능(client):
    counselor = _register(client, "c10@test.com")
    cls = _create_class(client, counselor["h"])
    res = client.post(f"/api/v1/sessions/{cls['id']}/cancel", headers=counselor["h"])
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"


# ---------------------------------------------------------------------------
# 4. 코드로 조회 · 참여
# ---------------------------------------------------------------------------


def test_11_코드로_클래스_조회_인증불필요(client):
    counselor = _register(client, "c11@test.com")
    cls = _create_class(client, counselor["h"], title="코드조회 클래스")

    res = client.get(f"/api/v1/sessions/by-code/{cls['access_code']}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == cls["id"]
    assert body["title"] == "코드조회 클래스"
    assert body["status"] == "ready"


def test_12_잘못된_클래스코드_404(client):
    assert client.get("/api/v1/sessions/by-code/ABC123").status_code == 404
    # 길이가 맞지 않는 코드도 404
    assert client.get("/api/v1/sessions/by-code/XY").status_code == 404


def test_13_로그인_내담자_코드로_참여(client):
    counselor = _register(client, "c13@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10)
    member = _register(client, "m13@test.com", role="client")

    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join",
        json={},
        headers=member["h"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["is_guest"] is False
    assert body["participant_id"]
    participants = body["session"]["participants"]
    assert [p["user_id"] for p in participants] == [member["id"]]


def test_14_게스트_이름만으로_참여(client):
    counselor = _register(client, "c14@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10)

    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join",
        json={"name": "게스트홍길동"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["is_guest"] is True
    guest = body["session"]["participants"][0]
    assert guest["user_id"] is None
    assert guest["guest_name"] == "게스트홍길동"
    assert guest["is_guest"] is True


def test_15_게스트_이름_없으면_400(client):
    counselor = _register(client, "c15@test.com")
    cls = _create_class(client, counselor["h"])
    res = client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={})
    assert res.status_code == 400
    assert "이름" in res.json()["detail"]


def test_16_동일_게스트이름_중복참여_허용(client):
    counselor = _register(client, "c16@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10)
    url = f"/api/v1/sessions/by-code/{cls['access_code']}/join"

    first = client.post(url, json={"name": "김철수"})
    second = client.post(url, json={"name": "김철수"})
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["participant_id"] != second.json()["participant_id"]
    assert len(second.json()["session"]["participants"]) == 2


def test_17_로그인_사용자_중복참여는_1건만(client):
    counselor = _register(client, "c17@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10)
    member = _register(client, "m17@test.com", role="client")
    url = f"/api/v1/sessions/by-code/{cls['access_code']}/join"

    first = client.post(url, json={}, headers=member["h"])
    second = client.post(url, json={}, headers=member["h"])
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["participant_id"] == second.json()["participant_id"]
    assert len(second.json()["session"]["participants"]) == 1


def test_18_종료된_클래스는_참여불가_400(client):
    counselor = _register(client, "c18@test.com")
    cls = _create_class(client, counselor["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"])

    res = client.post(
        f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "지각생"}
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# 6. 대시보드
# ---------------------------------------------------------------------------


def test_19_상담사_대시보드(client):
    counselor = _register(client, "c19@test.com")
    cls = _create_class(client, counselor["h"], max_participants=10, title="대시보드 클래스")
    client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "게스트A"})
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])

    res = client.get("/api/v1/dashboard/counselor", headers=counselor["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["counselor_id"] == counselor["id"]
    assert body["total_classes"] == 1
    assert body["in_progress_classes"] == 1
    assert body["total_participants"] == 1
    entry = body["classes"][0]
    assert entry["id"] == cls["id"]
    assert entry["title"] == "대시보드 클래스"
    assert entry["access_code"] == cls["access_code"]
    assert entry["guest_count"] == 1


def test_20_상담사_대시보드는_본인_클래스만(client):
    a = _register(client, "c20a@test.com")
    b = _register(client, "c20b@test.com")
    _create_class(client, a["h"], title="A 클래스")

    res = client.get("/api/v1/dashboard/counselor", headers=b["h"])
    assert res.status_code == 200
    assert res.json()["total_classes"] == 0


def test_21_기관_대시보드_통계(client):
    code = create_test_org("통계센터")
    counselor = _register(client, "c21@test.com", org_code=code)
    cls = _create_class(client, counselor["h"], max_participants=10)
    client.post(f"/api/v1/sessions/by-code/{cls['access_code']}/join", json={"name": "게스트B"})
    client.post(f"/api/v1/sessions/{cls['id']}/start", headers=counselor["h"])
    client.post(f"/api/v1/sessions/{cls['id']}/end", headers=counselor["h"])

    # 같은 기관의 org_admin 계정 준비
    admin = _register(client, "orgadmin21@test.com", org_code=code)
    import uuid

    from app.models.user import User

    db = _db()
    try:
        org_id = str(db.query(User).filter(User.id == uuid.UUID(counselor["id"])).first().org_id)
    finally:
        db.close()
    _promote(admin["id"], "org_admin", org_id)

    res = client.get("/api/v1/dashboard/org", headers=admin["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["org_name"] == "통계센터"
    assert body["org_code"] == code
    assert body["total_classes"] == 1
    assert body["completed_classes"] == 1
    assert body["total_participants"] == 1
    assert body["total_counselors"] == 2  # counselor + org_admin
    stat = next(c for c in body["counselors"] if c["id"] == counselor["id"])
    assert stat["class_count"] == 1
    assert stat["completed_count"] == 1


def test_22_상담사는_기관_대시보드_403(client):
    counselor = _register(client, "c22@test.com")
    res = client.get("/api/v1/dashboard/org", headers=counselor["h"])
    assert res.status_code == 403


def test_23_예약형_세션은_기존대로_scheduled(client):
    """회귀 방지 — scheduled_at을 주면 기존 예약형 흐름이 그대로 동작해야 한다."""
    from datetime import datetime, timedelta, timezone

    counselor = _register(client, "c23@test.com")
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    body = _create_class(client, counselor["h"], scheduled_at=when)

    assert body["status"] == "scheduled"
    assert body["scheduled_at"] is not None
    # 예약형 세션에도 클래스 코드는 발급된다
    assert body["access_code"] and len(body["access_code"]) == 6
