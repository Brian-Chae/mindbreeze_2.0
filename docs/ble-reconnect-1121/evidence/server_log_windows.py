# SET TRANSACTION READ ONLY
import os,subprocess,re,collections
for tag,st,en in [('MIND 14:49:18(P15공백 시작)','2026-11-18 05:48:30','2026-11-18 05:50:30'),('MIND 15:09~15:14','2026-11-18 06:09:00','2026-11-18 06:14:00'),('BODY 10:36:54(P11)','2026-11-18 01:36:00','2026-11-18 01:38:00'),('BODY 10:18:50(P01)','2026-11-18 01:18:00','2026-11-18 01:20:00')]:
  cmd=['journalctl','--utc','--since',st,'--until',en,'--no-pager','-o','short-iso','-u','mindbreeze-backend','-u','mindbreeze-rest@*']
  L=subprocess.run(cmd,capture_output=True,text=True).stdout.splitlines()
  c=collections.Counter()
  for l in L:
    m=re.search(r'" (\d{3})',l)
    if m and m[1][0] in '45': 
      mm=re.search(r'"(GET|POST|PATCH|PUT|DELETE) ([^ ?]+)',l); c[(m[1],re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}','<id>',mm[2]) if mm else '?')]+=1
    elif re.search(r'Traceback|ERROR|WARNING|timeout|disconnect',l,re.I): c[('log',re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}','<id>',re.sub(r'\d+','N',l[40:130])))]+=1
  print('==',tag,'lines',len(L))
  for k,v in c.most_common(8): print('  ',v,k)
