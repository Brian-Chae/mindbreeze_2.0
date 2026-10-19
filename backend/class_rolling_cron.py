"""매시 실행, KST 02시에만 향후 28일을 보충한다."""

import json
from app.core.database import SessionLocal
from app.services.class_operations_service import roll_classes


def main():
    with SessionLocal() as db:
        print(json.dumps(roll_classes(db)))


if __name__ == "__main__":
    main()
