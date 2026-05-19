"""Auth API Router — Register, Login, Refresh, Logout, OTP"""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from jose import JWTError, jwt
from redis.asyncio import Redis
from sqlalchemy.orm import Session

from app.config import settings
from app.core.database import get_db
from app.core.redis import get_redis
from app.core.security import (
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.consent import Consent
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.auth import (
    ConsentRequest,
    EmailVerifyTokenResponse,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    OtpRequestPayload,
    OtpVerifyPayload,
    PasswordForgotRequest,
    PasswordResetRequest,
    RefreshRequest,
    RegisterClientRequest,
    RegisterCounselorRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.services import (
    email_verify_service,
    login_attempt_service,
    otp_service,
    password_reset_service,
    refresh_token_service,
)
from app.tasks.email import send_otp_email

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# 기존 (하위 호환) Register / Login
# ---------------------------------------------------------------------------

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(req: RegisterRequest, db: Session = Depends(get_db)):
    """회원가입 (하위 호환). 신규 플로우는 /register/counselor, /register/client 사용."""
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 등록된 이메일입니다")

    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        name=req.name,
        role=req.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=LoginResponse)
async def login(
    req: LoginRequest,
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """로그인 → JWT 발급. 5회 실패 시 15분 잠금."""
    await login_attempt_service.check_login_lock(req.email, redis)

    user = db.query(User).filter(User.email == req.email).first()
    if not user or not verify_password(req.password, user.password_hash):
        await login_attempt_service.record_failed_attempt(req.email, redis)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 또는 비밀번호가 일치하지 않습니다",
        )

    await login_attempt_service.reset_attempts(req.email, redis)
    access_token = create_access_token(subject=str(user.id))
    refresh_token = refresh_token_service.issue_refresh_token(str(user.id), db)
    return LoginResponse(
        user=UserResponse.model_validate(user),
        access_token=access_token,
        refresh_token=refresh_token,
    )


# ---------------------------------------------------------------------------
# B1: OTP + 이메일 검증
# ---------------------------------------------------------------------------

@router.post("/email/request-otp", status_code=status.HTTP_204_NO_CONTENT)
async def request_email_otp(
    req: OtpRequestPayload,
    redis: Redis = Depends(get_redis),
):
    """이메일로 6자리 OTP 발송 (60초 쿨다운)"""
    code = await otp_service.generate_otp(req.email, redis)
    send_otp_email(req.email, code)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/email/verify-otp", response_model=EmailVerifyTokenResponse)
async def verify_email_otp(
    req: OtpVerifyPayload,
    redis: Redis = Depends(get_redis),
):
    """OTP 검증 통과 시 15분 유효 email_verify_token 발급"""
    ok = await otp_service.verify_otp(req.email, req.code, redis)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP가 일치하지 않거나 만료되었습니다",
        )
    token = email_verify_service.generate_email_verify_token(req.email)
    return EmailVerifyTokenResponse(email_verify_token=token)


# ---------------------------------------------------------------------------
# B2: 역할별 가입 (상담사 / 내담자)
# ---------------------------------------------------------------------------

def _validate_consents(consents: ConsentRequest) -> None:
    if not consents.tos or not consents.privacy:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="서비스 이용약관/개인정보 처리방침 동의는 필수입니다",
        )
    if not consents.sensitive:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="민감정보 처리에 동의해야 가입할 수 있습니다",
        )


