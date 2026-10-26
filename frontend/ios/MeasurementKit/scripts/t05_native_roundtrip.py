"""T07b — iOS native ↔ 실제 T05 백엔드(운영 app.ws:asgi_app) 왕복 실측용 드라이버. dev 서버·dev DB·.env 를 쓰지 않는다.

로컬 PostgreSQL(관리 접속 SDD246_PG_ADMIN_URL, 기본 postgresql://localhost/postgres)에 임시 DB 를 만들고 alembic upgrade head,
로컬 Redis DB 11 + 고유 prefix, 합성 회차(호스트 1·참가자 1, EEG 동의)를 만든 뒤 T05 시험 하네스(Server)로 운영 ASGI 앱을 띄운다.

사용(백엔드 디렉터리에서, 백엔드 의존성이 있는 파이썬으로):
  cd backend && PYTHONPATH=. <python> ../frontend/ios/MeasurementKit/scripts/t05_native_roundtrip.py <info.json> <summary.json>
  → info.json 에 {url, token, host_token, session_id, participant_id} 를 쓰고 표준입력 EOF(또는 <info.json>.done 파일)까지 대기,
    이후 DB 의 capture_streams·eeg_feature_windows·command ledger 를 요약해 summary.json 에 쓰고 DB·Redis 키를 정리한다.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

BACKEND = Path.cwd()
ALLOWED = {"127.0.0.1", "localhost", "::1", None}
REDIS_URL = os.environ.get("SDD246_REDIS_URL", "redis://localhost:6379/11")


def main(info_path: str, summary_path: str) -> int:
    admin_url = make_url(os.environ.get("SDD246_PG_ADMIN_URL", "postgresql://localhost/postgres"))
    assert admin_url.host in ALLOWED, "로컬 PG 에만 연결한다"
    assert make_url(REDIS_URL).host in ALLOWED and make_url(REDIS_URL).database not in (None, "", "0"), "로컬 Redis 비-0 DB 만"
    name = f"sdd246_t07b_{os.getpid()}"
    admin = sa.create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        c.execute(sa.text(f'CREATE DATABASE "{name}"'))
    pg_url = admin_url.set(database=name, drivername="postgresql").render_as_string(hide_password=False)
    prefix = f"t07b:{uuid.uuid4().hex[:12]}"
    server = None
    try:
        env = {**os.environ, "DATABASE_URL": pg_url}
        p = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, capture_output=True, text=True)
        assert p.returncode == 0, p.stderr[-2000:]
        os.environ.update({"DATABASE_URL": pg_url, "LIVE_PROTOCOL_V2": "1"})

        from tests.sdd246.commands.conftest import World
        from tests.sdd246.transport.harness import Server, token_for
        from app.models.session import Session as SessionModel
        from app.services.session_live_legacy import PROTOCOL_V2, pin_session_protocol

        engine = sa.create_engine(pg_url)
        maker = sessionmaker(bind=engine, autoflush=False)
        world = World(maker, n_participants=1)
        with maker() as s:   # 열리기 전 상태에서 v2 고정(진행 중 회차는 v1 유지 규칙)
            row = s.get(SessionModel, world.session_id); row.status = "ready"; s.commit()
            pin_session_protocol(s, world.session_id, protocol=PROTOCOL_V2)
            row = s.get(SessionModel, world.session_id); row.status = "in_progress"; s.commit()
        server = Server(pg_url, REDIS_URL, prefix, f"t07bchan{uuid.uuid4().hex[:8]}", heartbeat_s=1.0)
        uid, pid = world.members[0]
        info = {"url": server.url, "token": token_for(uid, minutes=30), "host_token": token_for(world.host_id, minutes=30),
                "session_id": str(world.session_id), "participant_id": str(pid)}
        Path(info_path).write_text(json.dumps(info))
        print(f"READY {server.url} session={world.session_id}", flush=True)

        done = Path(info_path + ".done")
        stdin_closed = threading.Event()
        threading.Thread(target=lambda: (sys.stdin.read(), stdin_closed.set()), daemon=True).start()
        deadline = time.time() + 900
        while not done.exists() and not stdin_closed.is_set() and time.time() < deadline:
            time.sleep(0.2)

        with engine.connect() as c:
            streams = [dict(r._mapping) for r in c.execute(sa.text(
                "select generation, status, clock_uncertain, clock_uncertainty_ms, anchor_monotonic_us is not null as anchored, "
                "lease_expires_at is not null as lease_set, final_sequences, close_reason, cutoff_code "
                "from capture_stream where session_id = :s"), {"s": world.session_id})]
            windows = c.execute(sa.text(
                "select count(*), count(distinct window_index), min(window_index), max(window_index) "
                "from eeg_feature_windows where session_id = :s and participant_id = :p"), {"s": world.session_id, "p": pid}).one()
            ledger = [dict(r._mapping) for r in c.execute(sa.text(
                "select kind, status, code, count(*) as n from live_command_ledger where session_id = :s group by kind, status, code order by kind"),
                {"s": world.session_id})]
            outbox = [dict(r._mapping) for r in c.execute(sa.text(
                "select domain, event_type, count(*) as n from live_outbox where session_id = :s group by domain, event_type order by domain, event_type"),
                {"s": world.session_id})]
        summary = {"streams": streams, "feature_windows": {"rows": windows[0], "distinct_index": windows[1], "min": windows[2], "max": windows[3]},
                   "ledger": ledger, "outbox": outbox}
        Path(summary_path).write_text(json.dumps(summary, default=str, ensure_ascii=False, indent=1))
        print("SUMMARY", json.dumps(summary, default=str, ensure_ascii=False), flush=True)
        engine.dispose()
        return 0
    finally:
        if server is not None:
            server.stop()
        import redis as redis_lib
        r = redis_lib.Redis.from_url(REDIS_URL)
        for k in r.scan_iter(match=f"{prefix}:*", count=500):
            r.delete(k)
        r.close()
        with admin.connect() as c:
            c.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
