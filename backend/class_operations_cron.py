"""매분 실행: 요청·강사 만료, 종료, 전달 의도 재처리. 기본 스위치는 꺼져 있다."""

import json
from app.config import settings
from app.core.database import SessionLocal
from app.services.class_operations_service import maintain_classes
from app.services.class_effect_service import process_effects


def main():
    if not settings.class_scheduling_enabled:
        print(json.dumps({"status": "disabled"}))
        return
    with SessionLocal() as db:
        result = {"maintenance": maintain_classes(db), "effects": process_effects(db)}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
