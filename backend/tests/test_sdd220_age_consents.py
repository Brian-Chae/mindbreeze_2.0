"""SDD-220 TS12~TS14 — 만 14세·필수 동의·탈퇴 처리 중 이메일(F2), 3개 가입 경로 공통 검증."""

from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.database import get_db
from app.main import app
from app.models.consent import Consent
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services import signup_policy_service as policy
from tests.sdd220_helpers import consents, email_register_payload

_REAL_TODAY_KST = policy.today_kst  # 픽스처가 덮어쓰기 전의 실제 함수
REGISTER = "/api/v1/auth/register/client"
STRICT = {"X-Test-Strict-Signup": "1"}  # conftest 의 가입 birth_date 기본값 보정을 끈다
GOOGLE = "/api/v1/auth/google"


def _db():
    return next(app.dependency_overrides[get_db]())


def _google(email):
    def _side(url, **kwargs):
        resp = MagicMock(status_code=200)
        resp.json.return_value = {"email": email, "name": "구글"} if "userinfo" in str(url) else {"aud": "test-client-id"}
        return resp

    return patch("httpx.AsyncClient.get", AsyncMock(side_effect=_side))


@pytest.fixture(autouse=True)
def _strict_signup(client):
    """이 파일의 모든 요청은 conftest 의 birth_date 기본값 보정 없이 서버 검증을 그대로 받는다."""
    original = client.post

    def post(url, **kwargs):
        kwargs["headers"] = {**STRICT, **(kwargs.get("headers") or {})}
        return original(url, **kwargs)

    client.post = post
    yield
    client.post = original


@pytest.fixture(autouse=True)
def _fixed_today(monkeypatch):
    """서버 기준일을 Asia/Seoul 2026-10-20 로 고정."""
    monkeypatch.setattr(policy, "today_kst", lambda now=None: date(2026, 10, 20))


def _assert_no_rows(email=None):
    db = _db()
    assert db.query(User).count() == 0
    assert db.query(Consent).count() == 0
    assert db.query(RefreshToken).count() == 0


# ── TS12: 단위(경계) ───────────────────────────────────────────────────

@pytest.mark.parametrize("birth,ok", [
    ("2012-10-20", True),    # 생일 당일 = 정확히 만 14세
    ("2012-10-21", False),   # 하루 미달
    ("2012-02-29", True),    # 윤년 생일
    ("2012-10-19", True),
])
def test_ts12_경계_단위(birth, ok):
    if ok:
        assert policy.validate_birth_date(birth) == date.fromisoformat(birth)
    else:
        with pytest.raises(Exception) as exc:
            policy.validate_birth_date(birth)
        assert exc.value.detail["code"] == "AGE_RESTRICTED"


def test_ts12_윤년_2월29일생은_평년_3월1일에_만14세():
    birth = date(2012, 2, 29)
    assert not policy.is_age_eligible(birth, date(2026, 2, 28))
    assert policy.is_age_eligible(birth, date(2026, 3, 1))


def test_ts12_UTC와_한국_날짜_경계():
    # UTC 2026-10-19 15:30 = KST 2026-10-20 00:30
    assert _REAL_TODAY_KST(datetime(2026, 10, 19, 15, 30, tzinfo=timezone.utc)) == date(2026, 10, 20)
    assert _REAL_TODAY_KST(datetime(2026, 10, 19, 14, 30, tzinfo=timezone.utc)) == date(2026, 10, 19)


@pytest.mark.parametrize("value,code", [
    (None, "BIRTH_DATE_REQUIRED"), ("", "BIRTH_DATE_REQUIRED"), ("  ", "BIRTH_DATE_REQUIRED"),
    ("2026-10-21", "INVALID_BIRTH_DATE"), ("2999-01-01", "INVALID_BIRTH_DATE"),
    ("2012-13-40", "INVALID_BIRTH_DATE"), ("hello", "INVALID_BIRTH_DATE"),
])
def test_ts12_누락_미래_형식오류_코드(value, code):
    with pytest.raises(Exception) as exc:
        policy.validate_birth_date(value)
    assert exc.value.detail["code"] == code and exc.value.status_code == 422


# ── TS12: 이메일 가입 ─────────────────────────────────────────────────

def test_ts12_이메일_정확히_14세_201(client):
    res = client.post(REGISTER, json=email_register_payload("ok14@x.com", birth_date="2012-10-20"))
    assert res.status_code == 201, res.text
    assert str(_db().query(User).first().birth_date) == "2012-10-20"


@pytest.mark.parametrize("birth,code", [
    ("2012-10-21", "AGE_RESTRICTED"), (None, "BIRTH_DATE_REQUIRED"),
    ("2030-01-01", "INVALID_BIRTH_DATE"), ("abcd", "INVALID_BIRTH_DATE"),
])
def test_ts12_이메일_거부시_행_0(client, birth, code):
    payload = email_register_payload("no@x.com")
    payload.pop("birth_date")
    if birth is not None:
        payload["birth_date"] = birth
    res = client.post(REGISTER, json=payload)
    assert res.status_code == 422 and res.json()["detail"]["code"] == code, res.text
    _assert_no_rows()


