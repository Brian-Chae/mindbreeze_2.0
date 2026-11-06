cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
/opt/mindbreeze/venv/bin/python - <<'PY' 2>&1 | cut -c1-230
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ["DATABASE_URL"])
S = "1a74e4c9-a54e-4454-8505-22840922811c"
with e.connect() as c:
    c.execute(text("set transaction read only"))
    for r in c.execute(text("""select substr(sp.id::text,1,6), l.kind, l.status, substr(l.command_id::text,1,6) cid, substr(l.body_hash,1,6), l.epoch, (l.created_at at time zone 'Asia/Seoul')::time(0)
      from session_participants sp join live_command_ledger l on l.session_id=sp.session_id and l.actor_id=sp.user_id where sp.session_id=:s and sp.id::text ~ '^(de8312|6a2172|518675|ac1a78)' and l.kind='capture.start' order by 1,7"""),{"s":S}).all(): print(*r)
PY
echo "== nginx socket.io 접속 종료 로그 (IP별, 4명 추정 IP)"
for f in /var/log/nginx/access.log.1 /var/log/nginx/access.log; do cat $f; done | grep "04/Nov/2026:0[1-2]:" | grep "socket.io" | grep -E "^(118\.235\.81\.217|223\.38\.224\.228|118\.235\.80\.158) " | awk '{print $1, substr($4,14,8), $10}'
echo "== 해당 IP의 biosignal-capabilities·features/batch 최초/마지막 시각"
for ip in 118.235.81.217 223.38.224.228 118.235.80.158; do for f in /var/log/nginx/access.log.1 /var/log/nginx/access.log; do cat $f; done | grep "04/Nov/2026:0[1-2]:" | grep "^$ip " | awk -v ip=$ip '{n++; if(!a)a=substr($4,14,8); b=substr($4,14,8)} END{print ip, n, a, b}'; done
