"""구글 계정 전환(상담사 A 로그아웃 → 회원 탭 B) 로그인 — 서버 측 계약."""
from tests.sdd220_helpers import consents
from tests.test_auth_login import _register
from tests.test_sdd072_login_roles import _db, _google
from app.models.user import User


def test_상담사_구글계정으로_회원탭_로그인은_코드와_안내문구로_거부된다(client):
    _register(client, email="a@test.com")
    with _db() as db:
        db.query(User).filter_by(email="a@test.com").one().role = "counselor"
        db.commit()
    with _google("a@test.com"):
        res = client.post("/api/v1/auth/google", json={"access_token": "valid", "role": "client"})
    assert res.status_code == 403
    detail = res.json()["detail"]
    assert detail["code"] == "ROLE_MISMATCH"
    assert "Google 계정" in detail["message"] and "다른 Google 계정" in detail["message"]


def test_새_구글계정_B는_회원탭에서_동의와_함께_가입된다(client):
    with _google("b-new@test.com"):
        res = client.post("/api/v1/auth/google", json={
            "access_token": "valid", "role": "client", "consents": consents(), "birth_date": "1990-01-01",
        })
    assert res.status_code == 200, res.text
    assert res.json()["user"]["role"] == "client"
