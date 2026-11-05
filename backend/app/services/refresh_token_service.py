"""Refresh 토큰 — JWT 발급/회전/폐기. jti 기반 재사용 감지."""

import base64
import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import cast

from fastapi import HTTPException, status
from jose import jwt
from sqlalchemy import CursorResult, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.refresh_token import RefreshToken

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _encode(user_id: str, jti: str, expire: datetime, remember: bool = True) -> str:
    # remember 클레임으로 "로그인 상태 유지" 선택을 토큰 회전(refresh) 후에도 이어받는다.
    # 기존에 발급된 토큰에는 클레임이 없으므로 읽는 쪽에서 True(기존 동작)로 폴백한다.
    payload = {
        "sub": user_id,
        "exp": expire,
        "type": "refresh",
        "jti": jti,
        "remember": bool(remember),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def issue_refresh_token(
    user_id: str, db: Session, remember: bool = True, *, commit: bool = True
) -> str:
    """신규 Refresh 토큰 발급 + DB 기록.

    remember=False 로 발급된 토큰은 refresh 회전 시에도 세션 쿠키로 재발급된다.
    DATA-03: commit=False 이면 flush 만 수행한다 — 가입 트랜잭션에 합류해
    요청 단위 단일 커밋이 되도록 한다.
    """
    jti = uuid.uuid4().hex
    expire = _now() + timedelta(days=settings.refresh_token_expire_days)
    token = _encode(user_id, jti, expire, remember=remember)

    db.add(RefreshToken(jti=jti, user_id=uuid.UUID(user_id), expires_at=expire))
    if commit:
        db.commit()
    else:
        db.flush()
    return token


def rotate_refresh_token(
    old_jti: str, user_id: str, db: Session, remember: bool = True
) -> str:
    """기존 토큰 폐기 → 신규 발급. 호출 전 재사용 여부는 라우터에서 검증.

    DATA-02: 기존 '조회 후 폐기'는 원자적이지 않아 동시 요청 시 두 개의 유효
    토큰이 발급될 수 있었다. 조건부 UPDATE(revoked_at IS NULL)로 영향 행수가
    정확히 1일 때만 신규 토큰을 발급해 회전을 원자화한다.
    """
    now = _now()
    new_jti = uuid.uuid4().hex
    expire = now + timedelta(days=settings.refresh_token_expire_days)
    new_token = _encode(user_id, new_jti, expire, remember=remember)

    # 원자적 회전 — 이미 폐기된 토큰(revoked_at NOT NULL)이면 0행 → 신규 발급 금지.
    result = db.execute(
        text(
            "UPDATE refresh_tokens SET revoked_at = :now "
            "WHERE jti = :jti AND revoked_at IS NULL"
        ),
        {"now": now, "jti": old_jti},
    )
    if cast(CursorResult, result).rowcount != 1:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이미 사용되었거나 폐기된 리프레시 토큰입니다",
        )

    # 대체 토큰 참조 기록 (기존 회전 추적 동작 유지)
    db.execute(
        text("UPDATE refresh_tokens SET replaced_by = :new WHERE jti = :jti"),
        {"new": new_jti, "jti": old_jti},
    )

    db.add(RefreshToken(jti=new_jti, user_id=uuid.UUID(user_id), expires_at=expire))
    db.commit()
    return new_token


# 회전 직후 동시 요청(여러 탭·로그인 직후 401 재시도 등)이 같은 토큰으로 refresh 를 보내는
# 정상 경합을 '탈취'로 오판하지 않기 위한 유예 시간(초). 이 안에서는 후속 유효 토큰을 이어서 회전한다.
REUSE_GRACE_SECONDS = 10
_GRACE_MAX_HOPS = 5


def find_grace_successor(record: RefreshToken, db: Session) -> RefreshToken | None:
    """회전으로 막 폐기된 토큰(유예 시간 이내)이면 체인을 따라 현재 유효한 후속 토큰을 반환한다.

    회전이 아닌 폐기(로그아웃·전체 폐기: replaced_by 없음)나 유예 초과·후속 토큰 없음은
    None → 호출 측이 기존대로 재사용(탈취) 처리한다.
    """
    now = _now()
    current = record
    for _ in range(_GRACE_MAX_HOPS):
        if current.revoked_at is None:
            return current if current is not record else None
        if not current.replaced_by:
            return None
        revoked_at = current.revoked_at
        if revoked_at.tzinfo is None:  # SQLite(테스트)는 naive 로 돌려준다
            revoked_at = revoked_at.replace(tzinfo=timezone.utc)
        if now - revoked_at > timedelta(seconds=REUSE_GRACE_SECONDS):
            return None
        nxt = db.query(RefreshToken).filter(RefreshToken.jti == current.replaced_by).first()
        if nxt is None:
            return None
        current = nxt
    return None


