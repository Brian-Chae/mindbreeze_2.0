"""Auth API Router — Register, Login, Refresh, Logout, OTP"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from jose import JWTError, jwt
from redis.asyncio import Redis
from sqlalchemy.orm import Session

from app.config import settings
from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.redis import get_redis
from app.core.security import (
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.client_profile import ClientProfile
from app.models.consent import Consent
from app.models.onboarding_progress import OnboardingProgress
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.auth import (
    ClientProfileResponse,
    ClientProfileUpdate,
    ConsentRequest,
    CounselorCodeCheckRequest,
    CounselorCodeCheckResponse,
    EmailVerifyTokenResponse,
    GoogleAuthRequest,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    OtpRequestPayload,
    OtpVerifyPayload,
    PasswordForgotRequest,
    PasswordResetRequest,
    RefreshRequest,
    RegisterClientRequest,
    RegisterRequest,
    SetPasswordRequest,
    TokenResponse,
    UpdateUserMeRequest,
    UserResponse,
)
from app.schemas.counselor_info import CounselorInfoResponse, CounselorInfoUpdate
from app.services import (
    admin_password_reset_service,
    counselor_info_service,
    email_verify_service,
    login_attempt_service,
    onboarding_service,
    org_invite_service,
    otp_service,
    password_reset_service,
    refresh_token_service,
)
from app.tasks.email import send_otp_email

router = APIRouter(prefix="/auth", tags=["auth"])


def _is_looxidlabs_email(email: str) -> bool:
    return email.strip().lower().endswith("@looxidlabs.com")


def _ensure_login_role(user: User, requested_role: str | None) -> None:
    if requested_role is not None and user.role != requested_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="선택한 로그인 유형과 계정 유형이 다릅니다. 올바른 탭에서 다시 로그인해 주세요.",
        )


def _ensure_account_active(user: User) -> None:
    """SDD-020: 인증 상태 강제 — suspended/pending 계정의 세션 발급을 차단한다.

    - suspended: 관리자가 비활성화한 계정 → 403.
    - pending: 초대 수락(비밀번호 설정) 전 계정 → 403.
    이번 범위에서는 suspended/pending 만 차단한다(SDD-018 inactive/deleted 미도입).
    """
    if user.status == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="정지된 계정입니다. 관리자에게 문의하세요.",
        )
    if user.status == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="초대 수락(비밀번호 설정)이 완료되지 않은 계정입니다.",
        )


def _to_user_response(user: User) -> UserResponse:
    """User ORM 객체 → UserResponse 변환.

    Pydantic ``from_attributes=True`` 는 SQLAlchemy ``@property`` 를
    건너뛸 수 있으므로 ``counselor_code`` 는 수동으로 주입한다.
    """
    resp = UserResponse.model_validate(user)
    resp.counselor_code = user.counselor_code
    return resp


# ---------------------------------------------------------------------------
# 기존 (하위 호환) Register / Login
# ---------------------------------------------------------------------------

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(req: RegisterRequest, db: Session = Depends(get_db)):
    """회원가입 (하위 호환). 신규 플로우는 /register/counselor, /register/client 사용.

    SDD-016: 이 경로로는 상담사를 만들 수 없다. 상담사는 반드시 기관에 소속되어야 하므로
    기관 코드를 검증하는 /register/counselor 만 허용한다.
    """
    if req.role == "counselor":
        # SDD-017: 상담사는 직접 가입하지 않고 기관 담당자의 초대로 계정이 생성된다.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="상담사는 직접 가입할 수 없습니다. 소속 기관 담당자에게 초대를 요청하세요",
        )

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

    # SDD-020: 비활성화 실효성 — suspended/pending 계정은 비밀번호가 맞아도 로그인 차단.
    # (비밀번호 검증 이후에 확인해 계정 존재 여부를 노출하지 않는다.)
    _ensure_account_active(user)

    _ensure_login_role(user, req.role)
    access_token = create_access_token(subject=str(user.id))
    refresh_token = refresh_token_service.issue_refresh_token(str(user.id), db)
    return LoginResponse(
        user=_to_user_response(user),
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


@router.post("/register/counselor", status_code=status.HTTP_403_FORBIDDEN)
async def register_counselor():
    """상담사 직접 가입 차단 (SDD-073).

    기존 org_code 직접 가입 경로는 플랫폼 관리자 등록 정책의 우회로였다.
    상담사 계정은 기관 담당자의 초대(SDD-017) 또는 개인 상담사 신청
    (/signup-applications/individual-counselor) 승인으로만 생성된다.
    """
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            "상담사 직접 가입은 지원하지 않습니다. 기관 담당자의 초대를 받거나 "
            "개인 상담사 신청을 이용해 주세요."
        ),
    )


def _parse_birth_date(value: str | None) -> date | None:
    """생년월일 검증 — 존재하는 날짜이며 미래 날짜는 불가."""
    if not value:
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="생년월일 형식이 올바르지 않습니다 (YYYY-MM-DD)",
        )
    if parsed > date.today():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="생년월일은 미래 날짜일 수 없습니다",
        )
    return parsed


@router.post("/register/client", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
async def register_client(req: RegisterClientRequest, db: Session = Depends(get_db)):
    """내담자(회원) 가입.

    SDD-073: 가입 시점에 성별·생년월일·전화번호(선택)와 초대 상담사 코드를 함께 받는다.
    - invite_token 이 있으면 코드 대신 초대 상담사를 확정한다(기존 경로 유지).
    - counselor_code 는 사용자 생성 전에 검증해 잘못된 코드로 불완전한 가입을 남기지 않는다.
    가입 이메일은 _create_user_with_role에서 email_verify_token으로 이미 검증되므로,
    link_invited_client의 이메일 일치 검증 기준(user.email)으로 안전하게 쓸 수 있다.
    """
    from app.services import client_service, onboarding_service, signup_application_service

    # 사용자 생성 전에 실패 가능한 입력을 먼저 검증한다 (불완전 가입 방지)
    birth = _parse_birth_date(req.birth_date)
    matched_counselor = None
    if not req.invite_token and req.counselor_code:
        matched_counselor, _, _ = signup_application_service.validate_counselor_code(
            req.counselor_code, db
        )

    user, access, refresh = _create_user_with_role(
        role="client",
        email_verify_token=req.email_verify_token,
        request_email=req.email,
        password=req.password,
        name=req.name,
        consents=req.consents,
        db=db,
    )

    # SDD-073: 가입 정보 저장 — User.phone + ClientProfile(gender/birth_date)
    phone = (req.phone or "").strip() or None
    if phone:
        user.phone = phone
    if req.gender or birth:
        profile = ClientProfile(user_id=user.id, concerns=[], interests=[])
        profile.gender = req.gender
        profile.birth_date = birth
        db.add(profile)
    db.commit()

    # 온보딩 중복 입력 제거 — 가입에서 받은 값으로 step1·2를 미리 마킹한다
    onboarding_service.save_step(str(user.id), 1, {"name": user.name, "phone": phone}, db)
    if req.gender or birth:
        onboarding_service.save_step(
            str(user.id),
            2,
            {"gender": req.gender, "birth_date": req.birth_date, "concerns": [], "interests": []},
            db,
        )

    # 초대 토큰이 있으면 상담사 자동 연결.
    # 이메일 불일치/만료/무효 토큰이면 조용히 스킵되고(가입은 성공),
    # 내담자는 온보딩에서 상담사 코드를 수동 입력하는 폴백을 따른다.
    if req.invite_token:
        client_service.link_invited_client(req.invite_token, user, db)
        # 새로 생성된 링크가 응답 관계에 반영되도록 사용자 재조회
        db.refresh(user)
    elif matched_counselor is not None:
        # 최종 가입 시 코드 재검증 후 연결 (중복 방지·재활성화·채팅방 생성 공용 규칙 재사용)
        matched_counselor, matched_profile, _ = signup_application_service.validate_counselor_code(
            req.counselor_code, db
        )
        client_service.assign_counselor(user.id, matched_counselor.id, db)
        onboarding_service.save_step(
            str(user.id),
            4,
            {
                "counselor_code": matched_profile.counselor_code,
                "counselor_id": str(matched_counselor.id),
            },
            db,
        )
        db.refresh(user)

    # 온보딩 재개 지점 보정 — save_step 은 current_step 을 최대값으로 올리므로
    # (예: 가입에서 step1·2·4 저장 시 4), 첫 미완료 단계(step3 프로필)로 되돌려
    # 온보딩 완료 게이트(step1~4 필수)에 걸리지 않게 한다.
    progress = onboarding_service.get_progress(user.id, db)
    saved_steps = progress.steps or {}
    for n in (1, 2, 3, 4):
        if f"step{n}" not in saved_steps:
            progress.current_step = n
            break
    db.commit()

    return LoginResponse(
        user=_to_user_response(user),
        access_token=access,
        refresh_token=refresh,
    )


@router.post("/counselor-code/check", response_model=CounselorCodeCheckResponse)
async def check_counselor_code(
    req: CounselorCodeCheckRequest,
    db: Session = Depends(get_db),
):
    """가입 전 상담사 코드 확인 (SDD-073).

    OTP 검증을 통과한 사용자(email_verify_token 보유)만 조회할 수 있게 해
    코드 무차별 조회를 제한한다. 응답에는 표시명·기관명만 담는다.
    """
    email_verify_service.verify_email_token(req.email_verify_token)
    from app.services import signup_application_service

    counselor, _, org_name = signup_application_service.validate_counselor_code(
        req.counselor_code, db
    )
    return CounselorCodeCheckResponse(counselor_name=counselor.name, organization_name=org_name)


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

    # SDD-020: 비활성화 실효성 — 발급 시점엔 active 였더라도 이후 suspended/pending 이
    # 되면 토큰 회전을 차단한다. (탈취/정지 계정의 세션 연장 방지)
    user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다",
        )
    _ensure_account_active(user)

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


@router.post("/set-password")
async def set_password(
    req: SetPasswordRequest,
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """SDD-016 — 기관 담당자 초대 토큰으로 최초 비밀번호 설정 + 계정 활성화.

    토큰은 일회용이며 7일 후 만료된다. 성공 시 곧바로 로그인 상태로 진입할 수 있도록
    로그인 응답(access_token/refresh_token)을 반환한다.

    SDD-078 — 단일 제출 경로 유지: 관리자 비밀번호 재설정 토큰(admin_password_reset)도
    이 경로로 소비하되, 초대 수락 로직(status 강제 전환)과 격리된 별도 함수로 처리한다.
    재설정은 전 세션을 무효화하므로 자동 로그인 없이 성공 여부만 반환한다.
    """
    token_type = admin_password_reset_service.peek_token_type(req.token)
    if token_type == admin_password_reset_service.TOKEN_TYPE:
        await admin_password_reset_service.complete_admin_reset(
            req.token, req.new_password, db, redis
        )
        return {"success": True, "flow": "password_reset"}

    user = await org_invite_service.consume_invite(req.token, req.new_password, db, redis)
    access_token = create_access_token(subject=str(user.id))
    refresh_token = refresh_token_service.issue_refresh_token(str(user.id), db)
    return LoginResponse(
        user=_to_user_response(user),
        access_token=access_token,
        refresh_token=refresh_token,
    )


# ---------------------------------------------------------------------------
# Google OAuth
# ---------------------------------------------------------------------------

@router.post("/google", response_model=LoginResponse)
async def google_auth(
    req: GoogleAuthRequest,
    db: Session = Depends(get_db),
):
    """Google access token 검증 → User find-or-create → JWT 발급"""
    import secrets

    import httpx

    # 1. Google userinfo API로 access token 검증 + 사용자 정보 획득
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {req.access_token}"},
            )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="유효하지 않은 Google 인증 토큰입니다",
                )
            user_info = resp.json()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google 인증 서버와 통신할 수 없습니다",
        )

    email = user_info.get("email")
    name = user_info.get("name", email.split("@")[0] if email else "")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google 계정에서 이메일을 확인할 수 없습니다",
        )

    requested_role = req.role or ""
    wants_platform_admin = requested_role == "platform_admin"

    if wants_platform_admin and not _is_looxidlabs_email(email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="시스템 관리자는 looxidlabs.com Google 계정만 로그인할 수 있습니다",
        )

    # 2. User find-or-create
    user = db.query(User).filter(User.email == email).first()

    if user:
        # 역할 의도 검증은 계정 연결 변경과 토큰 발급보다 먼저 수행한다.
        # 관리자 요청은 위의 기존 도메인 승인 정책으로 역할을 결정한다.
        if not wants_platform_admin:
            _ensure_login_role(user, req.role)
        # 기존 사용자 — auth_provider 업데이트 + 필요 시 platform_admin 승격
        updated = False
        if user.auth_provider == "email":
            user.auth_provider = "google"
            updated = True
        if wants_platform_admin and user.role != "platform_admin":
            user.role = "platform_admin"
            updated = True
        if updated:
            db.commit()
            db.refresh(user)
    else:
        # 상담사·기관 로그인 요청은 신규 계정 자동 생성 금지 → 403
        if requested_role in ("counselor", "org_admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="사전 등록된 계정이 없습니다. 관리자에게 문의하세요.",
            )
        role = "platform_admin" if wants_platform_admin else "client"
        # 신규 Google 사용자 생성 (내담자 / 시스템 관리자)
        rand_pw = secrets.token_urlsafe(32)
        user = User(
            email=email,
            password_hash=hash_password(rand_pw),
            name=name,
            role=role,
            auth_provider="google",
            verified_tier="email",
        )
        db.add(user)
        db.flush()

        # 약관 동의 (Google 가입 시 암묵적 동의)
        for ctype in ("tos", "privacy", "sensitive"):
            db.add(Consent(user_id=user.id, type=ctype, agreed=True))
        db.commit()
        db.refresh(user)

    # 3. 초대 토큰 처리 → ClientCounselorLink 자동 생성 (공통 헬퍼 사용)
    #    이메일 일치 검증 + single-use(accepted 전환) + 만료 처리는
    #    link_invited_client가 담당한다. 이메일 불일치/무효 시 조용히 스킵된다.
    if req.invite_token:
        from app.services import client_service
        client_service.link_invited_client(req.invite_token, user, db)
        db.refresh(user)
        # 초대 링크 가입: step4(상담사 매칭)는 link_invited_client가 미리 마킹하지만,
        # step1~3(기본/상세/프로필) 입력은 필수다. current_step이 step4로 올라가
        # step1~3을 건너뛰는 것을 막기 위해, 첫 미완료 단계(step1)부터 시작하도록 보정.
        progress = onboarding_service.get_progress(str(user.id), db)
        saved_steps = progress.steps or {}
        for n in (1, 2, 3, 4):
            if f"step{n}" not in saved_steps:
                progress.current_step = n
                break
        db.commit()

    # 4. JWT 발급
    access_token = create_access_token(subject=str(user.id))
    refresh_token_str = refresh_token_service.issue_refresh_token(str(user.id), db)

    return LoginResponse(
        user=_to_user_response(user),
        access_token=access_token,
        refresh_token=refresh_token_str,
    )


# ---------------------------------------------------------------------------
# PATCH /users/me — 사용자 기본정보 업데이트
# ---------------------------------------------------------------------------

@router.patch("/users/me", response_model=UserResponse)
async def update_user_me(
    req: UpdateUserMeRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """현재 사용자의 기본정보(name, phone, gender, birth_date)를 업데이트하고 온보딩 완료 처리합니다."""
    user_id = uuid.UUID(current_user["id"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다",
        )

    # User 필드 업데이트
    name_changed = False
    if req.name is not None:
        if user.name != req.name:
            name_changed = True
        user.name = req.name
    if req.phone is not None:
        user.phone = req.phone

    # ClientProfile 필드 업데이트 (gender, birth_date)
    if req.gender is not None or req.birth_date is not None:
        profile = db.query(ClientProfile).filter(ClientProfile.user_id == user_id).first()
        if profile is None:
            profile = ClientProfile(user_id=user_id)
            db.add(profile)
            db.flush()
        if req.gender is not None:
            profile.gender = req.gender
        if req.birth_date is not None:
            try:
                from datetime import date
                profile.birth_date = date.fromisoformat(req.birth_date)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="생년월일 형식이 올바르지 않습니다 (YYYY-MM-DD)",
                )

    # 온보딩 완료 처리
    onboarding_service.complete_onboarding(str(user_id), db)

    db.commit()
    db.refresh(user)

    # 이름 변경 시 실시간 브로드캐스트 (모든 채팅방)
    if name_changed:
        from app.ws.chat_namespace import broadcast_profile_updated
        await broadcast_profile_updated(str(user.id), user.name)

    return _to_user_response(user)


# ---------------------------------------------------------------------------
# 상담사 프로필 API
# ---------------------------------------------------------------------------


@router.get("/counselors/me/profile", response_model=CounselorInfoResponse)
async def get_counselor_profile(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """상담사 프로필 조회 (계정정보 + 프로필정보 + 개인정보/주소/version — SDD-077)"""
    user_id = uuid.UUID(current_user["id"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다",
        )
    return counselor_info_service.serialize(user)


@router.patch("/counselors/me/profile", response_model=CounselorInfoResponse)
async def update_counselor_profile(
    req: CounselorInfoUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """상담사 프로필 수정 — 본인. 이메일/역할/소속 등은 수정 불가(403)."""
    user_id = uuid.UUID(current_user["id"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다",
        )

    name_changed = counselor_info_service.update_profile(
        user, req, db, actor_id=user.id, actor_kind="self"
    )

    # 이름 변경 시 실시간 브로드캐스트 (모든 채팅방)
    if name_changed:
        from app.ws.chat_namespace import broadcast_profile_updated
        await broadcast_profile_updated(str(user.id), user.name)

    return counselor_info_service.serialize(user)


# ---------------------------------------------------------------------------
# 내담자 프로필 API
# ---------------------------------------------------------------------------


@router.get("/clients/me/profile", response_model=ClientProfileResponse)
async def get_client_profile(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내담자 프로필 조회 (계정정보 + 프로필정보)"""
    user_id = uuid.UUID(current_user["id"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다",
        )
    profile = user.client_profile
    return ClientProfileResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role,
        phone=user.phone,
        profile_image=user.profile_image or (profile.profile_image_url if profile else None),
        bio=user.bio or (profile.bio if profile else None),
        gender=profile.gender if profile else None,
        birth_date=str(profile.birth_date) if profile and profile.birth_date else None,
        concerns=profile.concerns if profile else [],
        interests=profile.interests if profile else [],
    )


