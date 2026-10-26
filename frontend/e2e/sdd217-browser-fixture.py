"""T11 전용 localhost 합성 계정/리포트 fixture. 실제 환경파일을 읽지 않는다."""
import json, os, secrets, sys
from pathlib import Path
from datetime import datetime, timezone, timedelta
from uuid import UUID
os.environ['DATABASE_URL']='postgresql://sdd217@127.0.0.1:55437/sdd217_browser'
backend_dir=Path(__file__).resolve().parents[2]/'backend'
if any((backend_dir/name).exists() for name in ('.env','.env.dev')):
 raise RuntimeError('실제 환경파일이 있는 경로에서는 T11 합성 fixture를 실행하지 않습니다')
sys.path.insert(0,str(backend_dir))
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.models.onboarding_progress import OnboardingProgress
from app.models.session import Session,SessionParticipant
from app.models.record import Report
from app.models.class_program import ClassMember
import app.models
FILE=Path('/private/tmp/sdd217-browser-fixture.json')
with SessionLocal() as db:
 if sys.argv[1]=='init':
  org=Organization(name='T11 합성 검증 센터',verified=True);db.add(org);db.flush()
  data={'org_id':str(org.id)}
  for key,role,name in [('host','counselor','합성 강사'),('member','client','합성 회원'),('late','client','합성 중간합류'),('absent','client','합성 미입장')]:
   password=secrets.token_urlsafe(24)+'Aa1!';email=f't11-{key}-{secrets.token_hex(4)}@example.com'
   u=User(email=email,password_hash=hash_password(password),name=name,role=role,status='active',org_id=org.id,verified_tier='verified')
   db.add(u);db.flush();db.add(UserOrgMembership(user_id=u.id,org_id=org.id,role=role,status='active',is_primary=True));db.add(OnboardingProgress(user_id=u.id,completed=True,current_step=6,completed_at=datetime.now(timezone.utc),steps={}))
   data[key]={'id':str(u.id),'email':email,'password':password,'name':name,'role':role}
  db.commit();fd=os.open(FILE,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
  with os.fdopen(fd,'w') as f:json.dump(data,f)
  print('합성 계정 4개 생성; 비밀번호는 임시 0600 파일에만 저장')
 elif sys.argv[1] in ('report','guest-report'):
  cid,sid,uid=sys.argv[2:5];p=db.query(SessionParticipant).filter_by(session_id=UUID(sid),**({'user_id':UUID(uid)} if sys.argv[1]=='report' else {'member_id':UUID(uid)})).one()
  r=Report(session_id=p.session_id,participant_id=p.id,user_id=p.user_id,type='client',status='completed',content={'title':'T11 합성 승인 리포트','summary':'통합 검증용 합성 기록입니다. 임상 결과가 아닙니다.'})
  db.add(r);db.commit();print(json.dumps({'report_id':str(r.id),'participant_id':str(p.id)}))
 elif sys.argv[1]=='past':
  s=db.get(Session,UUID(sys.argv[2]));s.scheduled_at=datetime.now(timezone.utc)-timedelta(days=1)
  for m in db.query(ClassMember).filter_by(class_id=s.class_id):
   m.joined_at=datetime.now(timezone.utc)-timedelta(days=2);m.activated_at=m.joined_at
  db.commit();print('합성 시계: 기존 가입일은 이틀 전, 첫 회차는 하루 전으로 이동')
 elif sys.argv[1]=='inspect':
  cid=UUID(sys.argv[2]);out={'members':[{'id':str(m.id),'user_id':str(m.user_id) if m.user_id else None,'status':m.status,'research':m.research_consented,'research_origin':str(m.research_origin_id) if m.research_origin_id else None} for m in db.query(ClassMember).filter_by(class_id=cid)],'participants':[{'id':str(p.id),'session_id':str(p.session_id),'member_id':str(p.member_id),'attendance':p.attendance_status,'entered':bool(p.entered_at),'research_origin':str(p.research_origin_id) if p.research_origin_id else None} for p in db.query(SessionParticipant).join(Session,Session.id==SessionParticipant.session_id).filter(Session.class_id==cid)]};print(json.dumps(out))
