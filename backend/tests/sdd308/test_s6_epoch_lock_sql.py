"""SDD-308 3차 — PostgreSQL 잠금 강도·순서를 실행 SQL로 검증한다."""
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql

from app.services.session_live_ledger import lock_epoch
from app.services.session_live_commands import CLASS_LOCK_FIRST_KINDS


class RecordingDB:
    def __init__(self):
        self.statements = []

    def get_bind(self):
        return SimpleNamespace(dialect=postgresql.dialect())

    def execute(self, statement):
        self.statements.append(str(statement.compile(dialect=postgresql.dialect())))
        return SimpleNamespace(scalar_one=lambda: object())


def test_epoch_writer_locks_session_before_epoch():
    db = RecordingDB()
    lock_epoch(db, uuid.uuid4())
    assert 'FROM sessions' in db.statements[0]
    assert db.statements[0].endswith('FOR NO KEY UPDATE')
    assert 'INSERT INTO live_session_epoch' in db.statements[1]
    assert db.statements[2].endswith('FOR UPDATE')


@pytest.mark.parametrize('kind', ['entry.enter', 'session.open', 'session.start', 'session.end', 'session.cancel'])
def test_class_mutating_command_locks_class_first(kind):
    assert kind in CLASS_LOCK_FIRST_KINDS
