import os, sqlalchemy as sa
e=sa.create_engine(os.environ["DATABASE_URL"].replace("+asyncpg","").replace("postgresql+psycopg2","postgresql"))
with e.connect() as c:
    c.execute(sa.text("SET TRANSACTION READ ONLY"))
    sid=c.execute(sa.text("select id from sessions where id::text like '0d05175e%'")).scalar()
    q="""select row_number() over (order by p.entered_at) n, p.consent_eeg, p.eeg_collection_consented, p.eeg_collection_consent_at at time zone 'Asia/Seoul' ca, p.entered_at at time zone 'Asia/Seoul' ent, b.serial,
       (select min(created_at at time zone 'Asia/Seoul') from capture_stream s where s.participant_id=p.id) cap_open,
       (select string_agg(distinct parser_profile_id,',') from eeg_raw_chunks r where r.participant_id=p.id) profs
       from session_participants p left join session_band_devices b on b.participant_id=p.id where p.session_id=:s and p.entered_at is not null order by p.entered_at"""
    for r in c.execute(sa.text(q),{"s":sid}).all(): print(tuple(str(x)[:19] for x in r))
    # P05 밴드의 오전 회차 raw 프로필
    q2="""select s.id::text like '0bc31443%%' a, s.id::text like '87bc1c36%%' b, string_agg(distinct r.parser_profile_id||'/'||r.signal_type,',') from eeg_raw_chunks r join sessions s on s.id=r.session_id join session_band_devices d on d.participant_id=r.participant_id and d.serial='LXB-017200F1' group by 1,2"""
    print(c.execute(sa.text(q2.replace('%%','%'))).all())
