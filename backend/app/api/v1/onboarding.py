"""온보딩 API — F1.3 상담사 / F1.4 내담자"""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.client_counselor_link import ClientCounselorLink
from app.models.client_profile import ClientProfile
from app.models.counselor_profile import CounselorProfile
from app.models.user import User
from app.schemas.onboarding import (
    ClientMatchResponse,
    ClientStep1Request,
    ClientStep2Request,
    ClientStep3Request,
    ClientStep4MatchRequest,
    CounselorCompleteResponse,
    CounselorStep1Request,
    CounselorStep2Request,
    CounselorStep3Request,
    CounselorStep4Request,
    MatchedCounselor,
    OnboardingProgressResponse,
)
from app.services import onboarding_service
from app.services.chat_service import get_or_create_direct_room

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------

def _uid(current_user: dict) -> uuid.UUID:
    return uuid.UUID(current_user["id"])


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="생년월일 형식이 올바르지 않습니다 (YYYY-MM-DD)",
        )


def _progress_response(progress) -> OnboardingProgressResponse:
    return OnboardingProgressResponse(
        current_step=progress.current_step,
        step_data=progress.steps or {},
        completed=progress.completed,
    )


def _get_or_create_counselor_profile(user_id: str, db: Session) -> CounselorProfile:
    """상담사 프로필 upsert — 최초 생성 시 임시 상담사 코드 발급."""
    profile = (
        db.query(CounselorProfile)
        .filter(CounselorProfile.user_id == user_id)
        .first()
    )
    if profile is None:
        code = onboarding_service.generate_counselor_code(db)
        profile = CounselorProfile(
            user_id=user_id,
            counselor_code=code,
            specialties=[],
        )
        db.add(profile)
        db.flush()
    return profile


def _get_or_create_client_profile(user_id: str, db: Session) -> ClientProfile:
    profile = (
        db.query(ClientProfile)
        .filter(ClientProfile.user_id == user_id)
        .first()
    )
    if profile is None:
        profile = ClientProfile(user_id=user_id, concerns=[], interests=[])
        db.add(profile)
        db.flush()
    return profile


# ---------------------------------------------------------------------------
# 공통
# ---------------------------------------------------------------------------

