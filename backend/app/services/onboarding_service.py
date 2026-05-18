"""온보딩 공통 서비스 — 진행 상태 관리 + 상담사 코드 발급"""

from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.counselor_profile import CounselorProfile
from app.models.onboarding_progress import OnboardingProgress


_CODE_ALPHABET = string.ascii_uppercase + string.digits
_MAX_CODE_RETRY = 5


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
    """6자리 대문자+숫자 상담사 코드 발급 — unique 충돌 시 최대 5회 재시도."""
    for _ in range(_MAX_CODE_RETRY):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
        exists = (
            db.query(CounselorProfile)
            .filter(CounselorProfile.counselor_code == code)
            .first()
        )
        if exists is None:
            return code
    raise RuntimeError("상담사 코드 발급에 실패했습니다 (충돌)")
