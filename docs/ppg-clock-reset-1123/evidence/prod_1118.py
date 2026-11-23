import os, sqlalchemy as sa, json
e=sa.create_engine(os.environ["DATABASE_URL"].replace("+asyncpg",""))
SIDS={"body":"caca439c-bee5-49b4-9413-b405f07e5f16","mind":"a7f4ce51-002c-4de0-b7c6-be744b6cba66"}
with e.connect() as c:
    c.execute(sa.text("SET TRANSACTION READ ONLY"))
    for nm,sid in SIDS.items():
        ps=c.execute(sa.text("select id,entered_at,band_connected from session_participants where session_id=:s and entered_at is not null order by entered_at"),{"s":sid}).all()
        print("##",nm,"entered",len(ps))
        for i,(pid,ent,bc) in enumerate(ps,1):
            g=c.execute(sa.text("select reason,signal,count(*),min(created_at),max(created_at) from biosignal_gap_events where participant_id=:p group by 1,2"),{"p":pid}).all()
            gd={f"{r[0]}/{r[1]}":(r[2],r[3].strftime('%H:%M'),r[4].strftime('%H:%M')) for r in g}
            f=c.execute(sa.text("select count(*),min(created_at),max(created_at) from eeg_feature_windows where participant_id=:p"),{"p":pid}).first()
            rw=c.execute(sa.text("select signal,count(*) from biosignal_artifacts where participant_id=:p and artifact_kind='raw_derived' group by 1"),{"p":pid}).all() if False else []
            dev=c.execute(sa.text("select firmware,app_build from session_band_devices where participant_id=:p limit 1"),{"p":pid}).first()
            print(f"M{i:02d}",bc,"feat",f[0],(f[1].strftime('%H:%M') if f[1] else None),(f[2].strftime('%H:%M') if f[2] else None),"fw",dev,gd)
