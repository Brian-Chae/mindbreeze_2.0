"""앱 푸시 누락 회귀 — 테스트 DB와 mock 발송기만 사용한다."""
from uuid import UUID
import pytest
from app.models.notification_outbox import NotificationOutbox
from app.models.user import User
from app.services import notification_service as service
from tests import agent_helpers as H

@pytest.mark.parametrize('event,target', [('report_ready', 'report'), ('session_invited', 'session'), ('class_invited', 'class'), ('session_started', 'session')])
def test_general_event_creates_one_private_push(client, event, target):
    user = H.register_client(client, 'push-general@test.com')
    db = H.db()
    extra = service.build_standard_extra(event, target, str(UUID(int=7)))
    service.notify_event(event, user['id'], {'title': '개인 이름', 'body': '상담 비밀', 'extra': extra}, db)
    rows = db.query(NotificationOutbox).filter_by(channel='push').all()
    assert len(rows) == 1
    assert rows[0].status == 'pending'
    assert '개인 이름' not in str(rows[0].payload)
    assert '상담 비밀' not in str(rows[0].payload)
    assert rows[0].payload['deeplink'].startswith('/app/') or rows[0].payload['deeplink'].startswith('/class/')
    db.close()

def test_push_independent_of_in_app_and_obeys_opt_out(client):
    user = H.register_client(client, 'push-prefs@test.com')
    db = H.db()
    row = db.get(User, UUID(user['id']))
    row.notification_preferences = {'in_app': {'report_ready': False}, 'push': {'report_ready': True}}
    db.commit()
    assert service.notify_event('report_ready', user['id'], {}, db) is None
    assert db.query(NotificationOutbox).filter_by(channel='push').count() == 1
    row.notification_preferences = {'push': {'report_ready': False}}
    db.commit()
    service.notify_event('report_ready', user['id'], {}, db)
    assert db.query(NotificationOutbox).filter_by(channel='push').count() == 1
    db.close()

def test_push_transaction_rolls_back_without_dispatch(client, monkeypatch):
    from app.tasks import push_task
    calls = []
    monkeypatch.setattr(push_task, 'dispatch_push_now', lambda: calls.append(True))
    user = H.register_client(client, 'push-tx@test.com')
    db = H.db()
    service.notify_event('report_ready', user['id'], {}, db, commit=False)
    assert db.query(NotificationOutbox).filter_by(channel='push').count() == 1
    assert calls == []
    db.rollback()
    assert db.query(NotificationOutbox).filter_by(channel='push').count() == 0
    db.close()

@pytest.mark.parametrize('event', ['chat_message', 'agent_message', 'risk_signal', 'session_updated', 'session_opened'])
def test_specialized_or_unselected_events_do_not_duplicate_push(client, event):
    user = H.register_client(client, 'push-special@test.com')
    db = H.db()
    service.notify_event(event, user['id'], {}, db)
    assert db.query(NotificationOutbox).filter_by(channel='push').count() == 0
    db.close()

def test_chat_push_respects_preference(client):
    from tests.test_chat import _register, _direct_room, _test_db, _close_db
    host = _register(client, 'push-optout@test.com', role='counselor')
    room_id = _direct_room(client, host, 'push-optout@test.com')
    db_gen, db = _test_db()
    recipient = db.query(User).filter(User.id != UUID(host['id'])).first()
    recipient.notification_preferences = {'push': {'chat_message': False}}
    db.commit()
    response = client.post(f'/api/v1/chat/rooms/{room_id}/messages', json={'content': '상담 비밀', 'type': 'text'}, headers=host['auth'])
    assert response.status_code == 201
    assert db.query(NotificationOutbox).filter_by(channel='push').count() == 0
    _close_db(db_gen)


def test_new_notification_reaches_mock_fcm_without_replaying_terminal_rows(client, monkeypatch):
    from app.services import push_service, web_push_service, device_service
    from app.tasks.push_task import process_push_outbox
    user = H.register_client(client, 'push-consume@test.com')
    db = H.db()
    device_service.register_token(db, user['id'], token='fixture-fcm', platform='ios')
    # 이미 처리된 행은 등록 재시도·새 이벤트 생성으로 재활성화하지 않는다.
    for status in ('skipped', 'failed', 'sent', 'expired'):
        db.add(NotificationOutbox(user_id=UUID(user['id']), channel='push', payload={}, status=status))
    db.commit()
    service.notify_event('report_ready', user['id'], {'extra': service.build_standard_extra('report_ready', 'report', str(UUID(int=9)))}, db)
    calls = []
    def send(token, **kwargs):
        calls.append((token, kwargs))
        return push_service.PushResult(ok=True)
    monkeypatch.setattr(push_service, 'is_configured', lambda: True)
    monkeypatch.setattr(web_push_service, 'is_configured', lambda: False)
    monkeypatch.setattr(push_service, 'send_to_token', send)
    result = process_push_outbox()
    assert result['processed'] == result['sent'] == 1
    assert len(calls) == 1
    assert calls[0][1]['data']['deeplink'] == f'/app/reports?report={UUID(int=9)}'
    db.expire_all()
    assert sorted(r.status for r in db.query(NotificationOutbox).filter_by(channel='push')) == ['expired', 'failed', 'sent', 'sent', 'skipped']
    assert process_push_outbox()['processed'] == 0
    db.close()


