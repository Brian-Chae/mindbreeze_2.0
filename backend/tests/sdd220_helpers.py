"""SDD-220 트랙 ⓒ 테스트 공통 헬퍼 — Apple 서명 키(자체 생성 RSA)·가입 payload."""

from __future__ import annotations

import hashlib
import time
import uuid

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwk, jwt

APPLE_AUD = "kr.test.mindbreeze"
APPLE_ISS = "https://appleid.apple.com"
VALID_PASSWORD = "Passw0rd!"


class AppleKey:
    """자체 생성 RSA 키 — 실 Apple 호출 없이 JWKS 를 mock 한다."""

    def __init__(self, kid: str = "kid-1") -> None:
        self.kid = kid
        self._private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.private_pem = self._private.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        public_pem = self._private.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        public = jwk.construct(public_pem, "RS256").to_dict()
        public.update({"kid": kid, "use": "sig", "alg": "RS256"})
        self.public_jwk = public

    def token(self, *, sub: str | None = None, email: str | None = "u@privaterelay.appleid.com", nonce: str | None = None,
              hashed_nonce: bool = False, aud: str = APPLE_AUD, iss: str = APPLE_ISS, exp_delta: int = 600,
              alg: str = "RS256", kid: str | None = None) -> str:
        claims: dict = {"iss": iss, "aud": aud, "sub": sub or f"apple-{uuid.uuid4().hex[:10]}",
                        "iat": int(time.time()), "exp": int(time.time()) + exp_delta}
        if email is not None:
            claims["email"] = email
            claims["email_verified"] = "true"
        if nonce is not None:
            claims["nonce"] = hashlib.sha256(nonce.encode()).hexdigest() if hashed_nonce else nonce
        return jwt.encode(claims, self.private_pem, algorithm=alg, headers={"kid": kid or self.kid})


def consents(**overrides):
    base = {"tos": True, "privacy": True, "sensitive": True}
    base.update(overrides)
    return base


def email_register_payload(email: str, **overrides):
    from app.services import email_verify_service

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "홍길동",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": consents(),
        "birth_date": "1990-05-01",
    }
    payload.update(overrides)
    return payload


# ── 계정 탈퇴 테스트용 ────────────────────────────────────────────────

def ensure_account_routes() -> None:
    """account 라우터는 api/v1/__init__.py 등록 전(감독자 소유)이므로 테스트 앱에 직접 include 한다(1회)."""
    from app.api.v1 import account
    from app.main import app

    if not any(getattr(r, "path", "") == "/api/v1/users/me" for r in app.routes):
        app.include_router(account.router, prefix="/api/v1")
        app.include_router(account.public_router, prefix="/api/v1")


def make_user(db, email: str, *, role: str = "client", provider: str = "email", password: str = VALID_PASSWORD,
              org_id=None, status: str = "active"):
    from app.core.security import hash_password
    from app.models.user import User

    user = User(email=email, password_hash=hash_password(password), name="원래이름", role=role,
                auth_provider=provider, org_id=org_id, status=status, phone="010-1234-5678")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_org(db, name: str = "테스트기관"):
    from app.models.organization import Organization

    org = Organization(name=name, kind="institution", verified=True)
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def auth_headers(user) -> dict:
    from app.core.security import create_access_token

    return {"Authorization": f"Bearer {create_access_token(subject=str(user.id))}"}
