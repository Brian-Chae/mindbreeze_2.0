import os, sqlalchemy as sa
e=sa.create_engine(os.environ["DATABASE_URL"].replace("+asyncpg","").replace("postgresql+psycopg2","postgresql"))
with e.connect() as c:
    c.execute(sa.text("SET TRANSACTION READ ONLY"))
    pid='415df9ed-a01e-4ebc-b142-b37774bb9f81'
    r=c.execute(sa.text("select user_id is null as guest, guest_client_id is null gc, consent_eeg, eeg_collection_consented, entered_at at time zone 'Asia/Seoul', band_connected from session_participants where id=:p"),{"p":pid}).first(); print("P05 guest(user_id null)",r)
    # 같은 회차 다른 참가자들 user_id null 여부
    print("others guest", c.execute(sa.text("select count(*) filter (where user_id is null), count(*) from session_participants where session_id=(select session_id from session_participants where id=:p) and entered_at is not null"),{"p":pid}).first())
    # P05 gap 시계열(5분) reason
    for r in c.execute(sa.text("select to_char(created_at at time zone 'Asia/Seoul','HH24:MI') m, reason, signal, count(*) from biosignal_gap_events where participant_id=:p group by 1,2,3 order by 1 limit 12"),{"p":pid}).all(): print(r)
    # P05 band 연결 이후 첫 feature / 첫 EEG raw 청크 시각
    print("first eeg raw",c.execute(sa.text("select min(created_at at time zone 'Asia/Seoul'),count(*) from eeg_raw_chunks where participant_id=:p and signal_type='eeg' and parser_profile_id like 'mb-web%'"),{"p":pid}).first())
