"""클래스 입장 자격 — 로그인 없는 참가자의 서버 서명 소유 증명 (SDD-209 B5a / BE-5).

- 코드 확인 + 개인정보 입력으로 입장하면 서버가 **클래스/참여자 범위**의 입장 자격(JWT)을 발급한다.
- 이후 요청의 인증 수단은 이 자격이다. **코드는 상시 인증 수단이 아니다.**
- 클레임: ``type=class_entry``, ``sub=참여자 id``, ``sid=클래스 id``, ``ver=참여자.entry_ver``, ``exp``.
  ``type`` 이 달라 로그인 access 토큰·report_participant 토큰으로 오용될 수 없고, 반대로 이 자격은
  로그인 토큰 검증(``type==access``)과 chat 네임스페이스(``type`` 없음/access 만 허용)를 통과하지 못한다.
- 만료: ``settings.entry_credential_ttl_hours``. 폐기: ``entry_ver`` 증가(로그아웃/재발급 정책).
- 서명키는 기존 ``jwt_secret_key`` 를 재사용한다(별도 type 으로 용도 분리, 값 비출력).
- 자격이 유효해도 클래스가 종료돼 코드가 무효가 된 뒤의 **입장(enter)** 은 불가하지만, 종료 상태를 읽는
  요청(entry-state)은 자격으로 계속 가능하다(FM09 종료 화면).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session as DBSession

from app.config import settings
from app.models.session import SessionParticipant

CREDENTIAL_TYPE = "class_entry"


def _unauthorized(detail: str = "입장 자격이 유효하지 않거나 만료되었어요. 코드를 다시 입력해 주세요.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def issue(participant: SessionParticipant) -> tuple[str, datetime]:
    """참여자 범위 입장 자격을 발급한다. (토큰, 만료 시각) 반환."""
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.entry_credential_ttl_hours)
    token = jwt.encode(
        {
            "type": CREDENTIAL_TYPE,
            "sub": str(participant.id),
            "sid": str(participant.session_id),
            "ver": int(participant.entry_ver or 0),
            "exp": expires_at,
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    return token, expires_at


def decode(token: str | None) -> dict:
    """서명·만료·type 을 검증한 클레임. 실패하면 401."""
    if not token:
        raise _unauthorized()
    try:
        claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise _unauthorized()
    if claims.get("type") != CREDENTIAL_TYPE or not claims.get("sub") or not claims.get("sid"):
        raise _unauthorized()
    return claims


def resolve_participant(
    db: DBSession, token: str | None, session_id: UUID | str | None = None
) -> SessionParticipant:
    """입장 자격 → 소유 참여자.

    - 서명/만료/type 불량, 참여자 없음(제거 포함), 클래스 불일치, 폐기된 버전은 모두 401/403.
    - ``session_id`` 를 주면 자격의 클래스와 같아야 한다(타 클래스 접근 403).
    """
    claims = decode(token)
    try:
        pid = UUID(str(claims["sub"]))
        sid = UUID(str(claims["sid"]))
    except ValueError:
        raise _unauthorized()
    if session_id is not None and sid != UUID(str(session_id)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="다른 클래스의 입장 자격이에요")
    participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.id == pid, SessionParticipant.session_id == sid)
        .first()
    )
    if participant is None or int(claims.get("ver", -1)) != int(participant.entry_ver or 0):
        raise _unauthorized()
    return participant


def revoke(db: DBSession, participant: SessionParticipant) -> None:
    """이 참여자의 기존 입장 자격을 모두 무효화한다(로그아웃·폐기)."""
    participant.entry_ver = int(participant.entry_ver or 0) + 1
    db.commit()
