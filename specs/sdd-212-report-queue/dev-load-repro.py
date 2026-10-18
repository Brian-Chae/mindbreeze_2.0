"""SDD-212 dev 부하 재현 — 합성 세션 N개를 거의 동시에 종료시켜 줄(stt/report)별 처리를 관찰한다.

dev 서버 전용(운영 금지). 서버에서 backend 디렉터리 기준으로 실행:
  export PYTHONPATH=.   # 설정은 .env.dev 를 자동으로 읽는다(값을 출력하지 않는다)
  venv/bin/python dev-load-repro.py create 12    # 합성 세션 12개 생성 + 종료(= 실제 발행 경로)
  venv/bin/python dev-load-repro.py watch        # 줄 길이·아웃박스 진행 집계
  venv/bin/python dev-load-repro.py cleanup      # 제목 접두어로 합성 세션 삭제
생성하는 세션 제목은 모두 `[SDD212-LOAD]` 로 시작하며, 절반은 녹음 보유(stt→summary→report), 절반은 리포트만이다.
출력에는 건수·시간만 낸다(세션 식별자·사용자 정보 없음).
"""
import os
import sys
import time
from datetime import datetime, timedelta, timezone

PREFIX = "[SDD212-LOAD]"
HOST_EMAIL = "counselor@test.com"


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def create(n: int) -> None:
    from app.models.pipeline_outbox import PipelineOutbox  # noqa: F401
    from app.models.record import SessionRecord
    from app.models.session import Session
    from app.models.user import User
    from app.services import audio_service

    db = _db()
    host = db.query(User).filter(User.email == HOST_EMAIL).first()
    if host is None:
        raise SystemExit("테스트 상담사 계정이 없다")
    now = datetime.now(timezone.utc)
    ids = []
    for i in range(n):
        s = Session(
            type="clinical", status="in_progress", host_id=host.id, duration_min=30,
            title=f"{PREFIX} {i}", started_at=now - timedelta(minutes=5),
        )
        db.add(s)
        db.flush()
        if i % 2 == 0:
            db.add(SessionRecord(
                session_id=s.id, status="recording", markers=[], edit_history=[], ai_summary={},
                recording_started_at=now - timedelta(minutes=4),
            ))
        ids.append(s.id)
    db.commit()
    t0 = time.time()
    for sid in ids:
        audio_service.finalize_on_session_end(sid, db)
    print(f"created={n} finalize_elapsed={time.time() - t0:.1f}s")


def watch() -> None:
    import redis
    from sqlalchemy import text

    from app.config import settings

    r = redis.Redis.from_url(settings.redis_url)
    db = _db()
    q = {k: r.llen(k) for k in ("celery", "stt", "report")}
    rows = db.execute(text(
        "select o.status, o.has_recording, o.attempts, count(*) from pipeline_outbox o "
        "join sessions s on s.id=o.session_id where s.title like :p group by 1,2,3 order by 1,2,3"), {"p": PREFIX + "%"}).fetchall()
    rep = db.execute(text(
        "select r.generation_status, count(*) from reports r join sessions s on s.id=r.session_id "
        "where s.title like :p group by 1"), {"p": PREFIX + "%"}).fetchall()
    rec = db.execute(text(
        "select r.status, count(*) from session_records r join sessions s on s.id=r.session_id "
        "where s.title like :p group by 1"), {"p": PREFIX + "%"}).fetchall()
    print("queues", q)
    print("outbox(status,has_recording,attempts,n)", [tuple(x) for x in rows])
    print("records(status,n)", [tuple(x) for x in rec])
    print("reports(generation_status,n)", [tuple(x) for x in rep])


def cleanup() -> None:
    from sqlalchemy import text

    db = _db()
    ids = [r[0] for r in db.execute(text("select id from sessions where title like :p"), {"p": PREFIX + "%"})]
    for sid in ids:
        for t in ("reports", "session_records", "pipeline_outbox"):
            db.execute(text(f"delete from {t} where session_id=:i"), {"i": sid})
        db.execute(text("delete from sessions where id=:i"), {"i": sid})
    db.commit()
    print(f"deleted={len(ids)}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "create":
        create(int(sys.argv[2]))
    elif cmd == "watch":
        watch()
    elif cmd == "cleanup":
        cleanup()
    else:
        raise SystemExit(__doc__)
