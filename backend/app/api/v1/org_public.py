"""기관 전용 공개 페이지 API — 인증 불필요

기관 코드로 접속해 소속 상담사와 진행중 클래스를 확인하는 유입 경로용 엔드포인트다.
개인정보(이메일·전화·주소·사업자번호)는 응답에 포함하지 않는다.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DBSession

from app.core.database import get_db
from app.schemas.org_public import OrgPublicResponse
from app.services import org_public_service

router = APIRouter(prefix="/o", tags=["org-public"])


@router.get("/{org_code}", response_model=OrgPublicResponse)
def get_org_public_page(org_code: str, db: DBSession = Depends(get_db)):
    """기관 코드로 공개 페이지 조회 — 소속 상담사 + 진행 가능한 클래스 목록."""
    return org_public_service.get_org_public_page(org_code, db)
