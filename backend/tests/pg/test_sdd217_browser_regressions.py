"""T11 실제 브라우저에서 발견한 운영 SessionLocal 설정의 회귀."""
from uuid import UUID
import pytest
from app.models.class_program import ClassMember
from app.models.class_scheduling import ClassEffect
from app.models.session import SessionParticipant
from tests.pg.test_sdd217_guests import api,setup,join,command,NOW
pytestmark=pytest.mark.pg


def test_recovery_after_merge_uses_production_autoflush_false(pg_session):
    db=pg_session
    db.autoflush=False  # 실제 요청의 SessionLocal과 동일하다.
    host,_,cls,_=setup(db)
    a,b=join(db,cls),join(db,cls)
    preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='합성 본인 확인')
    api().merge_guests(db,host.id,cls.id,command(cls,source_member_id=a['member']['id'],target_member_id=b['member']['id'],confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='합성 본인 확인'),now=NOW)
    issued=api().issue_recovery(db,host.id,cls.id,b['member']['id'],command(cls,identity_confirmed=True,reason='합성 본인 확인'),now=NOW)
    recovered=api().exchange_recovery(db,cls.id,issued['exchange_token'],now=NOW)
    member=db.get(ClassMember,UUID(b['member']['id']))
    assert member.entry_ver==2
    assert api().authenticate_guest(db,cls.id,recovered['credential_bundle']['activity_credential'],now=NOW)[0].id==member.id
    keys=[r.effect_key for r in db.query(ClassEffect).filter(ClassEffect.class_id==cls.id,ClassEffect.effect_key.like(f'guest-revoke:{member.id}:%'))]
    assert set(keys)=={f'guest-revoke:{member.id}:1',f'guest-revoke:{member.id}:2'}


def test_repeated_recovery_increments_member_and_participant_versions(pg_session):
    db=pg_session
    db.autoflush=False
    host,_,cls,s=setup(db)
    joined=join(db,cls);mid=UUID(joined['member']['id'])
    for version in (1,2):
        issued=api().issue_recovery(db,host.id,cls.id,mid,command(cls,identity_confirmed=True,reason='합성 본인 확인'),now=NOW)
        result=api().exchange_recovery(db,cls.id,issued['exchange_token'],now=NOW)
        assert db.get(ClassMember,mid).entry_ver==version
        assert db.query(SessionParticipant).filter_by(session_id=s.id,member_id=mid).one().entry_ver==version
        assert api().authenticate_guest(db,cls.id,result['credential_bundle']['read_credential'],now=NOW)[0].id==mid


def test_merge_recovery_refresh_logout_and_recovery_keep_versions_and_revoke_old_grants(pg_session):
    from fastapi import HTTPException
    db=pg_session;db.autoflush=False
    host,_,cls,s=setup(db);a,b=join(db,cls),join(db,cls)
    mid=UUID(b['member']['id'])
    def rejected(token):
        with pytest.raises(HTTPException) as error:api().authenticate_guest(db,cls.id,token,now=NOW)
        assert error.value.status_code==401
    preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],mid,reason='합성 확인')
    api().merge_guests(db,host.id,cls.id,command(cls,source_member_id=a['member']['id'],target_member_id=str(mid),confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='합성 확인'),now=NOW)
    for joined in (a,b):
        for token in joined['credential_bundle'].values():
            if token and token!=joined['credential_bundle']['expires_at']:rejected(token)
    def recover():
        issued=api().issue_recovery(db,host.id,cls.id,mid,command(cls,identity_confirmed=True,reason='합성 확인'),now=NOW)
        return api().exchange_recovery(db,cls.id,issued['exchange_token'],now=NOW)['credential_bundle']
    first=recover();assert db.get(ClassMember,mid).entry_ver==2
    renewed=api().refresh_guest(db,cls.id,first['read_credential'],now=NOW)['credential_bundle']
    assert db.get(ClassMember,mid).entry_ver==2
    rejected(first['read_credential'])
    assert api().authenticate_guest(db,cls.id,first['activity_credential'],now=NOW)[0].id==mid
    api().logout_guest(db,cls.id,renewed['activity_credential'],now=NOW)
    assert db.get(ClassMember,mid).entry_ver==3
    for token in (first['activity_credential'],renewed['activity_credential'],renewed['read_credential']):rejected(token)
    final=recover();assert db.get(ClassMember,mid).entry_ver==4
    assert api().authenticate_guest(db,cls.id,final['read_credential'],now=NOW)[0].id==mid
    assert db.query(SessionParticipant).filter_by(session_id=s.id,member_id=mid).one().entry_ver==4
