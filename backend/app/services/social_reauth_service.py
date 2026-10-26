"""SDD-220 — 탈퇴 전 소셜 재인증 proof.

비밀번호가 없는 소셜 계정은 최근(5분 이내) 재인증으로 본인임을 다시 확인한다.
proof 는 대상 user·purpose·만료·일회성에 묶인 불투명 토큰이며 Redis 에만 둔다.
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models.account_deletion import SocialIdentity
from app.models.user import User
from app.services import apple_auth_service
from app.services.signup_policy_service import api_error

logger = logging.getLogger(__name__)

PURPOSE_ACCOUNT_DELETION = "account_deletion"
PURPOSE_DATA_EXPORT = "data_export"  # 데이터 센터 반출 본인 확인
PURPOSES = (PURPOSE_ACCOUNT_DELETION, PURPOSE_DATA_EXPORT)
PROOF_TTL_SECONDS = 300
_KEY_PREFIX = "reauth:"


def reauth_required() -> Exception:
    return api_error(401, "REAUTH_REQUIRED", "본인 확인이 필요해요. 다시 인증해 주세요")


def _key(proof: str) -> str:
    return _KEY_PREFIX + hashlib.sha256(proof.encode("utf-8")).hexdigest()


async def issue_proof(redis: Any, user_id: str, purpose: str, *, google_token: str | None = None) -> str:
    proof = secrets.token_urlsafe(32)
    record = {"uid": str(user_id), "purpose": purpose, "google_token_enc": apple_auth_service.encrypt_token(google_token)}
    await redis.set(_key(proof), json.dumps(record), ex=PROOF_TTL_SECONDS)
    return proof


async def consume_proof(redis: Any, proof: str, user_id: str, purpose: str) -> dict[str, Any]:
    """대상 user·purpose 가 맞는 proof 를 원자적으로 1회 소비한다. 실패는 401 REAUTH_REQUIRED."""
    key = _key(proof)
    raw = await redis.get(key)
    if raw is None:
        raise reauth_required()
    # DEL 이 1 을 돌려준 호출만 성공 — 병렬 재사용을 막는다. 다른 사용자 proof 는 소비하지 않는다.
    record = json.loads(raw)
    if record.get("uid") != str(user_id) or record.get("purpose") != purpose:
        raise reauth_required()
    if int(await redis.delete(key)) != 1:
        raise reauth_required()
    return record


async def verify_google(access_token: str | None, id_token: str | None) -> tuple[str, str | None]:
    """Google 토큰 검증 → (이메일, revoke 가능한 access_token 또는 None). 로그인과 같은 audience 규칙."""
    if bool(access_token) == bool(id_token):
        raise reauth_required()
    allowed = {settings.google_client_id, *[a.strip() for a in settings.google_extra_client_ids.split(",") if a.strip()]}
    allowed.discard("")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            if id_token:
                tok = await client.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": id_token})
                info = tok.json() if tok.status_code == 200 else {}
                if tok.status_code != 200 or info.get("aud") not in allowed:
                    raise reauth_required()
                return str(info.get("email", "")).strip().lower(), None
            resp = await client.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            tok = await client.get("https://oauth2.googleapis.com/tokeninfo", params={"access_token": access_token})
            if resp.status_code != 200 or tok.status_code != 200 or tok.json().get("aud") not in allowed:
                raise reauth_required()
            return str(resp.json().get("email", "")).strip().lower(), access_token
    except httpx.HTTPError:
        raise api_error(503, "GOOGLE_UNAVAILABLE", "Google 인증 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요")


async def verify_apple(db: Session, redis: Any, user: User, id_token: str, nonce: str) -> None:
    """Apple 재인증 — 서명·nonce 검증 후 sub 가 이 계정에 연결된 것인지 확인."""
    try:
        claims = await apple_auth_service.verify_id_token(id_token)
    except apple_auth_service.AppleTokenInvalid:
        raise reauth_required()
    except apple_auth_service.AppleUnavailable:
        raise api_error(503, "APPLE_UNAVAILABLE", "Apple 인증 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요")
    if not apple_auth_service.nonce_claim_matches(claims, nonce):
        raise reauth_required()
    identity = (
        db.query(SocialIdentity)
        .filter(SocialIdentity.provider == "apple", SocialIdentity.subject == str(claims["sub"]))
        .first()
    )
    if identity is None or identity.user_id != user.id:
        raise reauth_required()
    if not await apple_auth_service.consume_challenge(redis, nonce):
        raise reauth_required()
