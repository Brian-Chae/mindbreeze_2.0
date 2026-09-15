"""cron에서 직접 호출하는 서사 캐시 주기 업그레이드 스크립트 (celery beat 대체).

매일 1회 실행: source='rule' 항목을 최대 5개 LLM으로 업그레이드.
실행 예: cd backend && venv/bin/python upgrade_narrative_cache_cron.py
"""
from app.core.database import SessionLocal
from app.tasks.upgrade_narrative_cache import upgrade_rule_narratives


def main() -> int:
    db = SessionLocal()
    try:
        upgraded = upgrade_rule_narratives(db, limit=5)
        print(f"[upgrade_narrative_cache] upgraded={upgraded}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[upgrade_narrative_cache] failed: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
