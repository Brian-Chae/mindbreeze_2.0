"""어드민 검토 큐 + 사용자 관리 서비스"""

from __future__ import annotations

import secrets
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.client_counselor_link import ClientCounselorLink
from app.models.client_profile import ClientProfile
from app.models.credential import Credential, VerificationAudit
from app.models.org_document import OrgDocument
from app.models.organization import Organization
from app.models.user import User

VALID_ACTIONS = {"approve", "reject", "request_more"}
REVIEW_STATUSES = {"pending", "needs_review"}
# SDD-020: list_users 에서 허용하는 role 화이트리스트. 이외 값은 422 로 거부한다.
ALLOWED_USER_ROLES = {"platform_admin", "org_admin", "counselor", "client"}


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


def _primary_counselor_summary(client_id: uuid.UUID, db: Session) -> dict[str, Any] | None:
    """내담자의 대표(첫 active) 담당 상담사 요약을 반환한다 (없으면 None).

    ClientCounselorLink 는 다중 상담사 연결을 허용하지만, 회원 관리 목록에서는
    가장 먼저 연결된 active 링크의 상담사 1명만 노출한다.
    """
    link = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == client_id,
            ClientCounselorLink.status == "active",
        )
        .order_by(ClientCounselorLink.matched_at.asc())
        .first()
    )
    if link is None:
        return None
    counselor = db.query(User).filter(User.id == link.counselor_id).first()
    if counselor is None:
        return None
    return {
        "id": str(counselor.id),
        "name": counselor.name,
        "email": counselor.email,
    }


def list_users(
    db: Session,
    role: str | None = None,
    q: str | None = None,
    page: int = 1,
    size: int = 20,
) -> dict[str, Any]:
    # SDD-020: role 은 화이트리스트로만 수용한다. 임의 문자열이 오면 빈 결과가 아니라 422.
    if role is not None and role not in ALLOWED_USER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="유효하지 않은 role 입니다",
        )

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
                "phone": u.phone,
                "role": u.role,
                "status": u.status,
                "suspended": u.status == "suspended",
                "verified_tier": u.verified_tier,
                # 회원 관리 화면의 핵심 요구사항 — 담당 상담사 표시 (client 만 조회)
                "primary_counselor": (
                    _primary_counselor_summary(u.id, db) if u.role == "client" else None
                ),
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in rows
        ],
        "total": total,
        "page": page,
        "size": size,
    }


def create_client(
    name: str,
    email: str,
    counselor_id: str,
    db: Session,
    *,
    phone: str | None = None,
) -> User:
    """플랫폼 관리자 회원(내담자) 수동 추가 (SDD-020).

    이름/이메일/담당 상담사로 pending 내담자 계정을 만들고 담당 상담사에 연결한다.
    비밀번호는 난수로 설정되므로 내담자는 초대 메일(/set-password)로만 계정을
    활성화할 수 있다. consents 는 만들지 않고 내담자 본인 온보딩에서 수집한다.

    반환된 User 를 endpoint 에서 초대 메일 발송(org_invite_service.issue_client_invite)에
    사용한다.

    실패 조건:
        - 이메일 형식/중복 → 409
        - counselor_id 형식 오류 → 422
        - 상담사 미존재 → 404
        - role != counselor 또는 status != active → 422
    """
    # 1. 이메일 정규화 — org 초대와 동일하게 strip().lower()
    normalized_email = (email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="이메일은 필수입니다"
        )
    clean_name = (name or "").strip()
    if not clean_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="이름은 필수입니다"
        )

    # 2. 이메일 중복 검사
    existing = db.query(User).filter(User.email == normalized_email).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="이미 등록된 이메일입니다"
        )

    # 3. 담당 상담사 검증 — 존재 + role=counselor + status=active
    try:
        counselor_uuid = uuid.UUID(str(counselor_id))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="상담사 ID 형식이 올바르지 않습니다"
        )
    counselor = db.query(User).filter(User.id == counselor_uuid).first()
    if counselor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="상담사를 찾을 수 없습니다")
    if counselor.role != "counselor":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="지정한 사용자는 상담사가 아닙니다"
        )
    if counselor.status != "active":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="활성 상태(인증 완료)의 상담사에게만 회원을 배정할 수 있습니다",
        )

    # 4. pending 내담자 계정 생성 — 비밀번호는 난수(초대 메일로만 활성화)
    client = User(
        email=normalized_email,
        password_hash=hash_password(secrets.token_urlsafe(32)),
        name=clean_name,
        role="client",
        status="pending",
        verified_tier="unverified",
        auth_provider="email",
        phone=(phone or "").strip() or None,
    )
    db.add(client)
    db.flush()

    # 5. 빈 ClientProfile 생성 (목록/상세 조인 분기 최소화)
    db.add(ClientProfile(user_id=client.id, concerns=[], interests=[]))
    db.flush()

    # 6. 담당 상담사 연결 + 1:1 채팅방 생성 (공용 함수). 내부에서 commit 된다.
    from app.services import client_service

    client_service.assign_counselor(client.id, counselor.id, db, create_room=True)

    db.refresh(client)
    return client