def test_ts12_레거시_register도_같은_규칙(client):
    legacy = email_register_payload("legacy@x.com", role="client")
    legacy.pop("birth_date")
    res = client.post("/api/v1/auth/register", json=legacy)
    assert res.status_code == 422 and res.json()["detail"]["code"] == "BIRTH_DATE_REQUIRED"
    legacy["birth_date"] = "2012-10-21"
    res = client.post("/api/v1/auth/register", json=legacy)
    assert res.status_code == 422 and res.json()["detail"]["code"] == "AGE_RESTRICTED"
    _assert_no_rows()


# ── TS12: Google 신규 / 재로그인 ───────────────────────────────────────

def test_ts12_구글_신규_14세_200_미달_422(client):
    with _google("g1@x.com"):
        under = client.post(GOOGLE, json={"access_token": "t", "consents": consents(), "birth_date": "2012-10-21"})
    assert under.status_code == 422 and under.json()["detail"]["code"] == "AGE_RESTRICTED"
    _assert_no_rows()
    with _google("g1@x.com"):
        ok = client.post(GOOGLE, json={"access_token": "t", "consents": consents(), "birth_date": "2012-10-20"})
    assert ok.status_code == 200, ok.text


def test_ts12_구글_기존_사용자_재로그인은_생일없이_200(client):
    with _google("g2@x.com"):
        assert client.post(GOOGLE, json={"access_token": "t", "consents": consents(), "birth_date": "1990-01-01"}).status_code == 200
        again = client.post(GOOGLE, json={"access_token": "t"})
    assert again.status_code == 200, again.text


def test_ts12_구글_생일_누락은_BIRTH_DATE_REQUIRED(client):
    with _google("g3@x.com"):
        res = client.post(GOOGLE, json={"access_token": "t", "consents": consents()})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "BIRTH_DATE_REQUIRED"
    _assert_no_rows()


# ── TS13: F2 탈퇴 처리 중 이메일 ──────────────────────────────────────

def _make_deleted(client, email):
    assert client.post(REGISTER, json=email_register_payload(email)).status_code == 201
    db = _db()
    u = db.query(User).filter(User.email == email).first()
    u.status = "deleted"
    u.deleted_at = datetime.now(timezone.utc)
    db.commit()


def test_ts13_탈퇴처리중_이메일은_이메일_가입_409(client):
    _make_deleted(client, "gone@x.com")
    res = client.post(REGISTER, json=email_register_payload("GONE@x.com", name="다른사람"))
    assert res.status_code == 409 and res.json()["detail"]["code"] == "ACCOUNT_DELETION_PENDING"
    assert _db().query(User).count() == 1


def test_ts13_탈퇴처리중_이메일은_구글로도_복구_불가(client):
    _make_deleted(client, "gone2@x.com")
    with _google("gone2@x.com"):
        res = client.post(GOOGLE, json={"access_token": "t", "consents": consents(), "birth_date": "1990-01-01"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "ACCOUNT_DELETION_PENDING"
    assert _db().query(User).filter(User.email == "gone2@x.com").first().status == "deleted"


def test_ts13_직접_counselor_등록은_403_유지(client):
    res = client.post("/api/v1/auth/register/counselor", json={})
    assert res.status_code == 403


def test_ts13_클라이언트_검사_제거해도_서버가_연령_검증(client):
    """프론트가 birth_date 검증을 하지 않아도(임의 값 전송) 서버가 막는다."""
    res = client.post(REGISTER, json=email_register_payload("raw@x.com", birth_date="2020-01-01"))
    assert res.status_code == 422 and res.json()["detail"]["code"] == "AGE_RESTRICTED"


# ── TS14 ──────────────────────────────────────────────────────────────

def test_ts14_선택_거부로_가입_차단_안함_버전_저장(client):
    res = client.post(REGISTER, json=email_register_payload("opt@x.com", consents=consents(eeg=False, research=False)))
    assert res.status_code == 201, res.text
    rows = {c.type: c for c in _db().query(Consent).all()}
    assert set(rows) == {"tos", "privacy", "sensitive", "eeg", "research"}
    for t, c in rows.items():
        assert c.version == policy.CONSENT_VERSIONS[t]
    assert rows["tos"].agreed and rows["privacy"].agreed and rows["sensitive"].agreed
    assert not rows["eeg"].agreed and not rows["research"].agreed


def test_ts14_선택_동의_true는_독립_저장(client):
    client.post(REGISTER, json=email_register_payload("opt2@x.com", consents=consents(eeg=True)))
    rows = {c.type: c.agreed for c in _db().query(Consent).all()}
    assert rows["eeg"] is True and rows["research"] is False


@pytest.mark.parametrize("missing", ["tos", "privacy", "sensitive"])
def test_ts14_필수_누락_422_가입행_0(client, missing):
    res = client.post(REGISTER, json=email_register_payload("req@x.com", consents=consents(**{missing: False})))
    assert res.status_code == 422 and res.headers["X-Error-Code"] == "CONSENT_REQUIRED"
    _assert_no_rows()


def test_ts14_게시_버전이_바뀌면_제출_당시_값이_저장(client, monkeypatch):
    monkeypatch.setitem(policy.CONSENT_VERSIONS, "tos", "2.0")
    assert client.post(REGISTER, json=email_register_payload("ver@x.com")).status_code == 201
    rows = {c.type: c.version for c in _db().query(Consent).all()}
    assert rows["tos"] == "2.0" and rows["privacy"] == "1.0"
