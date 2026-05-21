"""API v1 Router"""

from fastapi import APIRouter
from app.api.v1 import auth, client, credential, onboarding, org, session, chat, audio, records, reports, admin, notifications

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(onboarding.router)
router.include_router(org.router)
router.include_router(credential.router)
router.include_router(client.router)
router.include_router(client.invite_router)
router.include_router(session.router)
router.include_router(chat.router)
router.include_router(audio.router)
router.include_router(records.router)
router.include_router(reports.router)
router.include_router(admin.router)
router.include_router(notifications.router)
