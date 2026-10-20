"""SDD-220 — Sign in with Apple 서버 검증.

- id_token: Apple JWKS(RS256 allowlist) 서명 + iss + aud(설정 허용 목록) + exp 를 서버가 검증한다. alg=none/HS256 거부.
- nonce: 서버가 발급한 일회용 challenge(Redis). 성공 시 원자적으로 1회 소비 — 병렬 replay 도 성공은 최대 1건.
  Apple 은 클라이언트가 보낸 nonce 를 그대로(웹) 또는 SHA-256 해시(iOS 네이티브)로 id_token 에 넣으므로 둘 다 허용한다.
- authorization code 교환으로 얻은 refresh token 은 Fernet 으로 암호화해 저장한다(탈퇴 시 revoke 용). 평문은 로그·응답 금지.
- 실 Apple 호출은 이 모듈의 ``fetch_jwks`` / ``exchange_authorization_code`` / ``revoke_token`` 에만 있다(테스트는 mock).
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import time
from pathlib import Path
from typing import Any

import httpx
from jose import JWTError, jwt

from app.config import settings

logger = logging.getLogger(__name__)

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke"

NONCE_TTL_SECONDS = 600
_NONCE_KEY_PREFIX = "apple:nonce:"
_ALLOWED_ALGS = ("RS256",)
_HTTP_TIMEOUT = 8.0

# 프로세스 내 JWKS 캐시 — kid 가 없을 때만 한 번 갱신한다(키 회전 대응).
_jwks_cache: dict[str, Any] = {"keys": None, "fetched_at": 0.0}


class AppleTokenInvalid(Exception):
    """위조·만료·claim/nonce 불일치 — 401 APPLE_TOKEN_INVALID."""


class AppleUnavailable(Exception):
    """공급자 장애(JWKS/토큰 서버) — 503 APPLE_UNAVAILABLE. 인증을 우회하지 않는다."""


def reset_cache() -> None:
    _jwks_cache["keys"] = None
    _jwks_cache["fetched_at"] = 0.0


def allowed_client_ids() -> set[str]:
    return {c.strip() for c in (settings.apple_client_ids or "").split(",") if c.strip()}


# ── 키 / 토큰 검증 ─────────────────────────────────────────────────────


async def fetch_jwks() -> dict[str, Any]:
    """Apple 공개키 목록 조회. 실패는 AppleUnavailable."""
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(APPLE_JWKS_URL)
        if resp.status_code != 200:
            raise AppleUnavailable("jwks_http_error")
        data = resp.json()
        if not isinstance(data, dict) or not isinstance(data.get("keys"), list):
            raise AppleUnavailable("jwks_malformed")
        return data
    except AppleUnavailable:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise AppleUnavailable("jwks_unreachable") from exc


def _find_key(keys: list[dict[str, Any]] | None, kid: str) -> dict[str, Any] | None:
    for key in keys or []:
        if key.get("kid") == kid:
            return key
    return None


async def _get_signing_key(kid: str) -> dict[str, Any]:
    cached = _find_key(_jwks_cache["keys"], kid)
    if cached is not None:
        return cached
    # 캐시에 없는 kid → 키 회전 가능성: 한 번 갱신 후 다시 찾는다. 장애는 그대로 전파(우회 없음).
    data = await fetch_jwks()
    _jwks_cache["keys"] = data["keys"]
    _jwks_cache["fetched_at"] = time.time()
    found = _find_key(data["keys"], kid)
    if found is None:
        raise AppleTokenInvalid("unknown_kid")
    return found


async def verify_id_token(id_token: str) -> dict[str, Any]:
    """서명·iss·aud·exp 검증 후 claims 반환. nonce 는 호출자가 별도 확인·소비한다."""
    try:
        header = jwt.get_unverified_header(id_token)
    except JWTError as exc:
        raise AppleTokenInvalid("malformed") from exc
    if header.get("alg") not in _ALLOWED_ALGS or not header.get("kid"):
        raise AppleTokenInvalid("bad_header")

    key = await _get_signing_key(str(header["kid"]))
    try:
        claims = jwt.decode(
            id_token,
            key,
            algorithms=list(_ALLOWED_ALGS),
            # aud 는 허용 목록(다중)과 비교해야 하므로 아래에서 직접 검사한다. exp 는 jose 가 검증한다.
            options={"verify_aud": False, "verify_iss": False, "verify_at_hash": False},
        )
    except JWTError as exc:
        raise AppleTokenInvalid("signature_or_expiry") from exc

    if claims.get("iss") != APPLE_ISSUER:
        raise AppleTokenInvalid("bad_issuer")
    aud = claims.get("aud")
    auds = set(aud) if isinstance(aud, list) else {aud}
    allowed = allowed_client_ids()
    matched = auds & allowed
    if not allowed or not matched:
        raise AppleTokenInvalid("bad_audience")
    if not claims.get("sub") or "exp" not in claims:
        raise AppleTokenInvalid("missing_claims")
    # 코드 교환·revoke 는 토큰의 실제 audience(client_id)로 해야 한다.
    claims["_client_id"] = sorted(matched)[0]
    return claims


def nonce_claim_matches(claims: dict[str, Any], raw_nonce: str) -> bool:
    claim = claims.get("nonce")
    if not claim or not raw_nonce:
        return False
    hashed = hashlib.sha256(raw_nonce.encode("utf-8")).hexdigest()
    return secrets.compare_digest(str(claim), raw_nonce) or secrets.compare_digest(str(claim), hashed)


# ── nonce challenge ───────────────────────────────────────────────────


def _nonce_key(raw_nonce: str) -> str:
    return _NONCE_KEY_PREFIX + hashlib.sha256(raw_nonce.encode("utf-8")).hexdigest()


async def issue_challenge(redis: Any) -> str:
    raw = secrets.token_urlsafe(32)
    await redis.set(_nonce_key(raw), "1", ex=NONCE_TTL_SECONDS)
    return raw


async def consume_challenge(redis: Any, raw_nonce: str) -> bool:
    """원자적 1회 소비 — DEL 반환값이 1 인 호출만 성공한다(병렬 replay 방지)."""
    return int(await redis.delete(_nonce_key(raw_nonce))) == 1


# ── 토큰 암호화 ───────────────────────────────────────────────────────


def _fernet():
    key = settings.social_token_encryption_key
    if not key:
        return None
    from cryptography.fernet import Fernet

    try:
        return Fernet(key.encode("utf-8"))
    except (ValueError, TypeError):
        logger.error("[apple] social_token_encryption_key 형식이 올바르지 않습니다 (길이=%d)", len(key))
        return None


def encrypt_token(plain: str | None) -> str | None:
    f = _fernet()
    if not plain or f is None:
        return None
    return f.encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_token(cipher: str | None) -> str | None:
    f = _fernet()
    if not cipher or f is None:
        return None
    from cryptography.fernet import InvalidToken

    try:
        return f.decrypt(cipher.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None


# ── 코드 교환 · revoke ─────────────────────────────────────────────────


def _load_private_key() -> str | None:
    value = (settings.apple_private_key or "").strip()
    if not value:
        return None
    if value.startswith("-----BEGIN"):
        return value.replace("\\n", "\n")
    path = Path(value)
    try:
        return path.read_text() if path.is_file() else None
    except OSError:
        return None


def build_client_secret(client_id: str) -> str | None:
    """Apple 토큰 엔드포인트용 client_secret(ES256 JWT). 키/팀 설정이 없으면 None."""
    private_key = _load_private_key()
    if not (private_key and settings.apple_team_id and settings.apple_key_id):
        return None
    now = int(time.time())
    return jwt.encode(
        {"iss": settings.apple_team_id, "iat": now, "exp": now + 600, "aud": APPLE_ISSUER, "sub": client_id},
        private_key,
        algorithm="ES256",
        headers={"kid": settings.apple_key_id},
    )


async def exchange_authorization_code(code: str, client_id: str) -> str | None:
    """authorization code → refresh token. 설정 미비/실패는 None(가입은 유지, revoke 는 outbox 에서 보류 처리)."""
    secret = build_client_secret(client_id)
    if secret is None:
        return None
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                APPLE_TOKEN_URL,
                data={"client_id": client_id, "client_secret": secret, "code": code, "grant_type": "authorization_code"},
            )
        if resp.status_code != 200:
            logger.warning("[apple] 코드 교환 실패 status=%s", resp.status_code)
            return None
        return resp.json().get("refresh_token")
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("[apple] 코드 교환 통신 오류: %s", type(exc).__name__)
        return None


async def revoke_token(client_id: str, token: str, token_type_hint: str = "refresh_token") -> None:
    """Apple 연결 해제. 실패는 AppleUnavailable(재시도 대상)."""
    secret = build_client_secret(client_id)
    if secret is None:
        raise AppleUnavailable("client_secret_unavailable")
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                APPLE_REVOKE_URL,
                data={
                    "client_id": client_id,
                    "client_secret": secret,
                    "token": token,
                    "token_type_hint": token_type_hint,
                },
            )
    except httpx.HTTPError as exc:
        raise AppleUnavailable("revoke_unreachable") from exc
    if resp.status_code != 200:
        raise AppleUnavailable(f"revoke_http_{resp.status_code}")
