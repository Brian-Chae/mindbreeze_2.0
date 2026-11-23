import os, sqlalchemy as sa
e=sa.create_engine(os.environ["DATABASE_URL"].replace("+asyncpg","").replace("postgresql+psycopg2","postgresql"))
with e.connect() as c:
    c.execute(sa.text("SET TRANSACTION READ ONLY"))
    sid=c.execute(sa.text("select id from sessions where id::text like '0d05175e%'")).scalar()
    pid='415df9ed-a01e-4ebc-b142-b37774bb9f81'
    print("capture rows for P05:")
    for r in c.execute(sa.text("select generation,status,opened_at,closed_at,close_reason,cutoff_code,clock_uncertain from capture_stream where participant_id=:p order by opened_at"),{"p":pid}).all(): print(r)
    # 같은 참가자 capture 가 07:05 에야 생김 → 그 전엔?
    print("ledger kinds for session actor? columns: actor_id")
    q="""select kind,status,code,count(*),min(created_at at time zone 'Asia/Seoul')::time(0),max(created_at at time zone 'Asia/Seoul')::time(0) from live_command_ledger where session_id=:s and kind like 'capture.%' group by 1,2,3 order by 1,2"""
    for r in c.execute(sa.text(q),{"s":sid}).all(): print(r)
    q="""select count(*),min(created_at at time zone 'Asia/Seoul')::time(0),max(created_at at time zone 'Asia/Seoul')::time(0) from eeg_feature_windows where participant_id=:p"""
    print("feat",c.execute(sa.text(q),{"p":pid}).first())
    print([x[0] for x in c.execute(sa.text("select column_name from information_schema.columns where table_name='eeg_feature_windows'")).all()][:40])
    print("feature artifacts for P05:",c.execute(sa.text("select artifact_kind,upload_status,count(*) from biosignal_artifacts where participant_id=:p group by 1,2"),{"p":pid}).all())
    print("other participant artifacts sample:",c.execute(sa.text("select artifact_kind,upload_status,count(*) from biosignal_artifacts where session_id=:s group by 1,2"),{"s":sid}).all())
