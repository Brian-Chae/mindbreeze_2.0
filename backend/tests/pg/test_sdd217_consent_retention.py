"""T08: 가입 원동의·회차 사본·철회·보관의 실제 PG 검증."""
from datetime import date, timedelta
from uuid import UUID, uuid4
import pytest
from fastapi import HTTPException
from app.models.class_program import ClassMember
from app.models.class_membership import ClassMemberConsentEvent
from app.models.research import ResearchConsent, ResearchConsentEvent
from app.models.session import Session, SessionParticipant
from app.models.user import User
from tests.pg.test_sdd217_guests import setup, join, command, NOW
pytestmark = pytest.mark.pg


def service():
    from app.services import class_member_consent_service
    return class_member_consent_service


def participant(db, session, member):
    return db.query(SessionParticipant).filter_by(session_id=session.id, member_id=UUID(member)).one()


def member_join(db, cls, *, actor=None, report_included=False, **choices):
    """합성 회원의 실제 코드 가입·본인 선택 경로. guest 토큰을 회원에 붙이지 않는다."""
    from tests.pg.sdd216_helpers import user
    from sqlalchemy import text
    from app.services.class_code_service import join_class_code
    if actor is None:
        actor = user(db, role='client')
        # 전체 PG 수집 중 로드되는 SQLite ARRAY 변환기와 무관하게 실제 PG 배열을 저장한다.
        db.execute(text("""INSERT INTO client_profiles
            (id, user_id, birth_date, gender, concerns, interests)
            VALUES (:id, :user_id, :birth_date, 'other', ARRAY[]::varchar[], ARRAY[]::varchar[])"""),
            {'id': uuid4(), 'user_id': actor.id, 'birth_date': date(2000, 1, 1)})
        db.commit()
    joined = join_class_code(db, cls.id, actor.id, '0217', now=NOW)
    service().update_consents(db, cls.id,
        command(cls, report_included_default=report_included, **choices), user_id=actor.id, now=NOW)
    return {'member': {'id': joined['member_id']}, 'auth': {'user_id': actor.id}}


def consented_subject(db, cls, kind):
    if kind == 'member':
        return member_join(db, cls, research_consented=True, research_notice_version='r5-1')
    # D3 이전 저장된 비회원 원본과 사본만 명시적으로 재현한다. 신규 생성 서비스를 우회해 허용하지 않는다.
    joined = join(db, cls)
    member = db.get(ClassMember, UUID(joined['member']['id']))
    member.research_consented = True
    member.research_notice_version = 'r5-1'
    member.research_selected_at = NOW
    member.research_origin_id = uuid4()
    for row in db.query(SessionParticipant).filter_by(member_id=member.id).all():
        row.research_origin_id = member.research_origin_id
        db.add(ResearchConsent(session_id=row.session_id, participant_id=row.id, consented=True,
            notice_version='r5-1', consented_at=NOW, origin_id=member.research_origin_id,
            research_subject_id='a' * 64, key_version=1, birth_year_month='2000-01',
            gender='other', export_state='pending'))
        db.add(ResearchConsentEvent(session_id=row.session_id, participant_id=row.id,
            event_type='consented', previous_consented=False, new_consented=True,
            notice_version='r5-1', actor_kind='self', created_at=NOW))
    db.commit()
    joined['auth'] = {'member_credential': joined['credential_bundle']['read_credential']}
    return joined


def test_v20_default_false_and_optional_entry(pg_session):
    from app.services.class_guest_service import guest_entry
    db=pg_session; _,_,cls,s=setup(db); j=join(db,cls); mid=j['member']['id']; token=j['credential_bundle']['activity_credential']
    view=service().get_consents(db,cls.id,member_credential=token)
    assert view['report_included_default'] is False and view['research_consented'] is False and view['reminder_opt_in'] is False
    p=participant(db,s,mid); assert p.report_included is False
    assert db.query(ResearchConsent).filter_by(participant_id=p.id).count()==0
    s.status='open'; db.commit()
    assert guest_entry(db,cls.id,s.id,token,command(cls),now=NOW)['participant_id']==str(p.id)


