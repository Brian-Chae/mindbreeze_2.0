"""임시 PostgreSQL의 실제 원장·영수증·정책 서비스 검증."""
from types import SimpleNamespace
import pytest
from app.config import settings
from app.services import storage_service
from tests.test_sdd244_policy import (test_v3_실제_생성부터_수신_ACK까지,
    test_동일revision이어도_실제_전송목록에_없는_hash는_보류,
    test_v3_철회는_실제_staging경로를_outbox에_기록,
    test_90일_신호별_보류와_rawderived_outbox_재시도,
    test_90일_정확한_경계와_ACK일로_연장안함,
    test_v2_EEG_삭제시_file_count도_실제_남은_EEG로_갱신,
    test_재시작후_in_progress_lease_만료시_삭제재시도)

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


def test_철회_commit과_ACK가_경합하면_철회가_반출을_차단(pg_engine):
    """독립 연결 두 개의 실제 row lock 경합. 데이터는 /tmp 테스트 DB에만 남는다."""
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from sqlalchemy import event
    from sqlalchemy.orm import Session as OrmSession
    from app.models.session import Session
    from app.models.class_program import Class,ClassInstructor
    from app.models.research import ResearchConsent
    from app.services import research_export_service as service
    from tests.test_sdd244_policy import signal_batch
    from fastapi import HTTPException
    import uuid
    from sqlalchemy import text
    from app.core.database import Base
    schema='race_'+uuid.uuid4().hex
    with pg_engine.begin() as conn: conn.execute(text('CREATE SCHEMA '+schema))
    race_engine=pg_engine.execution_options(schema_translate_map={None:schema})
    Base.metadata.create_all(race_engine)
    with OrmSession(race_engine) as seed:
        def parents(session,context,instances):
            for obj in list(session.new):
                if isinstance(obj,Session) and obj.class_id is None:
                    cid=uuid.uuid4()
                    session.connection().execute(Class.__table__.insert().values(id=cid,created_by=obj.host_id,default_duration_min=10))
                    session.connection().execute(ClassInstructor.__table__.insert().values(class_id=cid,user_id=obj.host_id))
                    obj.class_id=cid;obj.seq=1;obj.host_state='assigned'
        event.listen(seed,'before_flush',parents)
        s,p,c,b,r,scope=signal_batch(seed)
        cid,bid=c.id,b.id
    started=Event()
    def ack():
        with OrmSession(race_engine) as reader:
            started.set()
            try: service.ack_signal_batch(reader,str(bid),'b'*64,[scope])
            except HTTPException as exc: return exc.status_code
            return 200
    with OrmSession(race_engine) as writer:
        consent=writer.query(ResearchConsent).filter_by(id=cid).with_for_update().one()
        consent.consented=False
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(ack)
            assert started.wait(5)
            writer.commit()
            assert future.result(timeout=10)==409
