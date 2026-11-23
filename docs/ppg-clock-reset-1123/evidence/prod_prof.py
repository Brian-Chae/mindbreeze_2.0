import os, sqlalchemy as sa
e=sa.create_engine(os.environ["DATABASE_URL"].replace("+asyncpg",""))
SIDS={"body":"caca439c-bee5-49b4-9413-b405f07e5f16","mind":"a7f4ce51-002c-4de0-b7c6-be744b6cba66"}
with e.connect() as c:
    c.execute(sa.text("SET TRANSACTION READ ONLY"))
    for nm,sid in SIDS.items():
        print("##",nm)
        q="""select coalesce(r.parser_profile_id,'-') prof, r.signal_type, count(*) chunks, count(distinct r.participant_id) people from eeg_raw_chunks r where r.session_id=:s group by 1,2 order by 1,2"""
        for r in c.execute(sa.text(q),{"s":sid}).all(): print(tuple(str(x) for x in r))
        q2="""select b.firmware, b.app_build, b.platform, count(*) from session_band_devices b where b.session_id=:s group by 1,2,3 order by 4 desc"""
        print("dev",[tuple(str(x) for x in r) for r in c.execute(sa.text(q2),{"s":sid}).all()])
        # 참가자별 web 프로필 여부 + ppg청크 수 + feature 수 + ppg gap 종류
        q3="""select row_number() over (order by p.entered_at) n,
          (select string_agg(distinct coalesce(parser_profile_id,'-'),',') from eeg_raw_chunks r where r.participant_id=p.id and r.signal_type='ppg') ppgprof,
          (select count(*) from eeg_raw_chunks r where r.participant_id=p.id and r.signal_type='ppg') ppgchunks,
          (select count(*) from eeg_raw_chunks r where r.participant_id=p.id and r.signal_type='eeg') eegchunks,
          (select count(*) from eeg_feature_windows f where f.participant_id=p.id) feats,
          p.band_connected
          from session_participants p where p.session_id=:s and p.entered_at is not null order by p.entered_at"""
        for r in c.execute(sa.text(q3),{"s":sid}).all():
            if r[1] and 'web' in r[1] or r[4]==0 or r[2]==0: print("  ",tuple(str(x) for x in r))
