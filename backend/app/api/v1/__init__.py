"""API v1 Router"""

from fastapi import APIRouter
from app.api.v1 import auth, client, credential, onboarding, org

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(onboarding.router)
router.include_router(org.router)
router.include_router(credential.router)
router.include_router(client.router)
router.include_router(client.invite_router)
