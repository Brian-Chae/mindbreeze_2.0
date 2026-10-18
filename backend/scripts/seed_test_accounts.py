"""테스트 계정(counselor@test.com · client@test.com) 재시드 — SDD-214 Z 트랙 (초기화 직후 수동 실행).

비밀번호는 코드·문서·로그에 두지 않는다. 환경변수 TEST_ACCOUNTS_PASSWORD 로 받는 것을 권장한다
(--password 인자는 프로세스 목록·셸 이력에 남으므로 쓰지 말 것).

사용(backend/.env.dev 가 로드된 대상 환경에서):
  TEST_ACCOUNTS_PASSWORD='...' python scripts/seed_test_accounts.py

멱등: 이미 있으면 비밀번호·상태만 현재 값으로 맞춘다. 메일 발송 없음(DB 직접 생성).
`e2e-smoke` 용 e2e 계정은 별도 스크립트 `scripts/e2e_seed.py seed` 가 만든다.
"""

import argparse
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.orm import Session  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.models.client_counselor_link import ClientCounselorLink  # noqa: E402
from app.models.counselor_profile import CounselorProfile  # noqa: E402
from app.models.onboarding_progress import OnboardingProgress  # noqa: E402
from app.models.user import User  # noqa: E402

PASSWORD_ENV = "TEST_ACCOUNTS_PASSWORD"
COUNSELOR_EMAIL = "counselor@test.com"
CLIENT_EMAIL = "client@test.com"
COUNSELOR_CODE = "TST001"

# (역할, 이메일, 이름)
ACCOUNTS = [
    ("counselor", COUNSELOR_EMAIL, "테스트상담사"),
    ("client", CLIENT_EMAIL, "테스트내담자"),
]


def seed_test_accounts(db: Session, password: str) -> dict[str, int]:
    """두 계정과 부속 행(상담사 프로필·온보딩 완료·상담사-내담자 연결)을 만든다. 커밋은 호출자가 한다."""
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
    db.flush()
    return {"created": created, "updated": updated}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="테스트 계정 재시드")
    parser.add_argument("--password", help=f"비권장: 셸 이력에 남는다. 기본은 환경변수 {PASSWORD_ENV}")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    password = args.password or os.environ.get(PASSWORD_ENV)
    if not password:
        sys.exit(f"비밀번호가 필요합니다: 환경변수 {PASSWORD_ENV} (또는 --password)")
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        result = seed_test_accounts(db, password)
        db.commit()
    finally:
        db.close()
    print(f"seed 완료: 생성 {result['created']}, 갱신 {result['updated']}")


if __name__ == "__main__":
    main()
