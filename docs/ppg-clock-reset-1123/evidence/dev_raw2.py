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
sel=list(range(0,25))+list(range(1500,1510))+list(range(4400,4423))
out=[]
for i in sel:
    r=rows[i]
    b=s3.get_object(Bucket=bucket,Key=r[5])["Body"].read()
    h,pm,pb=parse(b)
    for p in pm:
        raw=pb[p["byte_offset"]:p["byte_offset"]+p["byte_length"]]
        out.append(dict(i=i,seg=h["segment_id"][:8],chunk=h["chunk_index"],tick=p["tick_raw"],unw=p["tick_unwrapped"],n=p["sample_count"],arr=int(p["received_utc_us"]),blen=p["byte_length"],mal=p["malformed_reason"],hex=raw[:16].hex()))
    if i==0: print("HEADER",json.dumps({k:h[k] for k in ("parser_profile","rate","anchor","sample_count","packet_count")})[:600])
prev=None
for o in out:
    d=""
    if prev and o["tick"] is not None and prev["tick"] is not None:
        dt=int(o["tick"])-int(prev["tick"]); da=(o["arr"]-prev["arr"])/1e3
        d=f"dtick={dt} ({dt/32.768:.0f}ms) darr={da:.0f}ms"
    print(o["i"],o["seg"],o["chunk"],"tick",o["tick"],"n",o["n"],"len",o["blen"],"arr",o["arr"]%10**9//1000,d,o["mal"] or "")
    prev=o
