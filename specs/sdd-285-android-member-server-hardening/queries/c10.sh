cd /opt/mindbreeze/current/backend && set -a && . /etc/mindbreeze/prod.env && set +a
/opt/mindbreeze/venv/bin/python - <<'PY' 2>&1 | cut -c1-260
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ["DATABASE_URL"])
S = "1a74e4c9-a54e-4454-8505-22840922811c"
P="^(6ecab3|94234b|bc8a88)"
with e.connect() as c:
    c.execute(text("set transaction read only"))
    print("== capture_stream")
    for r in c.execute(text("""select substr(sp.id::text,1,6), cs.generation, cs.status, cs.close_reason, cs.cutoff_code,
      (cs.opened_at at time zone 'Asia/Seoul')::time(0), (cs.closed_at at time zone 'Asia/Seoul')::time(0),
      (select count(*) from eeg_feature_windows w where w.play_group_id=cs.id::text) nfeat
      from session_participants sp join capture_stream cs on cs.participant_id=sp.id where sp.session_id=:s and sp.id::text ~ :p order by 1,2"""),{"s":S,"p":P}).all(): print(*r)
    print("== rejected ledger")
    for r in c.execute(text("""select substr(sp.id::text,1,6), l.kind, l.code, (l.created_at at time zone 'Asia/Seoul')::time(0)
      from session_participants sp join live_command_ledger l on l.session_id=sp.session_id and l.actor_id=sp.user_id where sp.session_id=:s and sp.id::text ~ :p and l.status='rejected' order by 1,4"""),{"s":S,"p":P}).all(): print(*r)
    print("== 마지막 분석행 시각 / 마지막 renew")
    for r in c.execute(text("""select substr(sp.id::text,1,6), (select max(w.created_at at time zone 'Asia/Seoul')::time(0) from eeg_feature_windows w where w.participant_id=sp.id),
      (select max(l.created_at at time zone 'Asia/Seoul')::time(0) from live_command_ledger l where l.session_id=sp.session_id and l.actor_id=sp.user_id and l.kind='capture.renew'),
      (select count(*) from biosignal_artifacts a where a.participant_id=sp.id and a.artifact_kind='feature')
      from session_participants sp where sp.session_id=:s and sp.id::text ~ :p"""),{"s":S,"p":P}).all(): print(*r)
    print("== 정상5+부분: 푸시 앱버전, 로그인 수 외 / 기대 대비 분석(feat/exp)")
PY