def test_v22_join_choice_evidence_and_future_copy(pg_session):
    db=pg_session; _,_,cls,s=setup(db)
    j=member_join(db,cls,research_consented=True,research_notice_version='r5-1',report_included=True,notice_version='class-team-v1')
    m=db.get(ClassMember,UUID(j['member']['id'])); p=participant(db,s,j['member']['id'])
    assert p.user_id == m.user_id == j['auth']['user_id']
    assert p.report_included and p.research_origin_id==m.research_origin_id
    c=db.query(ResearchConsent).filter_by(participant_id=p.id).one()
    assert c.birth_year_month=='2000-01' and c.gender=='other'
    assert c.consented and c.notice_version=='r5-1' and c.consented_at==m.research_selected_at==NOW and c.origin_id==m.research_origin_id
    event=db.query(ClassMemberConsentEvent).filter_by(member_id=m.id,choice='research').one()
    assert event.value and event.origin_id==c.origin_id
    assert db.query(ResearchConsentEvent).filter_by(participant_id=p.id,event_type='consented').count()==1


def test_v21_future_only_override_and_historical_preserved(pg_session):
    db=pg_session; _,_,cls,s=setup(db); j=member_join(db,cls,research_consented=True,research_notice_version='r5-1')
    mid=j['member']['id']; p=participant(db,s,mid); p.report_consent_override=True; p.research_consent_override=True
    p.report_included=True
    historical=Session(type='meditation',class_id=cls.id,host_id=s.host_id,seq=2,status='completed',host_state='assigned',ended_at=NOW,duration_min=60)
    entered=Session(type='meditation',class_id=cls.id,host_id=s.host_id,seq=3,status='open',host_state='assigned',duration_min=60)
    future=Session(type='meditation',class_id=cls.id,host_id=s.host_id,seq=4,status='scheduled',host_state='assigned',scheduled_at=NOW+timedelta(days=2),duration_min=60)
    db.add_all([historical,entered,future]); db.flush()
    from app.services.class_membership_service import ensure_expected
    m=db.get(ClassMember,UUID(mid)); ensure_expected(db,cls,[entered,future],[m])
    ep=participant(db,entered,mid); ep.entered_at=NOW
    hp=SessionParticipant(session_id=historical.id,member_id=m.id,user_id=m.user_id,report_included=True,attendance_status='attended',entered_at=NOW)
    db.add(hp);db.flush();service().copy_member_defaults(db,m,hp,report=False);db.commit()
    result=service().update_consents(db,cls.id,command(cls,report_included_default=False,research_consented=False),**j['auth'],now=NOW)
    assert p.report_included and db.query(ResearchConsent).filter_by(participant_id=p.id).one().consented
    assert hp.report_included and ep.research_origin_id==m.research_origin_id
    assert db.query(ResearchConsent).filter_by(participant_id=hp.id).one().consented
    assert db.query(ResearchConsent).filter_by(participant_id=ep.id).one().consented
    fp=participant(db,future,mid); assert not fp.report_included and not db.query(ResearchConsent).filter_by(participant_id=fp.id).one().consented
    assert result['updated_future_participant_ids']==[str(fp.id)]


@pytest.mark.parametrize('subject_kind', ['member', 'legacy_guest'])
def test_v39_explicit_withdrawal_reaches_ended_and_preserves_evidence(pg_session, subject_kind):
    db=pg_session; _,_,cls,s=setup(db);j=consented_subject(db,cls,subject_kind);p=participant(db,s,j['member']['id'])
    m=db.get(ClassMember,UUID(j['member']['id'])); origin=m.research_origin_id;s.status='completed';s.ended_at=NOW;p.entered_at=NOW;p.attendance_status='attended';m.status='completed';m.completed_at=NOW;db.commit()
    result=service().withdraw_research(db,cls.id,command(cls,reason='본인 철회'),**j['auth'],now=NOW)
    c=db.query(ResearchConsent).filter_by(participant_id=p.id).one()
    assert result['affected_count']==1 and not c.consented and c.export_state=='withdrawn' and c.withdrawn_at==NOW
    assert c.origin_id==p.research_origin_id==origin and c.consented_at==NOW
    assert db.query(ResearchConsentEvent).filter_by(participant_id=p.id,event_type='consented').count()==1
    assert db.query(ResearchConsentEvent).filter_by(participant_id=p.id,event_type='withdrawn').count()==1


