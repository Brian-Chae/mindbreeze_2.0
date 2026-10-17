"""cron에서 직접 호출하는 연구 DB 내보내기 배치 스크립트 (SDD-209 B13 / BE-R3).

기본 ``RESEARCH_EXPORT_ENABLED=false`` 라 실행해도 아무것도 올리지 않는다. 활성화(스테이징 prefix·IAM 인프라 승인 후)와
crontab 등록은 별도 승인 — 이 SDD 에서는 Spark 실접속·실전송을 하지 않는다.

실행 예: cd backend && venv/bin/python research_export_cron.py
"""
import json

from app.core.database import SessionLocal
from app.services.research_export_service import run_export


def main() -> int:
    db = SessionLocal()
    try:
        result = run_export(db)
        print(f"[research_export] {json.dumps(result, ensure_ascii=False, default=str)}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[research_export] failed: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
