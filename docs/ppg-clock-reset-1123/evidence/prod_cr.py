import os, sqlalchemy as sa
e=sa.create_engine(os.environ["DATABASE_URL"].replace("+asyncpg",""))
SIDS={"body":"caca439c-bee5-49b4-9413-b405f07e5f16","mind":"a7f4ce51-002c-4de0-b7c6-be744b6cba66"}
with e.connect() as c:
    c.execute(sa.text("SET TRANSACTION READ ONLY"))
    for nm,sid in SIDS.items():
        # clock_reset 보유 참가자: 이후 feature 유무
        q="""select row_number() over (order by p.entered_at) n, p.band_connected,
          (select min(g.created_at) from biosignal_gap_events g where g.participant_id=p.id and g.reason='clock_reset') cr,
          (select max(f.created_at) from eeg_feature_windows f where f.participant_id=p.id) lastfeat,
          (select count(*) from eeg_feature_windows f where f.participant_id=p.id and f.created_at > (select min(g.created_at) from biosignal_gap_events g where g.participant_id=p.id and g.reason='clock_reset')) feat_after,
          (select max(r.created_at) from eeg_raw_chunks r where r.participant_id=p.id and r.signal_type='ppg') lastppg,
          (select count(*) from biosignal_gap_events g where g.participant_id=p.id and g.reason='reanchor') nre
          from session_participants p where p.session_id=:s and p.entered_at is not null order by p.entered_at"""
        print("##",nm)
        for r in c.execute(sa.text(q),{"s":sid}).all():
            if r[2] is not None: print(tuple(str(x)[11:19] if hasattr(x,'hour') else str(x) for x in r))
        print("reanchor total",c.execute(sa.text("select count(*) from biosignal_gap_events where session_id=:s and reason='reanchor'"),{"s":sid}).scalar(),
              "clock_reset total",c.execute(sa.text("select signal,count(*) from biosignal_gap_events where session_id=:s and reason='clock_reset' group by 1"),{"s":sid}).all())
