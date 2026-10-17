"""SDD-204 E2E 전용 기관·계정 생성/정리 스크립트 (pytest 대상 아님).

dev 서버에서만 실행한다. 모든 데이터 이름 앞에 'E2E-'(이메일은 'e2e-')를 붙여 기존 테스트 데이터와 구분한다.
- 멱등: 여러 번 실행해도 중복 생성하지 않는다.
- 메일 발송 없음(DB 직접 생성).

실행(서버, backend/.env.dev 로드된 환경):
  E2E_PASSWORD='...' python scripts/e2e_seed.py seed
  python scripts/e2e_seed.py cleanup
  python scripts/e2e_seed.py status
"""
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models.client_counselor_link import ClientCounselorLink  # noqa: E402
from app.models.counselor_profile import CounselorProfile  # noqa: E402
from app.models.onboarding_progress import OnboardingProgress  # noqa: E402
from app.models.organization import Organization  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.user_org_membership import UserOrgMembership  # noqa: E402

DOMAIN = "e2e.looxidlabs.com"
ORG_NAME = "E2E-테스트기관"
ORG_CODE = "E2E001"
COUNSELOR_CODE = "E2E0C1"

# (역할, 이메일, 이름)
ACCOUNTS = [
    ("client", f"e2e-client@{DOMAIN}", "E2E-내담자"),
    ("counselor", f"e2e-counselor@{DOMAIN}", "E2E-상담사"),
    ("org_admin", f"e2e-orgadmin@{DOMAIN}", "E2E-기관관리자"),
    ("platform_admin", f"e2e-admin@{DOMAIN}", "E2E-플랫폼관리자"),
]


def _org(db) -> Organization:
    org = db.query(Organization).filter(Organization.org_code == ORG_CODE).first()
    if org is None:
        org = Organization(
            id=uuid.uuid4(),
            name=ORG_NAME,
            org_code=ORG_CODE,
            verified=True,
            verified_at=datetime.now(timezone.utc),
        )
        db.add(org)
        db.flush()
    return org


def seed() -> None:
    password = os.environ.get("E2E_PASSWORD")
    if not password:
        sys.exit("E2E_PASSWORD 환경변수가 필요합니다.")
    db = SessionLocal()
    try:
        org = _org(db)
        for role, email, name in ACCOUNTS:
            user = db.query(User).filter(User.email == email).first()
            if user is None:
                user = User(
                    id=uuid.uuid4(),
                    email=email,
                    password_hash=hash_password(password),
                    name=name,
                    role=role,
                    status="active",
                    org_id=None if role in ("client", "platform_admin") else org.id,
                )
                db.add(user)
                db.flush()
            else:
                # 비밀번호는 항상 현재 값으로 동기화(회전 대응)
                user.password_hash = hash_password(password)
                user.status = "active"
            if role == "org_admin":
                org.primary_admin_id = user.id
            if role == "counselor" and not user.counselor_profile:
                db.add(CounselorProfile(user_id=user.id, counselor_code=COUNSELOR_CODE, specialties=[]))
            if role in ("client", "counselor", "org_admin") and not user.onboarding_progress:
                db.add(
                    OnboardingProgress(
                        user_id=user.id, current_step=1, completed=True,
                        completed_at=datetime.now(timezone.utc), steps={},
                    )
                )
        # 기관 소속(membership): 상담사·기관관리자
        for role, email, _ in ACCOUNTS:
            if role not in ("counselor", "org_admin"):
                continue
            u = db.query(User).filter(User.email == email).first()
            m = db.query(UserOrgMembership).filter_by(user_id=u.id, org_id=org.id).first()
            if m is None:
                db.add(UserOrgMembership(user_id=u.id, org_id=org.id, role=role, status="active",
                                         is_primary=True, joined_at=datetime.now(timezone.utc)))
            else:
                m.status = "active"
        # 내담자-상담사 연결(내담자 앱이 '연결하기' 게이트를 통과하도록)
        client = db.query(User).filter(User.email == f"e2e-client@{DOMAIN}").first()
        counselor = db.query(User).filter(User.email == f"e2e-counselor@{DOMAIN}").first()
        link = db.query(ClientCounselorLink).filter_by(client_id=client.id, counselor_id=counselor.id).first()
        if link is None:
            db.add(ClientCounselorLink(client_id=client.id, counselor_id=counselor.id, status="active"))
        else:
            link.status = "active"
        db.commit()
        print(f"seed 완료: 기관 1 + 계정 {len(ACCOUNTS)}")
    finally:
        db.close()


_FK_SQL = text("""
SELECT c.conrelid::regclass::text AS child, a.attname AS col,
       (SELECT a2.attname FROM pg_index i JOIN pg_attribute a2
          ON a2.attrelid = i.indrelid AND a2.attnum = ANY(i.indkey)
         WHERE i.indrelid = c.conrelid AND i.indisprimary LIMIT 1) AS pk
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f' AND c.confrelid = CAST(:parent AS regclass)
""")


def _purge(db, table: str, ids: list, seen: set, pkcol: str = "id") -> None:
    """table 의 ids 행과, 이를 FK 로 참조하는 모든 하위 행을 재귀 삭제한다(순환 FK 는 seen 으로 차단)."""
    ids = [i for i in ids if (table, i) not in seen]
    if not ids:
        return
    seen.update((table, i) for i in ids)
    for child, col, pk in db.execute(_FK_SQL, {"parent": table}).all():
        if pk is None:
            db.execute(text(f'DELETE FROM {child} WHERE "{col}" = ANY(:ids)'), {"ids": ids})
            continue
        rows = db.execute(text(f'SELECT "{pk}" FROM {child} WHERE "{col}" = ANY(:ids)'), {"ids": ids}).all()
        _purge(db, child, [r[0] for r in rows], seen, pk)
    db.execute(text(f'DELETE FROM {table} WHERE "{pkcol}" = ANY(:ids)'), {"ids": ids})


def cleanup() -> None:
    """E2E 전용 계정·기관만 삭제한다(e2e- 접두어 이메일, org_code=E2E001 기관). 의존 행도 함께 정리."""
    db = SessionLocal()
    try:
        db.execute(text("UPDATE organizations SET primary_admin_id = NULL, owner_user_id = NULL "
                        "WHERE org_code = :c"), {"c": ORG_CODE})
        uids = [r[0] for r in db.execute(text("SELECT id FROM users WHERE email LIKE 'e2e-%@e2e.%'")).all()]
        seen: set = set()
        _purge(db, "users", uids, seen)
        oids = [r[0] for r in db.execute(text("SELECT id FROM organizations WHERE org_code = :c AND name LIKE 'E2E-%'"),
                                         {"c": ORG_CODE}).all()]
        _purge(db, "organizations", oids, seen)
        db.commit()
        print(f"cleanup 완료: 계정 {len(uids)}, 기관 {len(oids)} 삭제")
    finally:
        db.close()


def status() -> None:
    db = SessionLocal()
    try:
        n = db.query(User).filter(User.email.like(f"%@{DOMAIN}")).count()
        o = db.query(Organization).filter(Organization.org_code == ORG_CODE).count()
        print(f"E2E 계정 {n}, 기관 {o}")
    finally:
        db.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    {"seed": seed, "cleanup": cleanup, "status": status}.get(cmd, lambda: sys.exit(__doc__))()
