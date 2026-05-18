"""F3 자격 증빙 서비스 — 업로드/목록/삭제/등급 재계산"""

from __future__ import annotations

import os
import uuid
from datetime import date, datetime
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.models.credential import Credential
from app.models.user import User

# 업로드 루트 — backend/uploads/
UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads"

# 허용 확장자 (MIME 보조 검증)
ALLOWED_EXTENSIONS = {"pdf", "jpg", "jpeg", "png"}
ALLOWED_MIME = {"application/pdf", "image/jpeg", "image/jpg", "image/png"}

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_CREDENTIALS_PER_USER = 10

VALID_TYPES = {"id_card", "license", "diploma", "career"}


def _ext_of(filename: str | None) -> str:
    """파일명에서 소문자 확장자 추출."""
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def upload_credential(
    user_id: uuid.UUID,
    file: UploadFile,
    cred_type: str,
    expires_at: str | None,
    db: Session,
) -> Credential:
    """증빙 파일 업로드 + Credential 레코드 생성."""

    if cred_type not in VALID_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="지원하지 않는 증빙 유형입니다",
        )

    ext = _ext_of(file.filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="PDF, JPG, PNG 파일만 업로드 가능합니다",
        )
    if file.content_type and file.content_type not in ALLOWED_MIME:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="PDF, JPG, PNG 파일만 업로드 가능합니다",
        )

    # 파일 크기 검증 — UploadFile.file은 SpooledTemporaryFile
    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="파일 크기는 10MB 이하여야 합니다",
        )

    # 개수 제한 검증
    user_creds = db.query(Credential).filter(Credential.user_id == user_id).all()
    if len(user_creds) >= MAX_CREDENTIALS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="최대 10개까지 업로드 가능합니다",
        )

    # id_card 중복 검증
    if cred_type == "id_card" and any(c.type == "id_card" for c in user_creds):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="신분증은 1개만 등록 가능합니다",
        )

    # expires_at 파싱
    expires_date: date | None = None
    if expires_at:
        try:
            expires_date = date.fromisoformat(expires_at)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="만료일 형식이 올바르지 않습니다 (YYYY-MM-DD)",
            )

    # 파일 저장 — uploads/{user_id}/{uuid}.{ext}
    user_dir = UPLOAD_ROOT / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    file_uuid = uuid.uuid4()
    local_path = user_dir / f"{file_uuid}.{ext}"
    with open(local_path, "wb") as f:
        f.write(file.file.read())

    credential = Credential(
        user_id=user_id,
        type=cred_type,
        s3_key=str(local_path),
        file_name=file.filename,
        status="pending",
        expires_at=expires_date,
    )
    db.add(credential)
    db.commit()
    db.refresh(credential)
    return credential


def list_credentials(user_id: uuid.UUID, db: Session) -> list[Credential]:
    """사용자 본인의 증빙 목록 조회."""
    return (
        db.query(Credential)
        .filter(Credential.user_id == user_id)
        .order_by(Credential.created_at.asc())
        .all()
    )


def delete_credential(credential_id: uuid.UUID, user_id: uuid.UUID, db: Session) -> None:
    """pending 상태 증빙 삭제 + 파일 제거."""
    cred = (
        db.query(Credential)
        .filter(Credential.id == credential_id, Credential.user_id == user_id)
        .first()
    )
    if cred is None:
        raise HTTPException(status_code=404, detail="증빙을 찾을 수 없습니다")
    if cred.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="검토 중인 증빙만 삭제할 수 있습니다",
        )

    # 로컬 파일 삭제 (실패해도 DB 삭제는 진행)
    try:
        if cred.s3_key and os.path.exists(cred.s3_key):
            os.remove(cred.s3_key)
    except OSError:
        pass

    db.delete(cred)
    db.commit()


def recalculate_tier(user_id: uuid.UUID, db: Session) -> str:
    """승인된 증빙 기반으로 verified_tier 재산정."""
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        return "unverified"

    approved = (
        db.query(Credential)
        .filter(Credential.user_id == user_id, Credential.status == "approved")
        .all()
    )
    has_id_card = any(c.type == "id_card" for c in approved)
    has_qualification = any(c.type in ("license", "diploma", "career") for c in approved)

    if has_id_card and has_qualification:
        user.verified_tier = "verified"
        db.add(user)
        db.commit()

    return user.verified_tier


def missing_credentials(user_id: uuid.UUID, db: Session) -> list[str]:
    """부족한 증빙 안내 메시지 생성."""
    approved = (
        db.query(Credential)
        .filter(Credential.user_id == user_id, Credential.status == "approved")
        .all()
    )
    has_id_card = any(c.type == "id_card" for c in approved)
    has_qualification = any(c.type in ("license", "diploma", "career") for c in approved)

    msgs: list[str] = []
    if not has_id_card:
        msgs.append("신분증을 업로드해주세요")
    if not has_qualification:
        msgs.append("자격증/학위/경력 증빙 중 1건 이상을 업로드해주세요")
    return msgs


def admin_verify(
    credential_id: uuid.UUID,
    new_status: str,
    reason: str | None,
    db: Session,
) -> Credential:
    """관리자 승인/반려 처리."""
    if new_status not in ("approved", "rejected"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="status는 approved 또는 rejected 여야 합니다",
        )
    cred = db.query(Credential).filter(Credential.id == credential_id).first()
    if cred is None:
        raise HTTPException(status_code=404, detail="증빙을 찾을 수 없습니다")
    cred.status = new_status
    cred.ai_verdict = {"reason": reason} if reason else None
    db.add(cred)
    db.commit()
    db.refresh(cred)

    if new_status == "approved":
        recalculate_tier(cred.user_id, db)

    return cred
