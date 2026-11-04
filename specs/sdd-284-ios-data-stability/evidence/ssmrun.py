import sys,base64,subprocess,json,time
AWS="/Users/brianyongwookchae/.aws-venv/bin/aws"
body=open(sys.argv[1]).read()
b=base64.b64encode(body.encode()).decode()
cmd=f"echo {b} | base64 -d | bash"
r=subprocess.run([AWS,"ssm","send-command","--profile","looxid-las","--region","ap-northeast-1","--instance-ids","i-0487c67fb0db7dcba","--document-name","AWS-RunShellScript","--parameters",json.dumps({"commands":[cmd],"executionTimeout":["240"]}),"--query","Command.CommandId","--output","text"],capture_output=True,text=True)
cid=r.stdout.strip()
if not cid: print(r.stderr); sys.exit(1)
for _ in range(80):
    time.sleep(3)
    g=subprocess.run([AWS,"ssm","get-command-invocation","--profile","looxid-las","--region","ap-northeast-1","--instance-id","i-0487c67fb0db7dcba","--command-id",cid,"--output","json"],capture_output=True,text=True)
    if g.returncode: continue
    d=json.loads(g.stdout)
    if d["Status"] not in("Pending","InProgress","Delayed"):
        print(d["Status"]);print(d["StandardOutputContent"][-12000:]);print(d["StandardErrorContent"][-2000:]);break
