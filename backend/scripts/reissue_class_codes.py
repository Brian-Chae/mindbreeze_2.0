"""활성 클래스 4자리 코드 재발급 (SDD-209 DS-1) — 수동 실행 전용.

사용:
  cd backend && source venv/bin/activate
  python scripts/reissue_class_codes.py            # dry-run (기본, 쓰기 없음) — 건수만 출력
  python scripts/reissue_class_codes.py --apply    # dry-run 출력 승인 후에만

출력에는 건수만 나오며 코드 값·개인정보는 출력하지 않는다. 멱등.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal  # noqa: E402
from app.services.class_code_reissue import reissue_active_class_codes  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="활성 클래스 4자리 코드 재발급")
    parser.add_argument("--apply", action="store_true", help="실제로 반영한다(기본은 dry-run)")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        result = reissue_active_class_codes(db, dry_run=not args.apply)
    finally:
        db.close()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