def _create_user_with_role(
    *,
    role: str,
    email_verify_token: str,
    request_email: str,
    password: str,
    name: str,
    consents: ConsentRequest,
    db: Session,
) -> tuple[User, str, str]:
    """공통 가입 처리 — User + Consent 3종 생성, 토큰 발급."""
    if not email_verify_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 검증 토큰이 필요합니다",
        )
    verified_email = email_verify_service.verify_email_token(email_verify_token)
    if verified_email.lower() != request_email.lower():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 검증 토큰과 가입 이메일이 일치하지 않습니다",
        )

    _validate_consents(consents)

    existing = db.query(User).filter(User.email == verified_email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 등록된 이메일입니다")

    user = User(
        email=verified_email,
        password_hash=hash_password(password),
        name=name,
        role=role,
        verified_tier="email",
    )
    db.add(user)
    db.flush()

    for ctype, agreed in (
        ("tos", consents.tos),
        ("privacy", consents.privacy),
        ("sensitive", consents.sensitive),
    ):
        db.add(Consent(user_id=user.id, type=ctype, agreed=agreed))

    db.commit()
    db.refresh(user)

    access_token = create_access_token(subject=str(user.id))
    refresh_token = refresh_token_service.issue_refresh_token(str(user.id), db)
    return user, access_token, refresh_token


@router.post("/register/counselor", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
async def register_counselor(req: RegisterCounselorRequest, db: Session = Depends(get_db)):
    """상담사 가입"""
    user, access, refresh = _create_user_with_role(
        role="counselor",
        email_verify_token=req.email_verify_token,
        request_email=req.email,
        password=req.password,
        name=req.name,
        consents=req.consents,
        db=db,
    )
    return LoginResponse(
        user=UserResponse.model_validate(user),
        access_token=access,
        refresh_token=refresh,
    )


@router.post("/register/client", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
async def register_client(req: RegisterClientRequest, db: Session = Depends(get_db)):
    """내담자(회원) 가입"""
    user, access, refresh = _create_user_with_role(
        role="client",
        email_verify_token=req.email_verify_token,
        request_email=req.email,
        password=req.password,
        name=req.name,
        consents=req.consents,
        db=db,
    )
    return LoginResponse(
        user=UserResponse.model_validate(user),
        access_token=access,
        refresh_token=refresh,
    )


# ---------------------------------------------------------------------------
# B3: Refresh / Logout
# ---------------------------------------------------------------------------

def _decode_refresh(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="리프레시 토큰이 만료되었거나 유효하지 않습니다",
        )
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="리프레시 토큰 형식이 올바르지 않습니다",
        )
    if not payload.get("jti") or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="리프레시 토큰에 필수 클레임이 없습니다",
        )
    return payload


@router.post("/refresh", response_model=TokenResponse)
async def refresh(req: RefreshRequest, db: Session = Depends(get_db)):
    """Refresh 토큰 회전. 재사용 감지 시 사용자 전체 토큰 폐기."""
    payload = _decode_refresh(req.refresh_token)
    jti = payload["jti"]
    user_id = payload["sub"]

    record = db.query(RefreshToken).filter(RefreshToken.jti == jti).first()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="알 수 없는 리프레시 토큰입니다",
        )

    if record.revoked_at is not None:
        # 재사용 감지 → 사용자 전체 토큰 폐기
        refresh_token_service.revoke_all_user_tokens(user_id, db)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="토큰이 재사용되었습니다. 모든 기기를 로그아웃합니다.",
        )

    new_refresh = refresh_token_service.rotate_refresh_token(jti, user_id, db)
    new_access = create_access_token(subject=user_id)
    return TokenResponse(access_token=new_access, refresh_token=new_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    req: LogoutRequest,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
):
    """Access + Refresh 토큰 폐기"""
    # Refresh 토큰 폐기
    try:
        payload = jwt.decode(
            req.refresh_token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
        jti = payload.get("jti")
        if jti:
            refresh_token_service.revoke_token(jti, db)
    except JWTError:
        # 이미 만료/위조여도 로그아웃은 성공 처리
        pass

    # Access 토큰의 jti는 현재 토큰 구조에 포함되지 않음 → 식별만 검증
    if authorization and authorization.lower().startswith("bearer "):
        access = authorization.split(" ", 1)[1].strip()
        try:
            decode_token(access)
        except JWTError:
            pass

    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# B5: 비밀번호 재설정
# ---------------------------------------------------------------------------

@router.post("/password/forgot", status_code=status.HTTP_204_NO_CONTENT)
async def password_forgot(
    req: PasswordForgotRequest,
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """비밀번호 재설정 링크 발송 (사용자 존재 노출 방지 위해 항상 204)"""
    await password_reset_service.initiate_reset(req.email, db, redis)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password/reset", status_code=status.HTTP_200_OK)
async def password_reset(
    req: PasswordResetRequest,
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """재설정 토큰 검증 + 새 비밀번호 적용"""
    await password_reset_service.complete_reset(req.token, req.new_password, db, redis)
    return {"detail": "비밀번호가 변경되었습니다"}
