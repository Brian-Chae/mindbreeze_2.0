"""임시 PostgreSQL의 실제 원장·영수증·정책 서비스 검증."""
from types import SimpleNamespace
import pytest
from app.config import settings
from app.services import storage_service
from tests.test_sdd244_policy import (test_v3_실제_생성부터_수신_ACK까지,
    test_동일revision이어도_실제_전송목록에_없는_hash는_보류,
    test_v3_철회는_실제_staging경로를_outbox에_기록)

pytestmark=pytest.mark.pg

@pytest.fixture
def db(pg_session):
    from sqlalchemy import event
    from app.models.session import Session
    from app.models.class_program import Class, ClassInstructor
    import uuid
    def parents(session, context, instances):
        for obj in list(session.new):
            if isinstance(obj,Session) and obj.class_id is None:
                cid=uuid.uuid4()
                session.connection().execute(Class.__table__.insert().values(id=cid,created_by=obj.host_id,default_duration_min=10))
                session.connection().execute(ClassInstructor.__table__.insert().values(class_id=cid,user_id=obj.host_id))
                obj.class_id=cid;obj.seq=1;obj.host_state='assigned'
    event.listen(pg_session,'before_flush',parents)
    yield pg_session
    event.remove(pg_session,'before_flush',parents)

@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(settings,'research_export_enabled',True)
    monkeypatch.setattr(settings,'research_id_key_v1','k'*32)

@pytest.fixture
def staging(monkeypatch):
    state=SimpleNamespace(raw={},store={})
    monkeypatch.setattr(storage_service,'download_bytes',lambda key:state.raw.get(key))
    def upload(key,body,**kw): state.store[key]=body;return True
    monkeypatch.setattr(storage_service,'upload_bytes',upload)
    return state
