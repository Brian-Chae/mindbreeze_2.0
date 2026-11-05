"""SDD-305 C: refresh 회전 멱등화 — 같은 old refresh 의 짧은 중복 요청은 같은 새 토큰 쌍을 받는다.

동시성(진짜 트랜잭션 경쟁)은 tests/pg/test_sdd305_refresh_pg.py 가 검증한다. 여기는 SQLite 로 순차 시나리오·보안 경계를 본다.
"""

import logging
from datetime import timedelta

from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services import refresh_token_service as svc
from tests.test_auth_login import VALID_PASSWORD, _register

NATIVE = {"x-mb-native": "capacitor"}


def _login(client, email="rc@test.com"):
    _register(client, email)
    res = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": VALID_PASSWORD},
        headers=NATIVE,
    )
    assert res.status_code == 200, res.text
    return res.headers["X-MB-Refresh-Token"], res.json()["access_token"]


def _refresh(client, token, extra=None):
    return client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": token},
        headers={**NATIVE, **(extra or {})},
    )


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _age_rotation(jti, seconds):
    """회전 시각을 과거로 당겨 유예 경과를 흉내 낸다."""
    db = _db()
    try:
        row = db.query(RefreshToken).filter(RefreshToken.jti == jti).first()
        row.revoked_at = row.revoked_at - timedelta(seconds=seconds)
        db.commit()
    finally:
        db.close()


def _jti(token):
    from jose import jwt as _jwt

    from app.config import settings

    return _jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])["jti"]


def test_c1_c4_duplicate_gets_same_pair_and_no_extra_rotation(client):
    r0, _ = _login(client)
    db = _db()
    try:
        before = db.query(RefreshToken).count()
    finally:
        db.close()
    first = _refresh(client, r0)  # W: R0→R1
    assert first.status_code == 200, first.text
    r1 = first.headers["X-MB-Refresh-Token"]
    second = _refresh(client, r0)  # N: 복제본 R0 제출
    assert second.status_code == 200, second.text
    assert second.headers["X-MB-Refresh-Token"] == r1
    assert second.json()["access_token"] == first.json()["access_token"]
    # 회전은 한 번뿐 — 새 jti(후속)는 1개
    db = _db()
    try:
        old = db.query(RefreshToken).filter(RefreshToken.jti == _jti(r0)).one()
        assert old.replaced_by == _jti(r1)
        assert db.query(RefreshToken).count() == before + 1
    finally:
        db.close()
    # 이후 W/N 모두 같은 R1 체인을 쓴다
    third = _refresh(client, r1)
    assert third.status_code == 200


def test_c2_reuse_after_grace_revokes_all(client):
    r0, _ = _login(client)
    first = _refresh(client, r0)
    r1 = first.headers["X-MB-Refresh-Token"]
    _age_rotation(_jti(r0), svc.REUSE_GRACE_SECONDS + 5)
    stale = _refresh(client, r0)
    assert stale.status_code == 401
    # 전체 폐기 — R1 도 더는 못 쓴다
    assert _refresh(client, r1).status_code == 401


def test_c3_logout_then_reuse_does_not_resurrect(client):
    r0, _ = _login(client)
    r1 = _refresh(client, r0).headers["X-MB-Refresh-Token"]
    out = client.post("/api/v1/auth/logout", json={"refresh_token": r1}, headers=NATIVE)
    assert out.status_code == 204
    again = _refresh(client, r0)  # 후속(R1)이 로그아웃으로 폐기됨 → 캐시로 되살리지 않음
    assert again.status_code == 401
    assert _refresh(client, r1).status_code == 401


def test_c5_suspended_account_duplicate_rejected(client):
    r0, _ = _login(client)
    assert _refresh(client, r0).status_code == 200
    db = _db()
    try:
        user = db.query(User).filter(User.email == "rc@test.com").one()
        user.status = "suspended"
        db.commit()
    finally:
        db.close()
    assert _refresh(client, r0).status_code in (401, 403)


def test_c6_revoke_all_clears_rotation_result(client):
    r0, _ = _login(client)
    _refresh(client, r0)
    db = _db()
    try:
        row = db.query(RefreshToken).filter(RefreshToken.jti == _jti(r0)).one()
        assert row.rotation_result
        svc.revoke_all_user_tokens(str(row.user_id), db)
        db.expire_all()
        assert db.query(RefreshToken).filter(RefreshToken.jti == _jti(r0)).one().rotation_result is None
    finally:
        db.close()
    assert _refresh(client, r0).status_code == 401


def test_c7_rotation_result_is_not_plaintext(client):
    r0, _ = _login(client)
    first = _refresh(client, r0)
    r1 = first.headers["X-MB-Refresh-Token"]
    access = first.json()["access_token"]
    db = _db()
    try:
        sealed = db.query(RefreshToken).filter(RefreshToken.jti == _jti(r0)).one().rotation_result
        assert sealed and r1 not in sealed and access not in sealed
    finally:
        db.close()


def test_c8_outcome_logs_have_no_secrets(client, caplog):
    r0, _ = _login(client)
    with caplog.at_level(logging.INFO, logger="app.api.v1.auth"):
        first = _refresh(client, r0, {"x-mb-refresh-source": "webview"})
        r1 = first.headers["X-MB-Refresh-Token"]
        _refresh(client, r0, {"x-mb-refresh-source": "native"})
        _age_rotation(_jti(r0), svc.REUSE_GRACE_SECONDS + 5)
        _refresh(client, r0)
        _refresh(client, "not-a-jwt")
    text = "\n".join(r.getMessage() for r in caplog.records if "refresh_outcome" in r.getMessage())
    for outcome in ("rotated", "duplicate", "reuse"):
        assert f"refresh_outcome={outcome}" in text
    assert "caller=native:webview" in text and "caller=native:native" in text
    assert r0 not in caplog.text and r1 not in caplog.text and first.json()["access_token"] not in caplog.text


def test_expired_result_after_grace_is_unusable_even_with_successor_alive(client):
    r0, _ = _login(client)
    _refresh(client, r0)
    db = _db()
    try:
        assert svc.load_duplicate_result(_jti(r0), db) is not None
    finally:
        db.close()
    _age_rotation(_jti(r0), svc.REUSE_GRACE_SECONDS + 1)
    db = _db()
    try:
        assert svc.load_duplicate_result(_jti(r0), db) is None
    finally:
        db.close()