@router.patch("/clients/me/profile", response_model=ClientProfileResponse)
async def update_client_profile(
    req: ClientProfileUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내담자 프로필 수정"""
    user_id = uuid.UUID(current_user["id"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다",
        )

    name_changed = False
    if req.name is not None:
        if user.name != req.name:
            name_changed = True
        user.name = req.name
    if req.phone is not None:
        user.phone = req.phone
    if req.profile_image is not None:
        user.profile_image = req.profile_image
    if req.bio is not None:
        user.bio = req.bio

    # ClientProfile 업데이트
    profile = db.query(ClientProfile).filter(ClientProfile.user_id == user_id).first()
    if profile is None:
        profile = ClientProfile(user_id=user_id, concerns=[], interests=[])
        db.add(profile)
        db.flush()

    if req.gender is not None:
        profile.gender = req.gender
    if req.birth_date is not None:
        try:
            profile.birth_date = date.fromisoformat(req.birth_date)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="생년월일 형식이 올바르지 않습니다 (YYYY-MM-DD)",
            )
    if req.concerns is not None:
        profile.concerns = req.concerns
    if req.interests is not None:
        profile.interests = req.interests

    db.commit()
    db.refresh(user)

    # 이름 변경 시 실시간 브로드캐스트 (모든 채팅방)
    if name_changed:
        from app.ws.chat_namespace import broadcast_profile_updated
        await broadcast_profile_updated(str(user.id), user.name)

    return await get_client_profile(current_user, db)
