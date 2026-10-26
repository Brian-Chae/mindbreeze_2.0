"""테스트 계정(counselor@test.com · client@test.com · orgadmin@test.com) 재시드 — SDD-214 Z 트랙 (초기화 직후 수동 실행).

비밀번호는 코드·문서·로그에 두지 않는다. 환경변수 TEST_ACCOUNTS_PASSWORD 로 받는 것을 권장한다
(--password 인자는 프로세스 목록·셸 이력에 남으므로 쓰지 말 것).

사용(backend/.env.dev 가 로드된 대상 환경에서):
  python scripts/seed_test_accounts.py  # TEST_ACCOUNTS_PASSWORD는 환경변수로 사전 주입

운영 보호: production/prod 환경은 거부하며, 원격 DB는 mindbreeze-dev RDS만 허용한다.
로컬 SQLite·PostgreSQL 테스트는 비운영 환경에서 허용한다. 우회 옵션은 없다.

멱등: 이미 있으면 비밀번호·상태만 현재 값으로 맞춘다. 메일 발송 없음(DB 직접 생성).
`e2e-smoke` 용 e2e 계정은 별도 스크립트 `scripts/e2e_seed.py seed` 가 만든다.
"""

import argparse
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.config import settings  # noqa: E402
from app.models.organization import Organization  # noqa: E402
from app.models.user_org_membership import UserOrgMembership  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models.client_counselor_link import ClientCounselorLink  # noqa: E402
from app.models.counselor_profile import CounselorProfile  # noqa: E402
from app.models.onboarding_progress import OnboardingProgress  # noqa: E402
from app.models.user import User  # noqa: E402

PASSWORD_ENV = "TEST_ACCOUNTS_PASSWORD"
COUNSELOR_EMAIL = "counselor@test.com"
CLIENT_EMAIL = "client@test.com"
ORGADMIN_EMAIL = "orgadmin@test.com"
COUNSELOR_CODE = "TST001"

# (역할, 이메일, 이름)
ACCOUNTS = [
    ("counselor", COUNSELOR_EMAIL, "테스트상담사"),
    ("client", CLIENT_EMAIL, "테스트내담자"),
    ("org_admin", ORGADMIN_EMAIL, "테스트기관관리자"),
]


def require_dev_database(environment: str, database_url: str) -> None:
    """접속 전에 환경과 실제 접속 대상을 검증한다. URL·시크릿은 출력하지 않는다."""
    error = "테스트 계정 시드는 dev RDS 또는 로컬 테스트 DB에서만 실행할 수 있습니다"
    if environment.strip().lower() in {"production", "prod"}:
        raise ValueError(error)
    try:
        url = make_url(database_url)
    except Exception:
        raise ValueError(error) from None
    # query의 host/hostaddr/service, SQLite uri 등 실제 접속 대상을 바꾸는 우회를 막는다.
    allowed_query = {"sslmode", "connect_timeout", "application_name"}
    if set(url.query) - allowed_query or (url.get_backend_name() == "sqlite" and url.query):
        raise ValueError(error)
    host = (url.host or "").lower()
    if url.get_backend_name() == "sqlite" and not host:
        return
    if url.get_backend_name() == "postgresql" and (
        host in {"localhost", "127.0.0.1", "::1"}
        or re.fullmatch(r"mindbreeze-dev\.[a-z0-9-]+\.[a-z0-9-]+\.rds\.amazonaws\.com", host)
    ):
        return
    raise ValueError(error)


