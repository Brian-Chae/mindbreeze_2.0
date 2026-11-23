# SET TRANSACTION READ ONLY
import os,sqlalchemy as sa,datetime as dt,collections
E=sa.create_engine(os.environ['DATABASE_URL'].replace('+asyncpg',''),connect_args={'options':'-c default_transaction_read_only=on -c statement_timeout=90000'})
K=dt.timezone(dt.timedelta(hours=9))
def f(t): return t.astimezone(K).strftime('%H:%M:%S') if t else None
with E.connect() as c:
 c.execute(sa.text('SET TRANSACTION READ ONLY'))
 for name,s,ns in [('BODY','caca439c-bee5-49b4-9413-b405f07e5f16',{1,10,11,5,7,20,22,24,27}),('MIND','a7f4ce51-002c-4de0-b7c6-be744b6cba66',{1,8,11,14,15,17,19})]:
  print('=====',name)
  rows=c.execute(sa.text('select id,user_id,member_id,superseded_by_participant_id,presence_seen_at,removed_at,attendance_status,band_connected,eeg_collection_consented from session_participants where session_id=:s and entered_at is not null order by entered_at'),{'s':s}).mappings().all()
  uid={}
  for i,r in enumerate(rows):
   n=i+1
   uid.setdefault(str(r['user_id'] or r['member_id']),[]).append(n)
   if n not in ns: continue
   pid=r['id']
   rc=c.execute(sa.text("select signal_type,count(*),min(start_ms),max(end_ms),count(distinct stream_id),count(distinct segment_id),sum(case when upload_status<>'uploaded' and upload_status<>'verified' then 1 else 0 end) from eeg_raw_chunks where participant_id=:p group by 1"),{'p':pid}).all()
   st=c.execute(sa.text("select count(*) from biosignal_streams where participant_id=:p"),{'p':pid}).scalar()
   cl=c.execute(sa.text("select count(*) from biosignal_close_intents where participant_id=:p"),{'p':pid}).scalar()
   pl=c.execute(sa.text("select count(*) from session_presence_leases where participant_id=:p"),{'p':pid}).scalar() if False else None
   print(f"P{n:02d} sup={r['superseded_by_participant_id'] is not None} presence={f(r['presence_seen_at'])} removed={f(r['removed_at'])} att={r['attendance_status']} streams={st} closes={cl}")
   for x in rc: print('    raw',x[0],'n=',x[1],'first',f(dt.datetime.fromtimestamp(x[2]/1000,dt.timezone.utc)) if x[2] else None,'last',f(dt.datetime.fromtimestamp(x[3]/1000,dt.timezone.utc)) if x[3] else None,'streams',x[4],'segs',x[5],'notuploaded',x[6])
  print(' same-user multi participants:',[v for v in uid.values() if len(v)>1])
