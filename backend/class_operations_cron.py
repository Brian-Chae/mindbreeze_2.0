"""매분 실행: 요청·강사 만료, 종료, 전달 의도 재처리. 기본 스위치는 꺼져 있다."""

import json
import sys
from pathlib import Path

# dev cron은 systemd와 같은 설정을 앱 import 전에 읽는다.
if "--dev-env" in sys.argv:
    from dotenv import load_dotenv

    env_path = Path(__file__).with_name(".env.dev")
    if not env_path.is_file():
        raise SystemExit("dev 설정 파일이 없습니다")
    load_dotenv(env_path, override=True)

from app.config import settings
from app.core.database import SessionLocal
from app.services.class_operations_service import maintain_classes
from app.services.class_effect_service import process_effects


def main() -> int:
    if not settings.class_scheduling_enabled:
        print(json.dumps({"status": "disabled"}))
        return 0
    with SessionLocal() as db:
        result = {"maintenance": maintain_classes(db), "effects": process_effects(db)}
    print(json.dumps(result))
    return 1 if any(part["failed"] for part in result.values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
