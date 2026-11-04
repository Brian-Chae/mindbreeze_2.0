cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
/opt/mindbreeze/venv/bin/python - <<'PY' 2>&1 | cut -c1-400
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ["DATABASE_URL"])
with e.connect() as c:
    for t in ("live_outbox","live_command_ledger","eeg_raw_chunks","capture_stream","device_tokens"):
        print(t, [r[0] for r in c.execute(text("select column_name from information_schema.columns where table_name=:t"),{"t":t}).all()])
PY
