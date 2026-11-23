import os, json, struct, sqlalchemy as sa, boto3
e=sa.create_engine(os.environ["DATABASE_URL"].replace("+asyncpg","").replace("postgresql+psycopg2","postgresql"))
with e.connect() as c:
    c.execute(sa.text("SET TRANSACTION READ ONLY"))
    sid=c.execute(sa.text("select id from sessions where id::text like '0d05175e%'")).scalar()
    pid=c.execute(sa.text("select p.id from session_participants p join session_band_devices b on b.participant_id=p.id where p.session_id=:s and b.serial='LXB-017200F1'"),{"s":sid}).scalar()
    rows=c.execute(sa.text("select chunk_index,segment_id,sample_count,packet_count,created_at,object_key from eeg_raw_chunks where participant_id=:p and signal_type='ppg' order by created_at"),{"p":pid}).all()
bucket=os.environ.get("S3_BUCKET") or os.environ.get("AWS_S3_BUCKET") or "mindbreeze-dev"
s3=boto3.client("s3",region_name="ap-northeast-1")
def parse(b):
    assert b[:8]==b"MBRAW002"
    hl=struct.unpack("<I",b[8:12])[0]; h=json.loads(b[12:12+hl])
    secs={s["name"]:s for s in h["sections"]}; base=12+hl
    m=secs["packet_map"]; mp=b[base+m["offset"]:base+m["offset"]+m["length"]].decode().strip().split("\n")
    pm=[json.loads(x) for x in mp]
    pk=secs["packets"]; pb=b[base+pk["offset"]:base+pk["offset"]+pk["length"]]
    return h,pm,pb

import collections
out=[]
for i,r in enumerate(rows):
    if i>=4392+0 and False: pass
    b=s3.get_object(Bucket=bucket,Key=r[5])["Body"].read()
    h,pm,pb=parse(b)
    prof=h["parser_profile"]["profile_id"]
    for p in pm:
        raw=pb[p["byte_offset"]:p["byte_offset"]+p["byte_length"]]
        out.append((i,prof,int.from_bytes(raw[:4],"little"),int.from_bytes(raw[:4],"big"),p["sample_count"],int(p["received_utc_us"])))
web=[o for o in out if o[1]=="mb-web-clock-v1"]; nat=[o for o in out if o[1]!="mb-web-clock-v1"]
print("web pkts",len(web),"native pkts",len(nat))
def analyze(lst,idx,name):
    cnt=collections.Counter(); 
    for a,b in zip(lst,lst[1:]):
        dt=(b[idx]-a[idx]); 
        if dt>2**31: dt-=2**32
        if dt<-2**31: dt+=2**32
        da=(b[5]-a[5])/1e3
        ms=dt/32.768
        cnt["ok" if abs(ms-da)<300 else ("rewind" if dt<0 else "mismatch")]+=1
    print(name,dict(cnt))
analyze(web,2,"web LE"); analyze(web,3,"web BE(앱이 읽은 값)")
analyze(nat,2,"native LE")
# LE tick 의 첫/끝, 도착시각과 선형성
print("web first LE",web[0][2],"last LE",web[-1][2],"span_s",(web[-1][2]-web[0][2])/32768,"arrival span_s",(web[-1][5]-web[0][5])/1e6)
print("native first LE",nat[0][2],"arr first",nat[0][5]//1000000, "last",nat[-1][2])
print("web n/packet",collections.Counter(o[4] for o in web).most_common(3))
