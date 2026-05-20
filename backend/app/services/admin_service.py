"""어드민 검토 큐 + 사용자 관리 서비스"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.credential import Credential, VerificationAudit
from app.models.org_document import OrgDocument
from app.models.organization import Organization
from app.models.user import User

VALID_ACTIONS = {"approve", "reject", "request_more"}
REVIEW_STATUSES = {"pending", "needs_review"}


def _risk_score(verdict: dict | None) -> float:
    if not verdict or not isinstance(verdict, dict):
        return 0.0
    v = verdict.get("risk_score")
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _credential_card(cred: Credential, db: Session) -> dict[str, Any]:
    user = db.query(User).filter(User.id == cred.user_id).first()
    return {
        "target_type": "credential",
        "id": str(cred.id),
        "document_type": cred.type,
        "status": cred.status,
        "submitter_name": user.name if user else None,
        "submitter_email": user.email if user else None,
        "risk_score": _risk_score(cred.ai_verdict),
        "ai_verdict": cred.ai_verdict,
        "file_name": cred.file_name,
        "created_at": cred.created_at.isoformat() if cred.created_at else None,
    }


def _org_document_card(doc: OrgDocument, db: Session) -> dict[str, Any]:
    org = db.query(Organization).filter(Organization.id == doc.org_id).first()
    return {
        "target_type": "org_document",
        "id": str(doc.id),
        "document_type": doc.type,
        "status": doc.status,
        "submitter_name": org.name if org else None,
        "submitter_email": None,
        "risk_score": _risk_score(doc.ai_verdict),
        "ai_verdict": doc.ai_verdict,
        "file_name": doc.file_name,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


def _risk_level(score: float) -> str:
    if score >= 0.7:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


def get_review_queue(
    db: Session,
    document_type: str | None = None,
    risk_level: str | None = None,
    page: int = 1,
    size: int = 20,
) -> dict[str, Any]:
    cred_q = db.query(Credential).filter(Credential.status.in_(list(REVIEW_STATUSES)))
    doc_q = db.query(OrgDocument).filter(OrgDocument.status.in_(list(REVIEW_STATUSES)))

    if document_type:
        cred_q = cred_q.filter(Credential.type == document_type)
        doc_q = doc_q.filter(OrgDocument.type == document_type)

    cards: list[dict[str, Any]] = []
    for c in cred_q.all():
        cards.append(_credential_card(c, db))
    for d in doc_q.all():
        cards.append(_org_document_card(d, db))

    if risk_level:
        cards = [c for c in cards if _risk_level(c["risk_score"]) == risk_level]

    cards.sort(key=lambda x: (-x["risk_score"], x["created_at"] or ""))

    total = len(cards)
    start = (page - 1) * size
    end = start + size
    return {"items": cards[start:end], "total": total, "page": page, "size": size}


def get_credential_review_detail(credential_id: uuid.UUID, db: Session) -> dict[str, Any]:
    cred = db.query(Credential).filter(Credential.id == credential_id).first()
    if cred is None:
        raise HTTPException(status_code=404, detail="증빙을 찾을 수 없습니다")
    user = db.query(User).filter(User.id == cred.user_id).first()
    audits = (
        db.query(VerificationAudit)
        .filter(
            (VerificationAudit.credential_id == cred.id)
            | ((VerificationAudit.target_type == "credential") & (VerificationAudit.target_id == cred.id))
        )
        .order_by(VerificationAudit.created_at.desc())
        .all()
    )
    return {
        "target_type": "credential",
        "id": str(cred.id),
        "document_type": cred.type,
        "status": cred.status,
        "file_name": cred.file_name,
        "s3_key": cred.s3_key,
        "submitter": {
            "id": str(user.id) if user else None,
            "name": user.name if user else None,
            "email": user.email if user else None,
            "role": user.role if user else None,
        },
        "ai_verdict": cred.ai_verdict,
        "risk_score": _risk_score(cred.ai_verdict),
        "risk_level": _risk_level(_risk_score(cred.ai_verdict)),
        "created_at": cred.created_at.isoformat() if cred.created_at else None,
        "audits": [
            {
                "id": str(a.id),
                "action": a.action,
                "reason": a.reason,
                "admin_id": str(a.admin_id) if a.admin_id else None,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in audits
        ],
    }


def get_org_document_review_detail(doc_id: uuid.UUID, db: Session) -> dict[str, Any]:
    doc = db.query(OrgDocument).filter(OrgDocument.id == doc_id).first()
    if doc is None:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다")
    org = db.query(Organization).filter(Organization.id == doc.org_id).first()
    audits = (
        db.query(VerificationAudit)
        .filter(VerificationAudit.target_type == "org_document", VerificationAudit.target_id == doc.id)
        .order_by(VerificationAudit.created_at.desc())
        .all()
    )
    return {
        "target_type": "org_document",
        "id": str(doc.id),
        "document_type": doc.type,
        "status": doc.status,
        "file_name": doc.file_name,
        "s3_key": doc.s3_key,
        "org": {
            "id": str(org.id) if org else None,
            "name": org.name if org else None,
            "biz_number": org.biz_number if org else None,
        },
        "ai_verdict": doc.ai_verdict,
        "risk_score": _risk_score(doc.ai_verdict),
        "risk_level": _risk_level(_risk_score(doc.ai_verdict)),
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "audits": [
            {
                "id": str(a.id),
                "action": a.action,
                "reason": a.reason,
                "admin_id": str(a.admin_id) if a.admin_id else None,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in audits
        ],
    }


def _action_to_status(action: str) -> str:
    return {
        "approve": "approved",
        "reject": "rejected",
        "request_more": "needs_review",
    }[action]


def process_review(
    target_type: str,
    target_id: uuid.UUID,
    action: str,
    reason: str | None,
    admin_id: uuid.UUID,
    db: Session,
) -> dict[str, Any]:
    if action not in VALID_ACTIONS:
        raise HTTPException(status_code=422, detail="잘못된 action 입니다")
    if target_type not in ("credential", "org_document"):
        raise HTTPException(status_code=422, detail="잘못된 target_type 입니다")

    new_status = _action_to_status(action)
    snapshot: dict[str, Any] | None = None

    if target_type == "credential":
        cred = db.query(Credential).filter(Credential.id == target_id).first()
        if cred is None:
            raise HTTPException(status_code=404, detail="증빙을 찾을 수 없습니다")
        snapshot = cred.ai_verdict if isinstance(cred.ai_verdict, dict) else None
        cred.status = new_status
        db.add(cred)
        audit = VerificationAudit(
            credential_id=cred.id,
            target_type="credential",
            target_id=cred.id,
            admin_id=admin_id,
            action=action,
            reason=reason,
            extra={"ai_verdict_snapshot": snapshot} if snapshot else None,
        )
        db.add(audit)
        db.commit()
        db.refresh(cred)
        if action == "approve":
            from app.services import credential_service
            credential_service.recalculate_tier(cred.user_id, db)
        return {"target_type": "credential", "id": str(cred.id), "status": cred.status, "action": action}

    doc = db.query(OrgDocument).filter(OrgDocument.id == target_id).first()
    if doc is None:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다")
    snapshot = doc.ai_verdict if isinstance(doc.ai_verdict, dict) else None
    doc.status = new_status
    db.add(doc)
    audit = VerificationAudit(
        credential_id=None,
        target_type="org_document",
        target_id=doc.id,
        admin_id=admin_id,
        action=action,
        reason=reason,
        extra={"ai_verdict_snapshot": snapshot} if snapshot else None,
    )
    db.add(audit)
    db.commit()
    db.refresh(doc)
    return {"target_type": "org_document", "id": str(doc.id), "status": doc.status, "action": action}


def batch_process_review(
    items: list[dict[str, Any]],
    admin_id: uuid.UUID,
    db: Session,
) -> dict[str, Any]:
    if not items:
        raise HTTPException(status_code=422, detail="처리할 항목이 없습니다")
    if len(items) > 50:
        raise HTTPException(status_code=422, detail="한 번에 최대 50건까지 처리할 수 있습니다")

    results: list[dict[str, Any]] = []
    for item in items:
        try:
            tt = item.get("target_type")
            tid = uuid.UUID(item["target_id"])
            act = item.get("action")
            if not isinstance(tt, str) or not isinstance(act, str):
                raise ValueError("invalid")
            r = process_review(tt, tid, act, item.get("reason"), admin_id, db)
            results.append({"ok": True, **r})
        except HTTPException as e:
            results.append({"ok": False, "target_id": item.get("target_id"), "error": e.detail})
        except (ValueError, KeyError):
            results.append({"ok": False, "target_id": item.get("target_id"), "error": "invalid item"})
    return {"results": results, "total": len(results)}


def list_users(
    db: Session,
    role: str | None = None,
    q: str | None = None,
    page: int = 1,
    size: int = 20,
) -> dict[str, Any]:
    query = db.query(User)
    if role:
        query = query.filter(User.role == role)
    if q:
        like = f"%{q}%"
        query = query.filter((User.email.ilike(like)) | (User.name.ilike(like)))
    total = query.count()
    rows = (
        query.order_by(User.created_at.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )
    return {
        "items": [
            {
                "id": str(u.id),
                "email": u.email,
                "name": u.name,
                "role": u.role,
                "status": u.status,
                "verified_tier": u.verified_tier,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in rows
        ],
        "total": total,
        "page": page,
        "size": size,
    }


def suspend_user(user_id: uuid.UUID, reason: str, admin_id: uuid.UUID, db: Session) -> dict[str, Any]:
    if not reason or not reason.strip():
        raise HTTPException(status_code=422, detail="정지 사유는 필수입니다")
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if user.role == "platform_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="플랫폼 관리자는 정지할 수 없습니다")
    user.status = "suspended"
    db.add(user)
    db.add(VerificationAudit(
        target_type="user",
        target_id=user.id,
        admin_id=admin_id,
        action="suspend",
        reason=reason,
    ))
    db.commit()
    return {"id": str(user.id), "status": user.status}


def unsuspend_user(user_id: uuid.UUID, admin_id: uuid.UUID, db: Session) -> dict[str, Any]:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    user.status = "active"
    db.add(user)
    db.add(VerificationAudit(
        target_type="user",
        target_id=user.id,
        admin_id=admin_id,
        action="unsuspend",
        reason=None,
    ))
    db.commit()
    return {"id": str(user.id), "status": user.status}