def test_v23_canonical_scrub_boundary_active_and_no_resurrection(pg_session):
    from app.services.class_guest_service import preview_merge, merge_guests
    db=pg_session;host,_,cls,s=setup(db);a=join(db,cls);b=join(db,cls)
    preview=preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='동일인 확인')
    merge_guests(db,host.id,cls.id,command(cls,source_member_id=a['member']['id'],target_member_id=b['member']['id'],confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='확인'),now=NOW)
    m=db.get(ClassMember,UUID(b['member']['id']));m.status='left';m.left_at=NOW
    rows=db.query(SessionParticipant).filter_by(session_id=s.id).all()
    for p in rows:p.report_email_status='pending'
    rows[0].attendance_status='attended';s.status='completed';s.ended_at=NOW+timedelta(days=1)
    db.commit()
    assert service().scrub_expired_guests(db,now=NOW+timedelta(days=91)-timedelta(microseconds=1))['members']==0
    rep=service().scrub_expired_guests(db,now=NOW+timedelta(days=91));db.commit()
    assert rep['members']==2 and rep['participants']==2
    for row in [m,db.get(ClassMember,UUID(a['member']['id'])),*rows]:
        assert row.pii_scrubbed_at and all(getattr(row,f) is None for f in ('guest_name','gender','birth_date','report_email'))
    assert all(p.report_email_status=='cancelled' for p in rows)
    future=Session(type='meditation',class_id=cls.id,host_id=s.host_id,host_state='assigned',seq=2,status='scheduled',scheduled_at=NOW+timedelta(days=100),duration_min=60)
    db.add(future);db.flush()
    from app.services.class_membership_service import ensure_expected
    ensure_expected(db,cls,[future],[m]);new=participant(db,future,str(m.id))
    assert new.pii_scrubbed_at and new.guest_name is None and new.report_email is None
    # 활동 중 / 종료 시각 없는 종료 상태는 created_at으로 추정하지 않는다.
    m.status='active';m.pii_scrubbed_at=None;m.guest_name='보존';m.left_at=None;rows[0].attendance_status='expected';db.commit()
    assert service().scrub_expired_guests(db,now=NOW+timedelta(days=1000))['members']==0
    m.status='completed';m.completed_at=None;db.commit()
    assert service().scrub_expired_guests(db,now=NOW+timedelta(days=1000))['members']==0


def test_v24_rotate_old_code_rejected_existing_grant_and_reminder(pg_session):
    from app.services.class_guest_service import authenticate_guest
    from app.services.reminder_service import reminder_recipients
    db=pg_session;host,_,cls,s=setup(db);j=join(db,cls);token=j['credential_bundle']['read_credential'];old=cls.access_code
    body=command(cls);result=service().rotate_access_code(db,cls.id,host.id,body)
    assert result['access_code']!=old and len(result['access_code'])==4
    assert service().rotate_access_code(db,cls.id,host.id,body)==result
    with pytest.raises(HTTPException):join(db,cls)
    assert authenticate_guest(db,cls.id,token,now=NOW)[0].id==UUID(j['member']['id'])
    assert reminder_recipients(s,db)==[]


