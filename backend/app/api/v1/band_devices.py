"""SDD-326 — 밴드 시리얼 역조회 (코치·기관관리자·플랫폼 관리자). 회원 화면에는 노출하지 않는다(D1)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.band_device import BandDeviceUsageResponse
from app.services import band_device_service

router = APIRouter(prefix="/band-devices", tags=["band-devices"])


@router.get("/{serial}/usage", response_model=BandDeviceUsageResponse)
def get_band_device_usage(
    serial: str,
    current_user: dict = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """시리얼이 쓰인 회차·참가자와 스트림 교체 수. 자기 권한 범위(담당 회차 / 자기 기관)만."""
    return band_device_service.band_device_usage(db, current_user, serial)
