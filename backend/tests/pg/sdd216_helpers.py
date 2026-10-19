"""SDD-216 PG 합성 계정·기관. 실제 데이터/자격증명 없음."""

from uuid import uuid4
from app.models.organization import Organization
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.models.class_program import Class, ClassInstructor


def user(db, org=None, role="counselor"):
    row = User(
        email=f"{uuid4()}@example.com",
        password_hash="x",
        name="합성 사용자",
        role=role,
        status="active",
        org_id=org.id if org else None,
    )
    db.add(row)
    db.flush()
    if org:
        db.add(
            UserOrgMembership(
                user_id=row.id,
                org_id=org.id,
                role=role,
                status="active",
                is_primary=True,
            )
        )
        db.flush()
    return row


def world(db):
    org = Organization(name="합성 센터", verified=True)
    db.add(org)
    db.flush()
    a, b = user(db, org), user(db, org)
    parent = Class(
        created_by=a.id,
        organization_id=org.id,
        organization_attribution_known=True,
        title="합성 명상",
        default_duration_min=60,
    )
    db.add(parent)
    db.flush()
    db.add(ClassInstructor(class_id=parent.id, user_id=a.id, role="lead"))
    db.flush()
    return org, a, b, parent
