"""신규 응답 모델이 기존 DTO 필드와 문자열 표현을 보존하는지 HTTP 경계에서 검증한다."""
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.mark.parametrize('kind', ['attendance', 'participation', 'guest-entry'])
def test_신규_응답모델은_DTO_필드와_null_시간문자열을_보존한다(monkeypatch, kind):
    from app.api.deps import get_current_user_optional
    from app.api.v1 import class_guests, class_membership
    from app.config import settings
    from app.core.database import get_db
    from app.services import class_attendance_service, class_guest_service, class_participation_service

    cid, sid, mid, pid = (str(uuid4()) for _ in range(4))
    timestamp = '2026-10-20T03:00:00+00:00'
    base = {'class_id': cid, 'revision': 4}
    participant = {
        'id': pid, 'session_id': sid, 'member_id': mid, 'canonical_member_id': mid,
        'attendance_status': 'excused', 'attendance_kind': 'regular',
        'entered_at': None, 'makeup_for_session_id': None, 'makeup_assignment_id': None,
    }
    payload = {'operation_key': 'response-contract', 'expected_revision': 3}
    path = f'/api/v1/classes/{cid}/sessions/{sid}'
    if kind == 'attendance':
        expected = {**base, 'participant': participant, 'participation_version': 7}
        monkeypatch.setattr(class_attendance_service, 'change_attendance', lambda *a, **kw: expected)
        path += f'/members/{mid}/attendance'
        payload.update(action='excuse', expected_participation_version=6)
    elif kind == 'guest-entry':
        expected = {**base, 'session_id': sid, 'participant_id': pid,
                    'entry_credential': 'synthetic-entry-credential', 'expires_at': timestamp}
        monkeypatch.setattr(class_guest_service, 'guest_entry', lambda *a, **kw: expected)
        path += '/guest-entry'
    else:
        expected = {'session_id': sid, 'participation_version': 7, 'generated_at': timestamp,
                    'presence_ttl_seconds': 90, 'participants': [{
                        'participant_id': pid, 'member_id': None, 'canonical_member_id': None,
                        'attendance_status': None, 'entered_at': timestamp,
                        'checkin_state': 'unknown', 'checkin_at': None,
                        'presence_state': 'unknown', 'presence_expires_at': None,
                    }]}
        monkeypatch.setattr(class_participation_service, 'snapshot', lambda *a, **kw: expected)
        path += '/participation'
    monkeypatch.setattr(settings, 'class_scheduling_enabled', True)
    app = FastAPI()
    app.include_router(class_membership.router, prefix='/api/v1')
    app.include_router(class_guests.router, prefix='/api/v1')
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_current_user_optional] = lambda: {'id': mid}
    with TestClient(app) as client:
        response = client.get(path) if kind == 'participation' else client.post(
            path, json=payload, headers={'X-Class-Member-Credential': 'synthetic-member'})
    assert response.status_code == 200, response.text
    assert response.json() == expected
