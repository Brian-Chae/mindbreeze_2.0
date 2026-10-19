"""매시 실행, KST 02시에만 향후 28일을 보충한다."""

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

from app.core.database import SessionLocal
from app.services.class_operations_service import roll_classes


def main() -> int:
    with SessionLocal() as db:
        result = roll_classes(db)
    print(json.dumps(result))
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
