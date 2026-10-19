"""매시 실행, KST 02시에만 향후 28일을 보충한다."""

import json
from app.core.database import SessionLocal
from app.services.class_operations_service import roll_classes


def main() -> int:
    with SessionLocal() as db:
        result = roll_classes(db)
    print(json.dumps(result))
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