def _link_organization(db: Session, counselor: User, admin: User) -> None:
    # SDD-079: membership이 소속의 진실 원천이다. 개인상담소(individual)는 공유 기관에서 제외한다.
    # 활성 일반 기관이 여러 개면 생성 시각·ID 순으로 고정하여 선택의 결정성을 보장한다.
    org = (db.query(Organization)
           .join(UserOrgMembership, UserOrgMembership.org_id == Organization.id)
           .filter(UserOrgMembership.user_id == counselor.id,
                   UserOrgMembership.status == "active",
                   Organization.kind == "institution", Organization.deactivated_at.is_(None))
           .order_by(Organization.created_at, Organization.id).first())
    if org is None:
        # 이름만 같은 타 기관은 재사용하지 않는다. 기존 데이터 변경 없이 전용 기관을 추가한다.
        org = Organization(name="테스트기관", kind="institution")
        db.add(org)
        db.flush()
    for user, role in ((counselor, "counselor"), (admin, "org_admin")):
        membership = db.query(UserOrgMembership).filter_by(
            user_id=user.id, org_id=org.id, status="active", role=role).first()
        if membership is None:
            if db.query(UserOrgMembership).filter(
                UserOrgMembership.user_id == user.id, UserOrgMembership.org_id == org.id,
                UserOrgMembership.status != "left").first():
                raise ValueError("테스트 계정의 기존 기관 역할·상태를 확인해야 합니다")
            has_primary = db.query(UserOrgMembership).filter_by(
                user_id=user.id, status="active", is_primary=True).first() is not None
            # 서비스는 개인상담소 주 소속까지 바꾸므로 추가 전용 시드에서는 직접 추가한다.
            primary = not has_primary and user.org_id is None
            db.add(UserOrgMembership(user_id=user.id, org_id=org.id, role=role,
                                    status="active", is_primary=primary,
                                    joined_at=datetime.now(timezone.utc)))
            if primary:
                user.org_id = org.id
    # 관리자 API의 org_id 미러도 일치해야 한다. 기존 관리자를 다른 기관으로 이동시키지 않는다.
    if admin.org_id != org.id:
        raise ValueError("테스트 기관관리자의 기존 주 소속을 확인해야 합니다")


def seed_test_accounts(db: Session, password: str) -> dict[str, int]:
    """세 계정·부속 행·기관 소속을 만든다. 커밋은 호출자가 한다."""
    require_dev_database(settings.environment, str(db.get_bind().url))
    created = updated = 0
    users: dict[str, User] = {}
    for role, email, name in ACCOUNTS:
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            user = User(
                id=uuid.uuid4(), email=email, password_hash=hash_password(password), name=name,
                role=role, status="active", verified_tier="email",
            )
            db.add(user)
            db.flush()
            created += 1
        else:
            if role == "org_admin" and user.role != role:
                raise ValueError("테스트 기관관리자의 기존 역할을 확인해야 합니다")
            user.password_hash = hash_password(password)
            user.status = "active"
            updated += 1
        users[role] = user
        if not db.query(OnboardingProgress).filter(OnboardingProgress.user_id == user.id).first():
            db.add(OnboardingProgress(
                user_id=user.id, current_step=1, completed=True,
                completed_at=datetime.now(timezone.utc), steps={},
            ))
    counselor, client = users["counselor"], users["client"]
    if not db.query(CounselorProfile).filter(CounselorProfile.user_id == counselor.id).first():
        db.add(CounselorProfile(user_id=counselor.id, counselor_code=COUNSELOR_CODE, specialties=[]))
    link = db.query(ClientCounselorLink).filter_by(client_id=client.id, counselor_id=counselor.id).first()
    if link is None:
        db.add(ClientCounselorLink(client_id=client.id, counselor_id=counselor.id, status="active"))
    else:
        link.status = "active"
    _link_organization(db, counselor, users["org_admin"])
    db.flush()
    return {"created": created, "updated": updated}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="테스트 계정 재시드")
    parser.add_argument("--password", help=f"비권장: 셸 이력에 남는다. 기본은 환경변수 {PASSWORD_ENV}")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    password = args.password or os.environ.get(PASSWORD_ENV)
    if not password:
        sys.exit(f"비밀번호가 필요합니다: 환경변수 {PASSWORD_ENV} (또는 --password)")
    try:
        require_dev_database(settings.environment, settings.database_url)
    except ValueError as exc:
        sys.exit(str(exc))
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        result = seed_test_accounts(db, password)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    print(f"seed 완료: 생성 {result['created']}, 갱신 {result['updated']}")


if __name__ == "__main__":
    main()
