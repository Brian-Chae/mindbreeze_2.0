"""기관 전용 공개 페이지 조회 로직

인증 없이 호출되는 경로이므로 개인정보를 응답에 담지 않도록 조회 단계에서부터 제한한다.
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.models.counselor_profile import CounselorProfile
from app.models.organization import Organization
from app.models.session import Session, SessionParticipant
from app.models.user import User
from app.services import code_service

# 공개 페이지에 노출하는 클래스 상태 — 완료/취소는 제외한다.
PUBLIC_CLASS_STATUSES = ("ready", "scheduled", "in_progress")


def _counselors(org_id: uuid.UUID, db: DBSession) -> tuple[list[dict], list[uuid.UUID]]:
    """기관 소속 활성 상담사 목록 + 전문분야. (공개 정보, 개인 식별 정보 제외)"""
    users = (
        db.query(User)
        .filter(
            User.org_id == org_id,
            User.role == "counselor",
            User.status == "active",
        )
        .order_by(User.name.asc())
        .all()
    )
    if not users:
        return [], []

    ids = [u.id for u in users]
    # 전문분야는 CounselorProfile에 있으며, 프로필 미작성 상담사는 빈 배열로 둔다.
    specialties_by_user = {
        p.user_id: list(p.specialties or [])
        for p in db.query(CounselorProfile).filter(CounselorProfile.user_id.in_(ids)).all()
    }

    counselors = [
        {
            "id": str(u.id),
            "name": u.name,
            "specialties": specialties_by_user.get(u.id, []),
        }
        for u in users
    ]
    return counselors, ids


def _classes(counselor_ids: list[uuid.UUID], db: DBSession) -> list[dict]:
    """소속 상담사가 진행하는 공개 클래스 목록 (완료·취소 제외)."""
    if not counselor_ids:
        return []

    sessions = (
        db.query(Session)
        .filter(
            Session.host_id.in_(counselor_ids),
            Session.status.in_(PUBLIC_CLASS_STATUSES),
        )
        .all()
    )
    if not sessions:
        return []

    # 참여자 수는 게스트(user_id=NULL) 포함 전체 행 수로 센다.
    session_ids = [s.id for s in sessions]
    counts: dict[uuid.UUID, int] = {}
    for p in (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id.in_(session_ids))
        .all()
    ):
        counts[p.session_id] = counts.get(p.session_id, 0) + 1

    # 진행중 → 대기 순, 그 안에서는 최근 생성 순으로 노출한다.
    def _sort_key(s: Session) -> tuple[int, str]:
        priority = 0 if s.status == "in_progress" else 1
        created = s.created_at.isoformat() if s.created_at else ""
        return (priority, created)

    return [
        {
            "id": str(s.id),
            "title": s.title,
            "type": s.type,
            "access_code": s.access_code,
            "status": s.status,
            "participant_mode": s.participant_mode,
            "started_at": s.started_at,
            "participant_count": counts.get(s.id, 0),
            "max_participants": s.max_participants,
        }
        for s in sorted(sessions, key=_sort_key)
    ]


def get_org_public_page(org_code: str, db: DBSession) -> dict:
    """기관 코드로 공개 페이지 데이터를 조회한다. 없으면 404."""
    normalized = code_service.normalize_code(org_code)
    if len(normalized) != code_service.CODE_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="기관을 찾을 수 없습니다"
        )

    org = db.query(Organization).filter(Organization.org_code == normalized).first()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="기관을 찾을 수 없습니다"
        )

    counselors, counselor_ids = _counselors(org.id, db)

    return {
        "org_id": str(org.id),
        "org_name": org.name,
        "org_code": org.org_code,
        # Organization에 소개글 필드가 없어 현재는 항상 None
        "intro": getattr(org, "intro", None) or getattr(org, "description", None),
        "counselors": counselors,
        "classes": _classes(counselor_ids, db),
    }
