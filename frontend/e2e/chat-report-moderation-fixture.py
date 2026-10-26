"""[MB261026][FIX] 채팅 신고 E2E 픽스처 — 로컬 PG 에만 상담사-회원 연결 1행을 넣는다(pytest 대상 아님).

사용: DATABASE_URL=postgresql://localhost:5432/<로컬 DB> python chat-report-moderation-fixture.py link <counselor_id> <client_id>
계정은 로컬 API(dev 시뮬레이션)로 만들고, 이 스크립트는 API 가 없는 연결만 만든다. 로컬 호스트가 아니면 거부한다.
"""

import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlalchemy.engine import make_url  # noqa: E402

ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1"}


def main(argv: list[str]) -> int:
    url = os.environ.get("DATABASE_URL", "")
    if make_url(url).host not in ALLOWED_HOSTS:
        print("로컬 DB 에만 실행합니다", file=sys.stderr)
        return 2
    if len(argv) != 3 or argv[0] != "link":
        print(__doc__, file=sys.stderr)
        return 2
    from app.core.database import SessionLocal
    from app.models.client_counselor_link import ClientCounselorLink

    db = SessionLocal()
    try:
        db.add(ClientCounselorLink(counselor_id=uuid.UUID(argv[1]), client_id=uuid.UUID(argv[2])))
        db.commit()
    finally:
        db.close()
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
