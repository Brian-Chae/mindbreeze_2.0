"""API v1 Router"""

from fastapi import APIRouter
from app.config import settings
from app.api.v1 import normalization
from app.api.v1 import auth, client, client_portal, credential, dashboard, onboarding, org, org_public, session, chat, audio, video, records, reports, admin, notifications, signup_applications, research_export
from app.api.v1 import class_audio
# SDD-214: 클래스·상담 읽기 API
from app.api.v1 import classes, counseling, class_membership, class_guests, class_reports
# SDD-188: AI 에이전트 채널(내담자 전용)
from app.api.v1 import agent
from app.api.v1 import agent_counselor
# SDD-190: 앱 푸시 디바이스 토큰
from app.api.v1 import devices
# SDD-220: 회원 탈퇴·공개 삭제 요청 접수
from app.api.v1 import account
# SDD-237: 명상 클래스 회차 요약·상담사 클래스 리포트
from app.api.v1 import class_summary
# SDD-243: 플랫폼·기관 데이터 센터
from app.api.v1 import data_center

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(normalization.router)
router.include_router(normalization.public_router)
router.include_router(onboarding.router)
router.include_router(org.router)
router.include_router(credential.router)
router.include_router(client.router)
router.include_router(client.invite_router)
router.include_router(client_portal.router)
router.include_router(session.router)
router.include_router(class_audio.router)
router.include_router(classes.router)
router.include_router(class_membership.router)
router.include_router(class_guests.router)
router.include_router(class_reports.router)
router.include_router(counseling.router)
router.include_router(chat.router)
router.include_router(audio.router)
router.include_router(video.router)
router.include_router(records.router)
router.include_router(reports.router)
router.include_router(admin.router)
router.include_router(research_export.router)
router.include_router(signup_applications.router)
router.include_router(signup_applications.admin_router)
router.include_router(notifications.router)
router.include_router(dashboard.router)
router.include_router(org_public.router)
router.include_router(agent.router)
router.include_router(agent_counselor.router)
router.include_router(devices.router)
router.include_router(account.router)
router.include_router(account.public_router)
router.include_router(class_summary.router)
router.include_router(data_center.router)

# SDD-019: dev 전용 역할 시뮬레이션 라우터.
# 프로덕션에는 엔드포인트 자체가 존재하지 않도록, 아래 두 조건이 모두 참일 때만 조건부 include.
if settings.environment != "production" and settings.enable_dev_role_simulation:
    from app.api.v1 import dev_auth

    router.include_router(dev_auth.router)

from app.api.v1 import data_exports
router.include_router(data_exports.router)
router.include_router(data_exports.center_router)  # SDD-243
