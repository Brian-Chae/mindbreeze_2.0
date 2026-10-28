"""T09 SQLite HTTP의 가산 응답·권한 회귀. PG 전용 제약은 pg 파일에서 검증."""
from app.core import database
from datetime import datetime,timedelta,timezone
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.class_program import ClassMember
from app.models.record import Report
from app.models.session import Session,SessionParticipant
from tests.pg.sdd216_helpers import world,user
NOW=datetime.now(timezone.utc)

def scene(db):
    org,host,_,cls=world(db);cls.recurrence_rule={'version':1};cls.capacity=8
    owner=user(db,org,role='client')
    member=ClassMember(class_id=cls.id,user_id=owner.id,status='active',joined_via='code',joined_at=NOW-timedelta(days=2))
    db.add(member);db.flush();rows=[]
    for seq,days in enumerate((-4,-1,1),1):
        row=Session(type='meditation',class_id=cls.id,host_id=host.id,seq=seq,status='completed' if days<0 else 'scheduled',host_state='assigned',duration_min=60,scheduled_at=NOW+timedelta(days=days),max_participants=8)
        db.add(row);db.flush();rows.append(row)
    db.commit();return org,host,cls,owner,member,rows

def http(db,monkeypatch):
    from app.api.v1 import classes,reports
    from app.config import settings
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI();app.include_router(classes.router,prefix='/api/v1');app.include_router(reports.router,prefix='/api/v1');app.dependency_overrides[get_db]=lambda:db
    return TestClient(app)

def bearer(owner):return {'Authorization':f'Bearer {create_access_token(str(owner.id))}'}
def participant(db,member,session,status='attended'):
    row=SessionParticipant(session_id=session.id,member_id=member.id,user_id=member.user_id,attendance_status=status,report_included=True)
    db.add(row);db.flush();return row
def report(db,session,participant,status='completed'):
    row=Report(session_id=session.id,participant_id=participant.id,user_id=participant.user_id,type='client',status=status,content={'title':'합성','download_url':'https://invalid.example/private'},pdf_url='https://invalid.example/private.pdf')
    db.add(row);db.flush();return row


def test_regular_history_additive_contract_and_anonymous_denied(client,monkeypatch):
    with database.SessionLocal() as db:
        _,_,cls,owner,member,sessions=scene(db)
        participant(db,member,sessions[1],'absent');db.commit();api=http(db,monkeypatch)
        path=f'/api/v1/classes/{cls.id}'
        assert api.get(path+'/me/membership').status_code==401
        result=api.get(path+'/me/membership',headers=bearer(owner))
        assert result.status_code==200,result.text
        body=result.json();assert body['member']['status']=='active' and body['attendance_summary']['absent']==1
        assert body['consents']['research_consented'] is False
        assert all(type(value) is bool for value in body['capabilities'].values())
        member.status='left';member.left_at=NOW;db.commit()
        result=api.get(path,headers=bearer(owner));assert result.status_code==200,result.text
        assert {'progress','session_count','next_session','host_view','revision','membership','capabilities'}.issubset(result.json())
        assert result.json()['capabilities']['leave'] is False
        assert api.get(path+'/members',headers=bearer(owner)).status_code in (403,404)


def test_pending_own_and_guessed_reports_are_404_without_raw_url(client,monkeypatch):
    from uuid import uuid4
    with database.SessionLocal() as db:
        _,_,cls,owner,member,sessions=scene(db)
        pending=report(db,sessions[1],participant(db,member,sessions[1]),'pending_review');db.commit();api=http(db,monkeypatch)
        path=f'/api/v1/reports/{pending.id}';headers=bearer(owner)
        pend=api.get(path,headers=headers);assert pend.status_code==200,pend.text  # 승인 전 본인 리포트: 404 대신 '리뷰 중' 마스킹 200
        assert pend.json()['in_review'] is True and pend.json()['pdf_url'] is None
        assert api.get(f'/api/v1/reports/{uuid4()}',headers=headers).status_code==404
        pending.status='completed';db.commit();result=api.get(path,headers=headers)
        assert result.status_code==200,result.text
        assert result.json()['pdf_url'] is None and '/private' not in result.text