# ---------------------------------------------------------------------------
# SDD-305: 회전 결과 멱등화 — 같은 old_jti 의 짧은 중복 요청은 같은 새 토큰 쌍을 받는다.
# ---------------------------------------------------------------------------

def _result_cipher():
    """jwt_secret_key 에서 유도한 Fernet. 새 시크릿 설정 없이 암호화한다(키 교체 시 캐시는 읽히지 않아 무시된다)."""
    from cryptography.fernet import Fernet

    digest = hashlib.sha256(b"mb-refresh-rotation-result:" + settings.jwt_secret_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _seal_result(access_token: str, refresh_token: str, remember: bool) -> str:
    payload = json.dumps({"a": access_token, "r": refresh_token, "m": bool(remember)})
    return _result_cipher().encrypt(payload.encode("utf-8")).decode("ascii")


def _open_result(sealed: str) -> dict | None:
    try:
        data = json.loads(_result_cipher().decrypt(sealed.encode("ascii")).decode("utf-8"))
    except Exception:  # 키 불일치·손상 → 캐시 없음으로 취급(재사용 판정은 호출 측 기존 경로)
        return None
    if not isinstance(data, dict) or "a" not in data or "r" not in data:
        return None
    return data


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def rotate_refresh_token_with_result(
    old_jti: str, user_id: str, db: Session, access_token: str, remember: bool = True
) -> str | None:
    """원자적 회전 + 결과 암호문 보존(같은 트랜잭션). 경쟁에서 지면 None(롤백됨).

    회전 UPDATE 와 rotation_result 기록이 한 커밋이라, 승자가 커밋하기 전에는 패자가 결과를 볼 수 없고
    커밋 뒤에는 항상 결과가 있다(\"회전 후 best-effort 캐시\" 아님).
    """
    now = _now()
    new_jti = uuid.uuid4().hex
    expire = now + timedelta(days=settings.refresh_token_expire_days)
    new_token = _encode(user_id, new_jti, expire, remember=remember)
    sealed = _seal_result(access_token, new_token, remember)

    result = db.execute(
        text(
            "UPDATE refresh_tokens SET revoked_at = :now, replaced_by = :new, rotation_result = :sealed "
            "WHERE jti = :jti AND revoked_at IS NULL"
        ),
        {"now": now, "new": new_jti, "sealed": sealed, "jti": old_jti},
    )
    if cast(CursorResult, result).rowcount != 1:
        db.rollback()
        return None
    db.add(RefreshToken(jti=new_jti, user_id=uuid.UUID(user_id), expires_at=expire))
    db.commit()
    return new_token


def load_duplicate_result(old_jti: str, db: Session) -> dict | None:
    """유예 안의 이미 회전된 토큰이면 첫 회전이 만든 {access, refresh, remember} 를 복호화해 돌려준다.

    조건: 회전으로 폐기(replaced_by) · 유예 이내 · 후속 토큰이 아직 유효(로그아웃·전체 폐기·재회전 안 됨) ·
    암호문 존재. 하나라도 어긋나면 None → 호출 측이 기존 재사용 판정을 그대로 적용한다.
    """
    db.expire_all()  # 경쟁 패자는 승자 커밋 뒤의 최신 행을 읽어야 한다
    record = db.query(RefreshToken).filter(RefreshToken.jti == old_jti).first()
    if record is None or record.revoked_at is None or not record.replaced_by or not record.rotation_result:
        return None
    if _now() - _aware(record.revoked_at) > timedelta(seconds=REUSE_GRACE_SECONDS):
        return None
    successor = db.query(RefreshToken).filter(RefreshToken.jti == record.replaced_by).first()
    if successor is None or successor.revoked_at is not None:
        return None
    if _aware(successor.expires_at) <= _now():
        return None
    sealed = _open_result(record.rotation_result)
    if sealed is None:
        return None
    return {"access_token": sealed["a"], "refresh_token": sealed["r"], "remember": bool(sealed.get("m", True))}


def revoke_token(jti: str, db: Session) -> None:
    """단일 토큰 폐기"""
    token = db.query(RefreshToken).filter(RefreshToken.jti == jti).first()
    if token and token.revoked_at is None:
        token.revoked_at = _now()
        db.commit()


def revoke_all_user_tokens(user_id: str, db: Session) -> None:
    """사용자 전체 활성 토큰 폐기 (재사용 감지 시)"""
    db.query(RefreshToken).filter(
        RefreshToken.user_id == uuid.UUID(user_id),
        RefreshToken.revoked_at.is_(None),
    ).update({"revoked_at": _now()})
    # SDD-305: 이미 회전된 행에 남은 결과 암호문도 비운다 — 전체 폐기 뒤에는 어떤 경로로도 토큰이 되살아나지 않게.
    db.query(RefreshToken).filter(
        RefreshToken.user_id == uuid.UUID(user_id),
        RefreshToken.rotation_result.is_not(None),
    ).update({"rotation_result": None})
    db.commit()
