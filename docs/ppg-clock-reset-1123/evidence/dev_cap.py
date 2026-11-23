import os, sqlalchemy as sa
e=sa.create_engine(os.environ["DATABASE_URL"].replace("+asyncpg","").replace("postgresql+psycopg2","postgresql"))
with e.connect() as c:
    c.execute(sa.text("SET TRANSACTION READ ONLY"))
    sid=c.execute(sa.text("select id from sessions where id::text like '0d05175e%'")).scalar()
    print([x[0] for x in c.execute(sa.text("select column_name from information_schema.columns where table_name='capture_stream'")).all()])
    rows=c.execute(sa.text("select * from capture_stream where session_id=:s order by created_at"),{"s":sid}).mappings().all()
    for r in rows:
        d={k:(str(v)[:40] if v is not None else None) for k,v in r.items() if k in('participant_id','status','path','created_at','closed_at','stop_reason','close_reason','owner','source','kind','device_serial','band_serial','clock_uncertain','state','generation','updated_at')}
        print(d)
    print("n",len(rows))
    pid=c.execute(sa.text("select p.id from session_participants p join session_band_devices b on b.participant_id=p.id where p.session_id=:s and b.serial='LXB-017200F1'"),{"s":sid}).scalar()
    print("P05",pid)
    print([x[0] for x in c.execute(sa.text("select column_name from information_schema.columns where table_name='live_command_ledger'")).all()])
