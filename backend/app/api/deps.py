"""API Dependencies — DB Session, Current User"""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """JWT 토큰에서 현재 사용자 추출. 미인증 시 401."""
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증이 필요합니다")

    try:
        payload = decode_token(token)
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 토큰")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="토큰이 만료되었거나 유효하지 않습니다")

    # TODO: DB에서 User 조회 → return user
    from app.models.user import User as UserModel
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다")
    return {
        "id": str(user.id),
        "role": user.role,
        "email": user.email,
        "name": user.name,
        # SDD-017: 기관 소속 권한 검증(초대/목록/재발송)에 사용
        "org_id": str(user.org_id) if user.org_id else None,
    }


async def get_current_user_optional(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> dict | None:
    """선택적 인증 — 토큰이 없거나 유효하지 않으면 None.

    SDD-015 게스트 참여처럼 비로그인 접근을 허용하는 엔드포인트에서 사용한다.
    401을 던지지 않는다.
    """
    if token is None:
        return None
    try:
        return await get_current_user(token=token, db=db)
    except HTTPException:
        return None


def require_roles(*roles: str):
    """지정한 role 만 접근을 허용하는 의존성 팩토리 (SDD-015)."""

    async def _guard(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="이 작업을 수행할 권한이 없습니다",
            )
        return current_user

    return _guard