def serialize_client_detail(user: User, db: Session) -> dict[str, Any]:
    """수동 추가된 내담자 응답 직렬화 — active 담당 상담사 목록 포함."""
    links = (
        db.query(ClientCounselorLink)
        .filter(
            ClientCounselorLink.client_id == user.id,
            ClientCounselorLink.status == "active",
        )
        .order_by(ClientCounselorLink.matched_at.asc())
        .all()
    )
    counselors: list[dict[str, Any]] = []
    for link in links:
        counselor = db.query(User).filter(User.id == link.counselor_id).first()
        if counselor is None:
            continue
        counselors.append(
            {
                "id": str(counselor.id),
                "name": counselor.name,
                "email": counselor.email,
                "status": link.status,
            }
        )
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "phone": user.phone,
        "role": user.role,
        "status": user.status,
        "verified_tier": user.verified_tier,
        "counselors": counselors,
        "created_at": user.created_at.isoformat() if user.created_at else None,
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


def delete_user(user_id: uuid.UUID, admin_id: uuid.UUID, db: Session) -> dict[str, Any]:
    """사용자 계정을 영구 삭제한다 (플랫폼 관리자 전용).

    users.id 를 참조하는 모든 FK 자식 레코드를 먼저 삭제한 뒤 사용자를 삭제한다.
    ORM cascade 가 없는 관계(client_counselor_links, credentials, sessions 등)까지
    명시적으로 정리해 FK 제약 위반을 방지한다.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if user.role == "platform_admin":
        raise HTTPException(status_code=403, detail="플랫폼 관리자는 삭제할 수 없습니다")

    uid = str(user_id)

    # 1. 기관의 primary_admin_id 참조 해제 (SET NULL)
    db.execute(
        text("UPDATE organizations SET primary_admin_id = NULL WHERE primary_admin_id = :id"),
        {"id": uid},
    )

    # 2. users.id 를 참조하는 자식 테이블 정리
    child_tables: list[tuple[str, list[str]]] = [
        ("client_counselor_links", ["client_id", "counselor_id"]),
        ("client_invites", ["counselor_id"]),
        ("chat_message_reads", ["user_id"]),
        ("chat_messages", ["sender_id"]),
        ("chat_room_participants", ["user_id"]),
        ("chat_rooms", ["host_id"]),
        ("credentials", ["user_id"]),
        ("eeg_records", ["user_id"]),
        ("notifications", ["user_id"]),
        ("org_join_requests", ["user_id"]),
        ("reports", ["user_id"]),
        ("session_participants", ["user_id"]),
        ("sessions", ["host_id"]),
        ("verification_audits", ["admin_id"]),
        ("consents", ["user_id"]),
        ("refresh_tokens", ["user_id"]),
        ("password_history", ["user_id"]),
        ("onboarding_progress", ["user_id"]),
        ("counselor_profiles", ["user_id"]),
        ("client_profiles", ["user_id"]),
        ("qualifications", ["user_id"]),
        ("careers", ["user_id"]),
    ]
    for table, cols in child_tables:
        for col in cols:
            db.execute(text(f"DELETE FROM {table} WHERE {col} = :id"), {"id": uid})

    # 3. 사용자 삭제
    db.delete(user)
    db.commit()
    return {"id": uid, "deleted": True}