@router.get("/me", response_model=OnboardingProgressResponse)
def get_my_progress(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """현재 온보딩 진행 상태 조회."""
    progress = onboarding_service.get_progress(_uid(current_user), db)
    return _progress_response(progress)


# ---------------------------------------------------------------------------
# 상담사 온보딩
# ---------------------------------------------------------------------------

@router.put("/counselor/step1", response_model=OnboardingProgressResponse)
def counselor_step1(
    req: CounselorStep1Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step1 — 기본 정보(이름·연락처)."""
    user_id = _uid(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if req.name is not None:
        user.name = req.name
    if req.phone is not None:
        user.phone = req.phone
    db.add(user)
    progress = onboarding_service.save_step(user_id, 1, req.model_dump(), db)
    return _progress_response(progress)


@router.put("/counselor/step2", response_model=OnboardingProgressResponse)
def counselor_step2(
    req: CounselorStep2Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step2 — 인적사항·전문분야."""
    user_id = _uid(current_user)
    profile = _get_or_create_counselor_profile(user_id, db)
    profile.gender = req.gender
    profile.birth_date = _parse_date(req.birth_date)
    profile.years_of_experience = req.years_of_experience
    profile.specialties = list(req.specialties or [])
    db.add(profile)
    progress = onboarding_service.save_step(user_id, 2, req.model_dump(), db)
    return _progress_response(progress)


@router.put("/counselor/step3", response_model=OnboardingProgressResponse)
def counselor_step3(
    req: CounselorStep3Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step3 — 자격 증빙. 파일 업로드는 F3에서 처리."""
    user_id = _uid(current_user)
    profile = _get_or_create_counselor_profile(user_id, db)
    profile.affiliation_type = req.affiliation_type
    db.add(profile)
    progress = onboarding_service.save_step(user_id, 3, req.model_dump(), db)
    return _progress_response(progress)


@router.put("/counselor/step4", response_model=OnboardingProgressResponse)
def counselor_step4(
    req: CounselorStep4Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step4 — 프로필(이미지·소개)."""
    user_id = _uid(current_user)
    profile = _get_or_create_counselor_profile(user_id, db)
    profile.profile_image_url = req.profile_image_url
    profile.bio = req.bio
    db.add(profile)
    progress = onboarding_service.save_step(user_id, 4, req.model_dump(), db)
    return _progress_response(progress)


@router.post("/counselor/complete", response_model=CounselorCompleteResponse)
def counselor_complete(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """상담사 온보딩 완료 — 상담사 코드 확정 + 인증 등급 상향."""
    user_id = _uid(current_user)
    progress = onboarding_service.get_progress(user_id, db)
    steps = progress.steps or {}
    if "step3" not in steps:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="자격 증빙 단계를 완료해야 합니다",
        )

    profile = _get_or_create_counselor_profile(user_id, db)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    user.verified_tier = "verified"
    db.add(user)

    onboarding_service.complete_onboarding(user_id, db)

    return CounselorCompleteResponse(
        counselor_code=profile.counselor_code,
        verified_tier=user.verified_tier,
    )


# ---------------------------------------------------------------------------
# 내담자 온보딩
# ---------------------------------------------------------------------------

@router.put("/client/step1", response_model=OnboardingProgressResponse)
def client_step1(
    req: ClientStep1Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step1 — 기본 정보."""
    user_id = _uid(current_user)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if req.name is not None:
        user.name = req.name
    if req.phone is not None:
        user.phone = req.phone
    db.add(user)
    progress = onboarding_service.save_step(user_id, 1, req.model_dump(), db)
    return _progress_response(progress)


@router.put("/client/step2", response_model=OnboardingProgressResponse)
def client_step2(
    req: ClientStep2Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step2 — 인적사항·고민/관심사."""
    user_id = _uid(current_user)
    profile = _get_or_create_client_profile(user_id, db)
    profile.gender = req.gender
    profile.birth_date = _parse_date(req.birth_date)
    profile.concerns = list(req.concerns or [])
    profile.interests = list(req.interests or [])
    db.add(profile)
    progress = onboarding_service.save_step(user_id, 2, req.model_dump(), db)
    return _progress_response(progress)


@router.put("/client/step3", response_model=OnboardingProgressResponse)
def client_step3(
    req: ClientStep3Request,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step3 — 프로필(이미지·소개)."""
    user_id = _uid(current_user)
    profile = _get_or_create_client_profile(user_id, db)
    profile.profile_image_url = req.profile_image_url
    profile.bio = req.bio
    db.add(profile)
    progress = onboarding_service.save_step(user_id, 3, req.model_dump(), db)
    return _progress_response(progress)


@router.post("/client/step4-match", response_model=ClientMatchResponse)
def client_step4_match(
    req: ClientStep4MatchRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step4 — 상담사 코드 매칭."""
    user_id = _uid(current_user)
    profile = (
        db.query(CounselorProfile)
        .filter(CounselorProfile.counselor_code == req.counselor_code)
        .first()
    )
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="상담사 코드를 찾을 수 없습니다",
        )
    counselor = db.query(User).filter(User.id == profile.user_id).first()
    if counselor is None or counselor.verified_tier == "unverified":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="해당 상담사는 아직 인증이 완료되지 않아 매칭할 수 없습니다",
        )

    existing_link = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == user_id,
            ClientCounselorLink.counselor_id == counselor.id,
        )
        .first()
    )
    if existing_link is None:
        link = ClientCounselorLink(
            client_id=user_id,
            counselor_id=counselor.id,
            status="active",
        )
        db.add(link)
        # 상담사 매칭 시 채팅방 자동 생성
        get_or_create_direct_room(counselor.id, user_id, db)

    onboarding_service.save_step(
        user_id,
        4,
        {"counselor_code": req.counselor_code, "counselor_id": str(counselor.id)},
        db,
    )

    return ClientMatchResponse(
        matched_counselor=MatchedCounselor(
            id=str(counselor.id),
            name=counselor.name,
            counselor_code=profile.counselor_code,
            specialties=list(profile.specialties or []),
            profile_image=counselor.profile_image,
        )
    )


@router.post("/client/complete", response_model=OnboardingProgressResponse)
def client_complete(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """내담자 온보딩 완료."""
    user_id = _uid(current_user)
    progress = onboarding_service.get_progress(user_id, db)
    steps = progress.steps or {}
    for required in ("step1", "step2", "step3", "step4"):
        if required not in steps:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{required} 단계를 완료해야 합니다",
            )
    progress = onboarding_service.complete_onboarding(user_id, db)
    return _progress_response(progress)
