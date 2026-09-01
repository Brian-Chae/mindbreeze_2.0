"""온보딩 공통 서비스 — 진행 상태 관리 + 상담사 코드 발급"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.counselor_profile import CounselorProfile
from app.models.onboarding_progress import OnboardingProgress
from app.services import code_service


_CODE_ALPHABET = code_service.CODE_ALPHABET
_MAX_CODE_RETRY = code_service.MAX_CODE_RETRY


def get_progress(user_id: str, db: Session) -> OnboardingProgress:
    """현재 진행 상태 조회 — 없으면 생성."""
    progress = (
        db.query(OnboardingProgress)
        .filter(OnboardingProgress.user_id == user_id)
        .first()
    )
    if progress is None:
        progress = OnboardingProgress(user_id=user_id, current_step=1, steps={}, completed=False)
        db.add(progress)
        db.commit()
        db.refresh(progress)
    return progress


def save_step(user_id: str, step: int, data: dict, db: Session) -> OnboardingProgress:
    """step_data 업데이트 + current_step 갱신."""
    progress = get_progress(user_id, db)
    steps = dict(progress.steps or {})
    steps[f"step{step}"] = {
        **data,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    progress.steps = steps
    if step > (progress.current_step or 1):
        progress.current_step = step
    db.add(progress)
    db.commit()
    db.refresh(progress)
    return progress


def complete_onboarding(user_id: str, db: Session) -> OnboardingProgress:
    """온보딩 완료 처리."""
    progress = get_progress(user_id, db)
    progress.completed = True
    progress.completed_at = datetime.now(timezone.utc)
    db.add(progress)
    db.commit()
    db.refresh(progress)
    return progress


def generate_counselor_code(db: Session) -> str:
    """6자리 대문자+숫자 상담사 코드 발급 — unique 충돌 시 최대 5회 재시도.

    SDD-015에서 발급 로직을 code_service로 공용화했다 (동작 동일).
    """
    return code_service.generate_unique_code(
        db, CounselorProfile, "counselor_code", label="상담사 코드"
    )
