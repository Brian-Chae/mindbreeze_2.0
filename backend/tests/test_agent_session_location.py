"""SDD-188 — 세션 장소(주소) QA (D8)

verify.md TS19: 오프라인 세션 생성 시 기관 주소 → 상담사 프로필 주소 순으로 기본값을
채우고, 둘 다 없으면 null. 수정 가능. 온라인은 항상 null.
"""

from unittest.mock import patch

from tests import agent_helpers as H
from tests.conftest import create_test_org

ORG_ADDRESS = "서울 강남구 테헤란로 100"
COUNSELOR_ADDRESS = "대전 유성구 테크노2로 187"
COUNSELOR_ADDRESS2 = "3층 201호"


def _setup(client, prefix: str, *, org_address: str | None = None,
           counselor_address: bool = False) -> dict:
    org_code = create_test_org(f"{prefix} 기관")
    if org_address:
        _set_org_address(org_code, org_address)
    counselor = H.register_counselor(f"{prefix}-host@test.com", org_code=org_code)
    if counselor_address:
        _set_counselor_address(counselor["id"], COUNSELOR_ADDRESS, COUNSELOR_ADDRESS2)
    member = H.register_client(client, f"{prefix}-mem@test.com")
    return {"counselor": counselor, "member": member}


# ── TS19 ────────────────────────────────────────────────────────


def test_TS19_1_오프라인_미지정이면_기관_주소가_기본값(client):
    env = _setup(client, "loc1", org_address=ORG_ADDRESS)
    session = H.create_session(client, env["counselor"]["h"], [env["member"]["id"]])
    assert session["location_address"] == ORG_ADDRESS


def test_TS19_2_기관주소가_없으면_상담사_프로필_주소(client):
    env = _setup(client, "loc2", counselor_address=True)
    session = H.create_session(client, env["counselor"]["h"], [env["member"]["id"]])
    assert session["location_address"] == f"{COUNSELOR_ADDRESS} {COUNSELOR_ADDRESS2}"


def test_TS19_3_둘다_없으면_null_이고_오류가_없다(client):
    env = _setup(client, "loc3")
    session = H.create_session(client, env["counselor"]["h"], [env["member"]["id"]])
    assert session["location_address"] is None


def test_TS19_4_수정_API로_주소를_변경할_수_있다(client):
    env = _setup(client, "loc4", org_address=ORG_ADDRESS)
    session = H.create_session(client, env["counselor"]["h"], [env["member"]["id"]])

    res = _update(client, env["counselor"]["h"], session["id"],
                  {"location_address": "부산 해운대구 센텀로 1"})
    assert res.status_code == 200, res.text
    assert res.json()["location_address"] == "부산 해운대구 센텀로 1"

    # 빈 문자열을 주면 주소를 비운다
    res = _update(client, env["counselor"]["h"], session["id"], {"location_address": "   "})
    assert res.status_code == 200, res.text
    assert res.json()["location_address"] is None


def test_TS19_5_온라인_세션은_주소를_입력해도_null(client):
    env = _setup(client, "loc5", org_address=ORG_ADDRESS)
    session = H.create_session(
        client,
        env["counselor"]["h"],
        [env["member"]["id"]],
        location_type="online",
        location_address=ORG_ADDRESS,
    )
    assert session["location_address"] is None


def test_명시한_주소는_기본값보다_우선한다(client):
    env = _setup(client, "loc6", org_address=ORG_ADDRESS)
    session = H.create_session(
        client, env["counselor"]["h"], [env["member"]["id"]], location_address="직접 입력한 주소"
    )
    assert session["location_address"] == "직접 입력한 주소"


def test_오프라인에서_온라인으로_바꾸면_주소가_정리된다(client):
    env = _setup(client, "loc7", org_address=ORG_ADDRESS)
    session = H.create_session(client, env["counselor"]["h"], [env["member"]["id"]])
    assert session["location_address"] == ORG_ADDRESS

    res = _update(client, env["counselor"]["h"], session["id"], {"location_type": "online"})
    assert res.status_code == 200, res.text
    assert res.json()["location_address"] is None


def test_온라인에서_오프라인으로_바꾸면_기본값이_채워진다(client):
    env = _setup(client, "loc8", org_address=ORG_ADDRESS)
    session = H.create_session(
        client, env["counselor"]["h"], [env["member"]["id"]], location_type="online"
    )
    assert session["location_address"] is None

    res = _update(client, env["counselor"]["h"], session["id"], {"location_type": "offline"})
    assert res.status_code == 200, res.text
    assert res.json()["location_address"] == ORG_ADDRESS


def test_주소는_300자_초과시_422(client):
    env = _setup(client, "loc9")
    scheduled = H.datetime.now(H.timezone.utc) + H.timedelta(minutes=200)
    res = client.post(
        "/api/v1/sessions",
        json={
            "type": "clinical",
            "duration_min": 50,
            "scheduled_at": scheduled.isoformat(),
            "max_participants": 1,
            "location_type": "offline",
            "location_address": "가" * 301,
            "participant_ids": [],
            "force": True,
        },
        headers=env["counselor"]["h"],
    )
    assert res.status_code == 422


def test_세션_상세_조회에도_주소가_포함된다(client):
    env = _setup(client, "loc10", org_address=ORG_ADDRESS)
    session = H.create_session(client, env["counselor"]["h"], [env["member"]["id"]])

    res = client.get(f"/api/v1/sessions/{session['id']}", headers=env["counselor"]["h"])
    assert res.status_code == 200, res.text
    assert res.json()["location_address"] == ORG_ADDRESS


# ── 보조 ───────────────────────────────────────────────────────


def _update(client, headers: dict, session_id: str, payload: dict):
    body = {"force": True, **payload}
    with patch("app.tasks.reminder_task.send_session_reminder_task.apply_async"):
        return client.put(f"/api/v1/sessions/{session_id}", json=body, headers=headers)


def _set_org_address(org_code: str, address: str) -> None:
    from app.models.organization import Organization

    conn = H.db()
    try:
        org = conn.query(Organization).filter(Organization.org_code == org_code).first()
        org.address = address
        conn.commit()
    finally:
        conn.close()


def _set_counselor_address(user_id: str, line1: str, line2: str) -> None:
    from app.models.counselor_profile import CounselorProfile

    conn = H.db()
    try:
        profile = (
            conn.query(CounselorProfile)
            .filter(CounselorProfile.user_id == H._uuid(user_id))
            .first()
        )
        if profile is None:
            profile = CounselorProfile(
                user_id=H._uuid(user_id),
                counselor_code=str(user_id).replace("-", "")[:6].upper(),
            )
            conn.add(profile)
        profile.address_line1 = line1
        profile.address_line2 = line2
        conn.commit()
    finally:
        conn.close()
