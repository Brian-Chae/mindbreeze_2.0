"""측정용 로컬 DB 시드 — 상담사 1명 생성 후 access token 을 출력한다.

로컬 PostgreSQL(mb_auth_bench) 전용. 운영·dev DB 에 연결하지 않는다.
사용: DATABASE_URL=postgresql://localhost:5432/mb_auth_bench python seed.py
"""

import uuid

from app.core.database import SessionLocal
from app.core.security import create_access_token, hash_password
from app.models.user import User

EMAIL = "bench-counselor@example.com"

db = SessionLocal()
user = db.query(User).filter(User.email == EMAIL).first()
if user is None:
    user = User(
        id=uuid.uuid4(),
        email=EMAIL,
        password_hash=hash_password("bench-pass-1234"),
        name="측정 상담사",
        role="counselor",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
print(create_access_token(str(user.id)))
db.close()