@pytest.mark.parametrize('payload,expected', [
    ({'token': 'f' * 163, 'platform': 'ios', 'app_version': '1.0.0'}, 200),
    ({'token': 'f' * 512, 'platform': 'android', 'app_version': '1.0.0-dev'}, 200),
    ({'token': '', 'platform': 'ios'}, 422),
    ({'token': 'f' * 513, 'platform': 'android'}, 422),
    ({'token': 'f' * 163, 'platform': 'iOS'}, 422),
    ({'token': 'f' * 163, 'platform': 'ios', 'app_version': 'v' * 51}, 422),
    ({'token': 'https://fcm.googleapis.com/fixture', 'platform': 'web'}, 422),
])
def test_device_registration_contract_without_real_tokens(client, payload, expected):
    user = H.register_client(client, 'push-contract@test.com')
    response = client.post('/api/v1/devices', json=payload, headers=user['h'])
    assert response.status_code == expected


@pytest.mark.parametrize('role,event,extra,expected', [
    ('counselor', 'report_ready', {'target_id': str(UUID(int=1))}, f'/reports?report={UUID(int=1)}'),
    ('client', 'session_started', {'target_id': str(UUID(int=1))}, f'/class/{UUID(int=1)}/enter'),
    ('client', 'class_invited', {'target_id': str(UUID(int=1)), 'params': {'start_now': True, 'session_id': str(UUID(int=2))}}, f'/class/{UUID(int=2)}/enter'),
    ('client', 'class_invited', {'target_id': str(UUID(int=1)), 'params': {'start_now': True, 'session_id': '../login'}}, f'/app/classes/{UUID(int=1)}'),
    ('counselor', 'session_invited', {'target_id': str(UUID(int=1)), 'params': {'class_id': str(UUID(int=2))}}, f'/classes/{UUID(int=2)}/sessions/{UUID(int=1)}'),
    ('client', 'report_ready', {'target_id': 'https://example.test'}, '/app/notifications'),
])
def test_push_deeplink_is_role_specific_and_rejects_external_target(role, event, extra, expected):
    from types import SimpleNamespace
    assert service._push_deeplink(SimpleNamespace(role=role), event, extra) == expected


@pytest.mark.parametrize('ai_enabled,push_enabled', [(True, True), (False, True), (True, False), (False, False)])
@pytest.mark.parametrize('in_app_enabled', [True, False])
def test_report_approval_has_one_push_owner_and_honors_opt_out(client, monkeypatch, ai_enabled, push_enabled, in_app_enabled):
    from app.config import settings
    from app.services import report_service
    from tests.test_agent_report_chat import _setup
    monkeypatch.setattr(settings, 'ai_features_enabled', ai_enabled)
    monkeypatch.setattr(report_service, '_enqueue_client_email_on_approval', lambda *args: None)
    env = _setup(client, 'push-report-owner')
    db = H.db()
    member = db.get(User, UUID(env['member']['id']))
    member.notification_preferences = {'push': {'report_ready': push_enabled}, 'in_app': {'report_ready': in_app_enabled}}
    db.commit()
    report_id = H.create_report(env['session']['id'], user_id=env['member']['id'], participant_id=H.participant_id_of(env['session'], env['member']['id']), status='pending_review')
    report_service.approve_report(report_id, env['counselor']['id'], db)
    report_service.approve_report(report_id, env['counselor']['id'], db)
    rows = db.query(NotificationOutbox).filter_by(channel='push').all()
    assert len(rows) == (1 if push_enabled else 0)
    if rows:
        assert rows[0].payload['deeplink'] == f'/app/reports?report={report_id}'
        assert rows[0].payload['body'] == '새 알림이 도착했어요. 앱에서 확인해 주세요.'
    db.close()
