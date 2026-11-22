# SET TRANSACTION READ ONLY
import os,json,sqlalchemy as sa,collections,datetime as dt
E=sa.create_engine(os.environ['DATABASE_URL'].replace('+asyncpg',''),connect_args={'options':'-c default_transaction_read_only=on -c statement_timeout=90000'})
K=dt.timezone(dt.timedelta(hours=9))
def f(t): return t.astimezone(K).strftime('%H:%M:%S') if t else None
U=lambda us: dt.datetime.fromtimestamp(us/1e6,dt.timezone.utc)
with E.connect() as c:
 c.execute(sa.text('SET TRANSACTION READ ONLY'))
 for name,s in [('BODY','caca439c-bee5-49b4-9413-b405f07e5f16'),('MIND','a7f4ce51-002c-4de0-b7c6-be744b6cba66')]:
  a,b=c.execute(sa.text('select started_at,ended_at from sessions where id=:s'),{'s':s}).one()
  print('=====',name,f(a),f(b))
  P={}
  for i,r in enumerate(c.execute(sa.text('select id,entered_at,band_connected,band_battery from session_participants where session_id=:s and entered_at is not null order by entered_at'),{'s':s}).mappings()):
   P[str(r['id'])]=dict(n=i+1,**r)
  feat=collections.defaultdict(list)
  for r in c.execute(sa.text('select participant_id,device_timestamp_ms from eeg_feature_windows where session_id=:s'),{'s':s}).mappings():
   t=dt.datetime.fromtimestamp(r['device_timestamp_ms']/1000,dt.timezone.utc)
   if a<=t<=b: feat[str(r['participant_id'])].append(t)
  gaps=collections.defaultdict(list)
  for r in c.execute(sa.text("select participant_id,signal,reason,start_us,end_us,discovered_at_us,reconnect_count,segment_id from biosignal_gap_events where session_id=:s order by start_us"),{'s':s}).mappings():
   gaps[str(r['participant_id'])].append(r)
  tot=collections.Counter(); 
  for pid,p in P.items():
   ts=sorted(set(feat.get(pid,[]))); g=gaps.get(pid,[])
   disc=[x for x in g if x['reason']=='ble_disconnect' and x['signal']=='eeg']
   cr=[x for x in g if x['reason']=='clock_reset' and x['signal']=='eeg']
   fg=[(x,y) for x,y in zip(ts,ts[1:]) if (y-x).total_seconds()>10]
   tail=(b-ts[-1]).total_seconds() if ts else None
   cnt=collections.Counter((x['signal'],x['reason']) for x in g)
   tot['people']+=1
   if p['band_connected'] is not True: tot['band_false']+=1
   if disc: tot['people_disc']+=1; tot['disc_ev']+=len(disc)
   interesting = disc or fg or (tail is None or tail>90) or p['band_connected'] is not True
   if not interesting: continue
   print(f"P{p['n']:02d} enter={f(p['entered_at'])} band={p['band_connected']} nfeat={len(ts)} first={f(ts[0]) if ts else None} last={f(ts[-1]) if ts else None} tail_s={None if tail is None else int(tail)} pkt_gap={cnt[('eeg','packet_gap')]} disc_eeg={len(disc)} clk_reset={len(cr)} maxrc={max([x['reconnect_count'] for x in g],default=0)}")
   if fg: print('   feat gaps>10s:',[(f(x),int((y-x).total_seconds())) for x,y in fg])
   if disc:
    print('   disc(start,end_known_len_s,rc):',[(f(U(x['start_us'])), (int((x['end_us']-x['start_us'])/1e6) if x['end_us'] else None), x['reconnect_count']) for x in disc][:25])
  print('TOTAL',dict(tot))
  # 전체 packet_gap 분포
  r=c.execute(sa.text("select reason,signal,count(*),count(distinct participant_id),percentile_cont(0.5) within group (order by (end_us-start_us)/1e6) filter (where end_us is not null) med,max((end_us-start_us)/1e6) filter (where end_us is not null) mx from biosignal_gap_events where session_id=:s group by 1,2 order by 1,2"),{'s':s}).all()
  for x in r: print('  GAP',[str(v) for v in x])
