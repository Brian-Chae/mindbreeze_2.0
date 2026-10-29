"""API Dependencies — DB Session, Current User"""

import threading

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.config import settings
from app.core.database import get_db
from app.core.security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


# 이 파일의 인증 의존성은 일부러 `def`(동기)다. `async def` 안에서 동기 DB 조회를 하면
# 이벤트 루프가 막혀 같은 프로세스의 다른 요청·Socket.IO 가 모두 줄을 서고, 풀이 가득 차면
# 루프 위에서 커넥션을 기다리다 교착(pool_timeout 까지 정지)한다. `def` 로 두면 FastAPI 가
# 스레드풀에서 실행한다. async 로 되돌리지 말 것(tests/test_auth_deps_nonblocking.py 가 고정).


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """JWT 토큰에서 현재 사용자 추출. 미인증 시 401."""
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증이 필요합니다")

    try:
        payload = decode_token(token)
        # JWT type 검증 — refresh token 을 access token 으로 오용하는 것 방지
        if payload.get("type") != "access":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 토큰")
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
    if user.status == "deleted":  # SDD-209(B1): 삭제(비활성 전환) 계정은 토큰이 남아 있어도 차단
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다")
    # SDD-136: 정지/대기 계정은 토큰이 유효해도 매 요청 차단 — 로그인 시에만 검사하던 것을 강화.
    if user.status == "suspended":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="정지된 계정입니다. 관리자에게 문의하세요.")
    if user.status == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="초대 수락(비밀번호 설정)이 완료되지 않은 계정입니다.",
        )
    return {
        "id": str(user.id),
        "role": user.role,
        "email": user.email,
        "name": user.name,
        # SDD-017: 기관 소속 권한 검증(초대/목록/재발송)에 사용
        "org_id": str(user.org_id) if user.org_id else None,
    }


def get_current_user_optional(
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
        return get_current_user(token=token, db=db)
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



# ── archive(raw/산출물) presign·ack 동시 처리 상한 ─────────────────────────────
# 앱이 백그라운드에서 돌아오면 쌓인 청크를 한꺼번에 올린다. 이 요청들은 S3 호출을 끼고 있어 길어질 수 있으므로
# 프로세스 전역으로 동시 수를 제한해 DB 풀·스레드풀을 독점하지 못하게 한다(다른 요청이 항상 풀을 쓸 수 있게).
_archive_slots = threading.BoundedSemaphore(settings.archive_max_concurrent)


def archive_upload_slot():
    """presign/ack 엔드포인트용 의존성(yield). 슬롯이 없으면 잠시 기다린 뒤 429 + Retry-After.

    `get_db` 보다 먼저 평가되도록 엔드포인트 인자 맨 앞에 둔다 — 대기 중에는 DB 커넥션을 잡지 않는다.
    """
    if not _archive_slots.acquire(timeout=settings.archive_slot_wait_sec):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "archive_busy"},
            headers={"Retry-After": "3"},
        )
    try:
        yield
    finally:
        _archive_slots.release()
