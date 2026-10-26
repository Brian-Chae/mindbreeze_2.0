"""SDD-220 — 계정 탈퇴·재인증·공개 삭제 요청 API.

``DELETE /api/v1/users/me`` 는 기존 ``PATCH /api/v1/auth/users/me`` 와 다른 경로(auth prefix 밖)다.
named export: ``router``(로그인 필요), ``public_router``(비로그인). 등록은 api/v1/__init__.py(감독자 소유).
"""

import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, EmailStr, Field, model_validator
from redis.asyncio import Redis
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.redis import get_redis
from app.core.security import verify_password
from app.models.user import User
from app.schemas.class_report import NotePromptSettingResponse, NotePromptSettingUpdate
from app.services import account_deletion_service, class_summary_service, privacy_consent_service, social_reauth_service
from app.services.signup_policy_service import api_error

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["account"])
public_router = APIRouter(prefix="/account-deletion", tags=["account"])


class ReauthRequest(BaseModel):
    """재인증 — 비밀번호 또는 소셜(google/apple) 토큰 중 하나."""

    password: str | None = None
    provider: str | None = Field(None, pattern="^(google|apple)$")
    access_token: str | None = None
    id_token: str | None = None
    nonce: str | None = None
    purpose: Literal["account_deletion", "data_export"] = "account_deletion"

    @model_validator(mode="after")
    def _one_method(self):
        if bool(self.password) == bool(self.provider):
            raise ValueError("password 또는 provider 중 하나만 전달해야 합니다")
        return self


class ReauthResponse(BaseModel):
    reauth_proof: str
    expires_in: int


class DeleteAccountRequest(BaseModel):
    password: str | None = None
    reauth_proof: str | None = None


class OptionalConsentUpdate(BaseModel):
    """선택 동의 변경 — 보낸 항목만 바뀐다(생략=유지). 필수 동의는 여기서 바꾸지 않는다."""

    eeg: bool | None = None
    research: bool | None = None


class PublicDeletionRequest(BaseModel):
    email: EmailStr


def _load_user(db: Session, current_user: dict) -> User:
    user = db.query(User).filter(User.id == uuid.UUID(current_user["id"])).first()
    if user is None:
        raise api_error(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다")
    return user


@router.post("/me/reauth", response_model=ReauthResponse)
async def reauth(
    req: ReauthRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """재인증 proof 발급(5분, 1회용, 본인 계정·요청한 purpose 에만 유효). purpose: 계정 삭제(기본) | 데이터 반출."""
    user = _load_user(db, current_user)
    google_token: str | None = None
    if req.password:
        if not verify_password(req.password, user.password_hash):
            raise social_reauth_service.reauth_required()
    elif req.provider == "google":
        email, google_token = await social_reauth_service.verify_google(req.access_token, req.id_token)
        if email != user.email.strip().lower():
            raise social_reauth_service.reauth_required()
    elif req.provider == "apple":
        if not (req.id_token and req.nonce):
            raise social_reauth_service.reauth_required()
        await social_reauth_service.verify_apple(db, redis, user, req.id_token, req.nonce)
    proof = await social_reauth_service.issue_proof(
        redis, str(user.id), req.purpose,
        # 구글 토큰은 탈퇴 시 연결 해제(revoke)용이라 반출 확인에는 보관하지 않는다.
        google_token=google_token if req.purpose == social_reauth_service.PURPOSE_ACCOUNT_DELETION else None,
    )
    return ReauthResponse(reauth_proof=proof, expires_in=social_reauth_service.PROOF_TTL_SECONDS)


@router.get("/me/consents")
async def get_my_consents(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    """설정 > 개인정보: 필수·선택 동의 현재 상태."""
    return privacy_consent_service.get_state(db, uuid.UUID(current_user["id"]))


@router.put("/me/consents")
async def update_my_consents(
    req: OptionalConsentUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """뇌파 수집·연구 활용 선택 동의 변경/철회. 저장에 실패하면 5xx 로 응답해 화면이 성공을 표시하지 않게 한다."""
    return privacy_consent_service.set_optional(db, uuid.UUID(current_user["id"]), eeg=req.eeg, research=req.research)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    req: DeleteAccountRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """본인 계정 즉시 탈퇴. 비밀번호 또는 5분 이내 소셜 재인증 proof 필요 — 실패는 401 REAUTH_REQUIRED(상태 변경 0)."""
    from app.api.v1.auth import _clear_refresh_cookie

    user = _load_user(db, current_user)
    google_token_enc: str | None = None
    if req.reauth_proof:
        record = await social_reauth_service.consume_proof(
            redis, req.reauth_proof, str(user.id), social_reauth_service.PURPOSE_ACCOUNT_DELETION
        )
        google_token_enc = record.get("google_token_enc")
    elif req.password:
        if not verify_password(req.password, user.password_hash):
            raise social_reauth_service.reauth_required()
    else:
        raise social_reauth_service.reauth_required()

    user_uuid = user.id
    account_deletion_service.delete_account(db, user_uuid, google_token_enc=google_token_enc)

    # 커밋 이후 best-effort — 실패해도 로컬 접근 차단은 유지된다.
    await _disconnect_live_sockets(str(user_uuid))
    try:
        await account_deletion_service.process_revoke_outbox(db, user_id=user_uuid)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[account-deletion] 즉시 소셜 연결 해제 시도 실패(재시도 큐에 남음): %s", type(exc).__name__)

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_refresh_cookie(response)
    return response


async def _disconnect_live_sockets(user_id: str) -> None:
    """이미 연결된 Socket.IO 세션을 끊는다(채팅 네임스페이스는 connect 시점에만 계정 상태를 확인한다)."""
    try:
        from app.ws import chat_namespace

        sids = [sid for sid, uid in list(getattr(chat_namespace, "_sid_users", {}).items()) if uid == user_id]
        for sid in sids:
            await chat_namespace.sio.disconnect(sid, namespace="/chat")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[account-deletion] 소켓 연결 해제 실패: %s", type(exc).__name__)


@public_router.post("/requests", status_code=status.HTTP_202_ACCEPTED)
async def public_deletion_request(
    request: Request,
    req: PublicDeletionRequest,
    db: Session = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    """공개 삭제 요청 접수 — 계정 존재 여부와 무관하게 202 {accepted:true}. 접수만으로 계정은 삭제되지 않는다."""
    ip = request.client.host if request.client else None
    await account_deletion_service.submit_public_request(db, redis, email=str(req.email), ip=ip)
    return {"accepted": True}


@router.get("/me/session-note-prompt", response_model=NotePromptSettingResponse)
def get_session_note_prompt_setting(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """SDD-237: 클래스 종료 후 진행 기록 안내 전체 켜짐/꺼짐(본인 계정)."""
    return {"enabled": class_summary_service.get_show_session_note_prompt(db, current_user["id"])}


@router.patch("/me/session-note-prompt", response_model=NotePromptSettingResponse)
def update_session_note_prompt_setting(
    body: NotePromptSettingUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """자동 승인·기존 기록에는 영향이 없다. 다시 켜면 아직 안내하지 않은 회차에만 적용된다."""
    return {"enabled": class_summary_service.set_show_session_note_prompt(db, current_user["id"], body.enabled)}
