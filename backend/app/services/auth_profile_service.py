"""SDD-302 본인 프로필 응답 — 완료 플래그 대신 저장된 필수정보를 판정한다."""
from app.models.user import User
from app.schemas.auth import UserResponse


def to_user_response(user: User) -> UserResponse:
    response = UserResponse.model_validate(user)
    response.counselor_code = user.counselor_code
    if user.role == "client":
        profile = user.client_profile
        response.gender = profile.gender if profile else None
        # 과거 상세정보 수정은 ClientProfile만 갱신했다. 없을 때 가입 시 User 값으로 보완한다.
        response.birth_date = (profile.birth_date if profile else None) or user.birth_date
        response.client_required_fields = [
            field for field, present in (
                ("name", bool(user.name and user.name.strip())),
                ("gender", response.gender in ("male", "female", "other")),
                ("birth_date", response.birth_date is not None),
            ) if not present
        ]
        progress = user.onboarding_progress
        response.profile_prompt_dismissed = bool(
            progress and (progress.steps or {}).get("profile_prompt_dismissed") is True
        )
    return response
