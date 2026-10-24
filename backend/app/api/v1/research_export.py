"""연구 DB 내보내기 — Spark pull 용 서비스 토큰 API (SDD-209 B13 / BE-R3).

사용자 JWT 가 아니라 서버 .env 의 서비스 토큰(``RESEARCH_EXPORT_ACK_TOKEN``)으로만 접근한다. 토큰이 비어 있으면 503.
Spark 는 목록으로 적재할 배치를 찾아 스테이징 prefix 에서 pull 한 뒤 ack 로 회신한다(운영→Spark push 없음).
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBSession

from app.core.database import get_db
from app.services import research_export_service

router = APIRouter(prefix="/research-export", tags=["research-export"])


class AckRequest(BaseModel):
    batch_id: str
    sha256: str = Field(min_length=64, max_length=64)


@router.get("/batches")
def list_batches(
    x_research_export_token: str | None = Header(default=None),
    db: DBSession = Depends(get_db),
):
    """ack 대기 중(uploaded) 배치 목록 — manifest 키·sha256 포함."""
    research_export_service.verify_service_token(x_research_export_token)
    return {"batches": research_export_service.list_uploaded_batches(db)}


@router.post("/ack")
def ack(
    payload: AckRequest,
    x_research_export_token: str | None = Header(default=None),
    db: DBSession = Depends(get_db),
):
    """적재 완료 회신 — batch_id·manifest sha256 일치 시 연구 동의 건의 export_state 를 acked 로 전이(멱등)."""
    research_export_service.verify_service_token(x_research_export_token)
    return research_export_service.ack_batch(db, payload.batch_id, payload.sha256)


class SignalScope(BaseModel):
    signal: str = Field(pattern='^(eeg|ppg|acc)$')
    artifact_kind: str
    manifest_revision: int = Field(gt=0)
    manifest_sha256: str = Field(pattern='^[0-9a-f]{64}$')


class SignalAckRequest(AckRequest):
    signal_scope: list[SignalScope] = Field(min_length=1, max_length=30)


class SignalBuildRequest(BaseModel):
    session_id: UUID
    participant_id: UUID
    revision: int = Field(gt=0)
    receiver_versions: list[str] = Field(default_factory=list, max_length=10)


@router.get('/v3/batches')
def signal_batches(receiver_version: str = '', x_research_export_token: str | None = Header(default=None), db: DBSession = Depends(get_db)):
    research_export_service.verify_service_token(x_research_export_token)
    return {'batches':research_export_service.list_signal_batches(db,[receiver_version])}


@router.post('/v3/build')
def signal_build(payload: SignalBuildRequest, x_research_export_token: str | None = Header(default=None), db: DBSession = Depends(get_db)):
    research_export_service.verify_service_token(x_research_export_token)
    return research_export_service.export_signal_revision(db,payload.session_id,payload.participant_id,payload.revision,receiver_versions=payload.receiver_versions)


@router.post('/v3/ack')
def signal_ack(payload: SignalAckRequest, x_research_export_token: str | None = Header(default=None), db: DBSession = Depends(get_db)):
    research_export_service.verify_service_token(x_research_export_token)
    return research_export_service.ack_signal_batch(db,payload.batch_id,payload.sha256,[s.model_dump() for s in payload.signal_scope])
