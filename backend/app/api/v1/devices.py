"""SDD-190: 앱 푸시 디바이스 토큰 API.

인증 필수(모든 role 허용) — 앱을 쓰는 내담자·상담사 모두 자기 기기를 등록한다.
타인 토큰은 조회·해지할 수 없다(DELETE 는 소유자 불일치 시 404).
"""

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.device import DeviceRegisterRequest, DeviceRegisterResponse
from app.services import device_service

router = APIRouter(prefix="/devices", tags=["devices"])


@router.post("", response_model=DeviceRegisterResponse)
def register_device(
    payload: DeviceRegisterRequest,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """디바이스 토큰 등록(upsert) — 같은 토큰 재호출은 행을 늘리지 않고 갱신만 한다."""
    row = device_service.register_token(
        db,
        current_user["id"],
        token=payload.token,
        platform=payload.platform,
        app_version=payload.app_version,
        device_label=payload.device_label,
    )
    return DeviceRegisterResponse(id=str(row.id), token=row.token, platform=row.platform)


@router.delete("/{token}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_device(
    token: str = Path(min_length=1, max_length=512),
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """본인 토큰 해지(로그아웃 등). 타인 토큰·미등록 토큰은 404."""
    if not device_service.revoke_token(db, current_user["id"], token):
        raise HTTPException(status_code=404, detail="디바이스 토큰을 찾을 수 없습니다")
    return None
