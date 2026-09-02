"""API v1 Router"""

from fastapi import APIRouter
from app.config import settings
from app.api.v1 import auth, client, client_portal, credential, dashboard, onboarding, org, org_public, session, chat, audio, records, reports, admin, notifications

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(onboarding.router)
router.include_router(org.router)
router.include_router(credential.router)
router.include_router(client.router)
router.include_router(client.invite_router)
router.include_router(client_portal.router)
router.include_router(session.router)
router.include_router(chat.router)
router.include_router(audio.router)
router.include_router(records.router)
router.include_router(reports.router)
router.include_router(admin.router)
router.include_router(notifications.router)
router.include_router(dashboard.router)
router.include_router(org_public.router)

# SDD-019: dev 전용 역할 시뮬레이션 라우터.
# 프로덕션에는 엔드포인트 자체가 존재하지 않도록, 아래 두 조건이 모두 참일 때만 조건부 include.
if settings.environment != "production" and settings.enable_dev_role_simulation:
    from app.api.v1 import dev_auth

    router.include_router(dev_auth.router)