def test_real_http_login_guest_scope_and_payload(pg_session,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.v1 import class_membership
    from app.core.database import get_db
    from app.core.redis import get_redis
    from app.core.security import create_access_token
    from app.config import settings
    from tests.pg.sdd216_helpers import user
    from app.services.class_code_service import join_class_code
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    db=pg_session;host,other,cls,s=setup(db);j=join(db,cls);u=user(db,role='client');db.commit();join_class_code(db,cls.id,u.id,'0217',now=NOW)
    app=FastAPI();app.include_router(class_membership.router,prefix='/api/v1');app.dependency_overrides[get_db]=lambda:db
    with TestClient(app) as client:
        path=f'/api/v1/classes/{cls.id}/me/consents'
        assert client.get(path).status_code==401
        read={'X-Class-Member-Credential':j['credential_bundle']['read_credential']}
        assert client.get(path,headers=read).status_code==200
        assert client.put(path,json=command(cls,report_included_default=True,notice_version='class-team-v1'),headers=read).status_code==401
        active={'X-Class-Member-Credential':j['credential_bundle']['activity_credential']}
        response=client.put(path,json=command(cls,research_consented=True),headers=active)
        assert response.status_code==403 and response.json()['detail']['code']=='guest_research_not_applicable'
        assert client.put(path,json=command(cls,research_consented=True,research_notice_version='r5-1',extra='bad'),headers=active).status_code==422
        response=client.put(path,json=command(cls,research_consented=True,research_notice_version='r5-1'),headers=active)
        assert response.status_code==403 and response.json()['detail']['code']=='guest_research_not_applicable'
        assert db.query(ResearchConsent).filter_by(participant_id=participant(db,s,j['member']['id']).id).count()==0
        login={'Authorization':'Bearer '+create_access_token(str(u.id))}
        assert client.get(path,headers=login).json()['member_id']!=j['member']['id']
        response=client.put(path,json=command(cls,research_consented=True),headers=login)
        assert response.status_code==422 and response.json()['detail']['code']=='invalid_notice_version'
        response=client.put(path,json=command(cls,research_consented=True,research_notice_version='r5-1'),headers=login)
        assert response.status_code==200,response.text
        assert 'research_subject_id' not in response.text and response.json()['consents']['research_consented']
        mp=db.query(SessionParticipant).filter_by(session_id=s.id,user_id=u.id).one()
        assert db.query(ResearchConsent).filter_by(participant_id=mp.id).one().consented
        assert client.put(path,json=command(cls,reminder_opt_in=True),headers=login).status_code==200
        other_auth={'Authorization':'Bearer '+create_access_token(str(other.id))}
        assert client.get(path,headers=other_auth).status_code in (403,404)
        assert client.post(f'/api/v1/classes/{cls.id}/access-code/rotate',json=command(cls),headers=login).status_code==403
        withdrawal=f'/api/v1/classes/{cls.id}/me/research-withdrawal'
        assert client.post(withdrawal,json=command(cls,reason='철회'),headers=read).status_code==200


def test_scrubbed_report_resend_cannot_restore_email(pg_session,monkeypatch):
    from app.models.record import Report
    from app.services import report_email_service
    db=pg_session;_,_,cls,s=setup(db);j=join(db,cls);p=participant(db,s,j['member']['id']);p.report_included=True;p.pii_scrubbed_at=NOW;p.report_email=None
    report=Report(session_id=s.id,participant_id=p.id,type='client',status='completed',content={});db.add(report);db.commit()
    sent=[];monkeypatch.setattr(report_email_service,'send_report_email',lambda *args:sent.append(args) or True)
    with pytest.raises(HTTPException) as e:report_email_service.resend_report_email(str(report.id),'synthetic@example.com',db)
    assert e.value.status_code==409 and not sent and p.report_email is None


def test_makeup_new_participant_copies_origin_and_pii(pg_session):
    from app.services.class_guest_service import guest_makeup
    db=pg_session;_,_,cls,s=setup(db);j=join(db,cls,research_consented=True,research_notice_version='r5-1');mid=j['member']['id'];p=participant(db,s,mid);p.attendance_status='excused'
    future=Session(type='meditation',class_id=cls.id,host_id=s.host_id,host_state='assigned',seq=2,status='scheduled',session_kind='makeup',scheduled_at=NOW+timedelta(days=2),duration_min=60,max_participants=8)
    db.add(future);db.commit()
    guest_makeup(db,cls.id,j['credential_bundle']['activity_credential'],command(cls,member_id=mid,source_session_id=str(s.id),target_session_id=str(future.id)),now=NOW)
    cp=participant(db,future,mid)
    assert cp.guest_name==p.guest_name and cp.research_origin_id==p.research_origin_id
    assert cp.guest_name is not None and cp.birth_date == p.birth_date and cp.report_email == p.report_email
    assert cp.research_origin_id is None
    assert db.query(ResearchConsent).filter_by(participant_id=cp.id).count() == 0


def test_class_withdrawal_same_subject_other_class_and_export_unchanged(pg_session,monkeypatch):
    from app.config import settings
    from app.models.research import ResearchWithdrawalRequest
    from app.services.research_export_service import _pending_consents
    monkeypatch.setattr(settings,'research_id_key_v1','synthetic-test-key')
    db=pg_session;_,_,a,sa=setup(db);ja=member_join(db,a,research_consented=True,research_notice_version='r5-1');pa=participant(db,sa,ja['member']['id'])
    a.access_code='0218';db.commit()
    _,_,b,sb=setup(db);jb=member_join(db,b,actor=db.get(User,ja['auth']['user_id']),research_consented=True,research_notice_version='r5-1');pb=participant(db,sb,jb['member']['id'])
    ca=db.query(ResearchConsent).filter_by(participant_id=pa.id).one();cb=db.query(ResearchConsent).filter_by(participant_id=pb.id).one()
    assert ca.research_subject_id==cb.research_subject_id and _pending_consents(db,sa.id)==[ca] and _pending_consents(db,sb.id)==[cb]
    service().withdraw_research(db,a.id,command(a,reason='이 클래스만 철회'),**ja['auth'],now=NOW)
    assert not _pending_consents(db,sa.id) and _pending_consents(db,sb.id)==[cb] and cb.consented
    assert db.query(ResearchWithdrawalRequest).count()==0
    assert not __import__('app.services.research_consent_service',fromlist=['_withdrawn_subject'])._withdrawn_subject(cb.research_subject_id,cb.key_version,db)


@pytest.mark.parametrize('subject_kind', ['member', 'legacy_guest'])
def test_withdrawal_hidden_removed_copy_and_default_false_keep_withdrawn(pg_session, subject_kind):
    db=pg_session;_,_,cls,s=setup(db);j=consented_subject(db,cls,subject_kind);mid=j['member']['id'];p=participant(db,s,mid)
    s.hidden_at=NOW;p.removed_at=NOW;db.commit()
    result=service().withdraw_research(db,cls.id,command(cls,reason='숨김 회차도 철회'),**j['auth'],now=NOW)
    assert result['affected_count']==1
    c=db.query(ResearchConsent).filter_by(participant_id=p.id).one();assert c.export_state=='withdrawn'
    service().copy_member_defaults(db,db.get(ClassMember,UUID(mid)),p)
    assert c.export_state=='withdrawn' and c.withdrawn_at==NOW


def test_explicit_session_same_value_marks_override(pg_session):
    from app.services.class_guest_service import guest_entry
    from app.services.research_consent_service import set_own_consent
    from app.services.session_service import set_report_choice
    db=pg_session;_,_,cls,s=setup(db);j=join(db,cls);mid=j['member']['id'];p=participant(db,s,mid);s.status='open';db.commit()
    entered=guest_entry(db,cls.id,s.id,j['credential_bundle']['activity_credential'],command(cls),now=NOW)
    # 동일 false도 명시 회차 선택이므로 이후 가입 기본값과 독립이다.
    assert not set_own_consent(str(s.id),False,db,entry_credential=entered['entry_credential'])['changed']
    assert not set_report_choice(str(s.id),str(p.id),False,db,entry_credential=entered['entry_credential'])['changed']
    assert p.research_consent_override and p.report_consent_override


def test_scrubbed_request_and_pending_delivery_no_email(pg_session,monkeypatch):
    from types import SimpleNamespace
    from app.models.record import Report
    from app.services import report_email_service as mail
    db=pg_session;_,_,cls,s=setup(db);j=join(db,cls);p=participant(db,s,j['member']['id']);s.status='completed';p.report_included=True;p.pii_scrubbed_at=NOW;p.report_email='stale@example.com'
    report=Report(session_id=s.id,participant_id=p.id,type='client',status='completed',content={});db.add(report);db.commit()
    sent=[];monkeypatch.setattr(mail,'send_report_email',lambda *args:sent.append(args) or True)
    assert mail.deliver_report_email(str(report.id),db)=='unavailable'
    payload=SimpleNamespace(participant_id=p.id,participant_token=mail.participant_token(p),email='restored@example.com',email_verify_token=None)
    with pytest.raises(HTTPException) as e:mail.request_report_email(s.id,payload,db,None)
    assert e.value.status_code==409 and not sent and p.report_email=='stale@example.com'


def test_v23_scrub_transaction_failure_and_existing_sweep_active_preserved(pg_session,monkeypatch):
    from sqlalchemy import event
    from app.config import settings
    from app.services.retention_sweep_service import run_retention_sweep
    db=pg_session;_,_,cls,s=setup(db);j=join(db,cls);m=db.get(ClassMember,UUID(j['member']['id']));p=participant(db,s,str(m.id))
    m.status='left';m.left_at=NOW;p.attendance_status='attended';s.status='completed';s.ended_at=NOW;db.commit()
    def fail(session,context,instances):
        if any(isinstance(row,ClassMember) and row.pii_scrubbed_at is not None for row in session.dirty):
            raise RuntimeError('합성 스크럽 저장 실패')
    event.listen(db,'before_flush',fail)
    try:
        with pytest.raises(RuntimeError):service().scrub_expired_guests(db,now=NOW+timedelta(days=90))
        db.rollback()
    finally:event.remove(db,'before_flush',fail)
    db.refresh(m);db.refresh(p)
    assert m.guest_name and p.guest_name and m.pii_scrubbed_at is None and p.pii_scrubbed_at is None
    m.status='active';m.left_at=None;db.commit()
    monkeypatch.setattr(settings,'retention_sweep_enabled',True);monkeypatch.setattr(settings,'retention_apply_from','2026-01-01')
    rep=run_retention_sweep(db,now=NOW+timedelta(days=100),dry_run=False)
    assert rep['guest_pii']['class_members']['members']==0 and p.guest_name and m.guest_name


@pytest.mark.parametrize('subject_kind', ['member', 'legacy_guest'])
def test_class_withdrawal_cancels_existing_uploaded_batch_without_global_request(pg_session,monkeypatch,subject_kind):
    from app.config import settings
    from app.models.research_export import ResearchExportBatch,ResearchExportItem
    from app.services import research_export_service as export
    monkeypatch.setattr(settings,'research_id_key_v1','synthetic-test-key')
    db=pg_session;_,_,cls,s=setup(db);j=consented_subject(db,cls,subject_kind);p=participant(db,s,j['member']['id']);c=db.query(ResearchConsent).filter_by(participant_id=p.id).one();c.export_state='exported'
    batch=ResearchExportBatch(session_id=s.id,status='uploaded',prefix='synthetic/');db.add(batch);db.flush()
    db.add(ResearchExportItem(batch_id=batch.id,consent_id=c.id,research_subject_id=c.research_subject_id,content_sha256='0'*64,rows={}));db.commit()
    service().withdraw_research(db,cls.id,command(cls,reason='배치 철회'),**j['auth'],now=NOW)
    cleaned=[];monkeypatch.setattr(export,'_cleanup_objects',lambda paths:cleaned.extend(paths))
    assert export.cancel_batches_for_withdrawn(db)==1 and batch.status=='cancelled' and cleaned


def test_scrubbed_database_state_rechecked_before_resend(pg_session,monkeypatch):
    from sqlalchemy import update
    from app.models.record import Report
    from app.services import report_email_service as mail
    db=pg_session;_,_,cls,s=setup(db);j=join(db,cls);p=participant(db,s,j['member']['id']);p.report_included=True
    r=Report(session_id=s.id,participant_id=p.id,type='client',status='completed',content={});db.add(r);db.commit()
    # 이미 읽은 ORM 객체가 남아 있어도 실제 DB 스크럽 상태를 재검사해야 한다.
    db.execute(update(SessionParticipant).where(SessionParticipant.id==p.id).values(pii_scrubbed_at=NOW,report_email=None).execution_options(synchronize_session=False))
    sent=[];monkeypatch.setattr(mail,'send_report_email',lambda *args:sent.append(args) or True)
    with pytest.raises(HTTPException) as e:mail.resend_report_email(str(r.id),'restored@example.com',db)
    assert e.value.status_code==409 and not sent


def test_research_notice_cannot_rewrite_original_selection_without_choice(pg_session):
    db=pg_session;_,_,cls,s=setup(db);j=member_join(db,cls,research_consented=True,research_notice_version='r5-1');m=db.get(ClassMember,UUID(j['member']['id']));origin=m.research_origin_id
    with pytest.raises(HTTPException) as e:service().update_consents(db,cls.id,command(cls,research_notice_version='r5-2'),**j['auth'],now=NOW)
    assert e.value.status_code==422 and m.research_notice_version=='r5-1' and m.research_origin_id==origin
    service().update_consents(db,cls.id,command(cls,research_consented=True,research_notice_version='r5-2'),**j['auth'],now=NOW+timedelta(seconds=1))
    assert m.research_origin_id!=origin and m.research_selected_at==NOW+timedelta(seconds=1)
    assert db.query(ClassMemberConsentEvent).filter_by(member_id=m.id,choice='research',value=True).count()==2


def test_scrub_exact_member_operation_results_preserve_independent_invite(pg_session):
    from app.models.class_scheduling import ClassOperation
    from app.models.class_membership import ClassMemberOperation
    db=pg_session;host,_,cls,s=setup(db);j=join(db,cls);m=db.get(ClassMember,UUID(j['member']['id']));p=participant(db,s,str(m.id));m.status='left';m.left_at=NOW
    payload={'member':{'id':str(m.id),'name':m.guest_name,'report_email':m.report_email},'invite':{'id':str(uuid4()),'email':m.report_email},'unrelated':{'id':str(uuid4()),'name':'다른 사람'}}
    op=ClassOperation(actor_id=host.id,class_id=cls.id,operation_key=str(uuid4()),request_hash='0'*64,result=payload)
    guest_op=ClassMemberOperation(member_id=m.id,operation_key=str(uuid4()),request_hash='1'*64,result={'member_id':str(m.id),'guest_name':m.guest_name,'report_email':m.report_email})
    db.add_all([op,guest_op]);db.commit()
    service().scrub_expired_guests(db,now=NOW+timedelta(days=90));db.commit();db.refresh(op);db.refresh(guest_op)
    assert op.result['member']['name'] is None and op.result['member']['report_email'] is None
    assert op.result['invite']['email']=='synthetic@example.com' and op.result['unrelated']['name']=='다른 사람'
    assert guest_op.result['guest_name'] is None and guest_op.result['report_email'] is None


def test_fix1_merge_recent_source_into_old_left_target_retains_until_alias_end_plus90(pg_session):
    from app.services.class_guest_service import preview_merge, merge_guests
    db=pg_session;host,_,cls,s=setup(db);source=join(db,cls);target=join(db,cls)
    src=db.get(ClassMember,UUID(source['member']['id']));dst=db.get(ClassMember,UUID(target['member']['id']))
    dst.status='left';dst.left_at=NOW-timedelta(days=91);db.commit()
    preview=preview_merge(db,host.id,cls.id,src.id,dst.id,reason='동일인 확인')
    merge_guests(db,host.id,cls.id,command(cls,source_member_id=str(src.id),target_member_id=str(dst.id),confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='최근 가입 원본 병합'),now=NOW)
    assert src.status=='removed' and src.removed_at==NOW and dst.left_at==NOW-timedelta(days=91)
    copies=db.query(SessionParticipant).filter_by(session_id=s.id).execution_options(include_removed=True).all()
    for instant in (NOW,NOW+timedelta(days=90)-timedelta(microseconds=1)):
        rep=service().scrub_expired_guests(db,now=instant);db.commit()
        assert rep['members']==0 and rep['participants']==0
        assert all(row.guest_name and row.pii_scrubbed_at is None for row in [src,dst,*copies])
    rep=service().scrub_expired_guests(db,now=NOW+timedelta(days=90));db.commit()
    assert rep['members']==2 and rep['participants']==2
    assert all(row.guest_name is None and row.pii_scrubbed_at==NOW+timedelta(days=90) for row in [src,dst,*copies])


@pytest.mark.parametrize('alias_status',['active','removed'])
def test_fix1_canonical_alias_without_end_defers_scrub_without_date_guess(pg_session,alias_status):
    db=pg_session;_,_,cls,s=setup(db);a=join(db,cls);b=join(db,cls)
    alias=db.get(ClassMember,UUID(a['member']['id']));canonical=db.get(ClassMember,UUID(b['member']['id']))
    canonical.status='left';canonical.left_at=NOW-timedelta(days=100)
    alias.canonical_member_id=canonical.id;alias.status=alias_status;alias.removed_at=None;db.commit()
    rep=service().scrub_expired_guests(db,now=NOW+timedelta(days=1000));db.commit()
    assert rep['members']==0 and rep['participants']==0
    assert alias.guest_name and canonical.guest_name and alias.pii_scrubbed_at is None and canonical.pii_scrubbed_at is None


def test_guest_join_and_future_copy_exclude_research_even_legacy_default(pg_session):
    from app.services.class_membership_service import ensure_expected
    db=pg_session;_,_,cls,s=setup(db)
    j=join(db,cls,birth_year_month='2018-06',research_consented=True,research_notice_version='r5-1',report_included=True,notice_version='class-team-v1')
    m=db.get(ClassMember,UUID(j['member']['id']));p=participant(db,s,j['member']['id'])
    assert not m.research_consented and m.research_notice_version is None and m.research_origin_id is None
    assert p.report_included and p.guest_name==m.guest_name and p.birth_date==m.birth_date==date(2018,6,1)
    assert db.query(ResearchConsent).filter_by(participant_id=p.id).count()==0
    assert db.query(ResearchConsentEvent).filter_by(participant_id=p.id).count()==0
    event=db.query(ClassMemberConsentEvent).filter_by(member_id=m.id,choice='research').one()
    assert not event.value
    m.research_consented=True;m.research_notice_version='r5-1';m.research_selected_at=NOW;m.research_origin_id=uuid4()
    future=Session(type='meditation',class_id=cls.id,host_id=s.host_id,host_state='assigned',seq=2,status='scheduled',scheduled_at=NOW+timedelta(days=2),duration_min=60)
    db.add(future);db.flush();ensure_expected(db,cls,[future],[m]);db.commit()
    fp=participant(db,future,str(m.id))
    assert fp.research_origin_id is None and fp.guest_name==m.guest_name
    assert db.query(ResearchConsent).filter_by(participant_id=fp.id).count()==0


def test_member_makeup_copies_research_origin_and_consent(pg_session):
    from app.services.class_makeup_service import assign_makeup
    db=pg_session;_,_,cls,s=setup(db)
    j=member_join(db,cls,research_consented=True,research_notice_version='r5-1')
    mid=j['member']['id'];p=participant(db,s,mid);p.attendance_status='excused'
    future=Session(type='meditation',class_id=cls.id,host_id=s.host_id,host_state='assigned',seq=2,status='scheduled',session_kind='makeup',scheduled_at=NOW+timedelta(days=2),duration_min=60,max_participants=8)
    db.add(future);db.commit()
    assign_makeup(db,j['auth']['user_id'],cls.id,command(cls,member_id=mid,source_session_id=str(s.id),target_session_id=str(future.id)),now=NOW)
    cp=participant(db,future,mid)
    consent=db.query(ResearchConsent).filter_by(participant_id=cp.id).one()
    assert cp.user_id==p.user_id and cp.research_origin_id==p.research_origin_id
    assert consent.consented and consent.origin_id==p.research_origin_id and consent.consented_at==NOW
