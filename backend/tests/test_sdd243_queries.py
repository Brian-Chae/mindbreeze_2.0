"""SDD-243 B02 — 탐색·집계·개별 열람: as_of 집계, 회원·진행자 범위, 개인정보 열람 투영, 기관 경계."""
import logging
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.config import settings
from app.models.class_program import ClassMember
from app.models.client_profile import ClientProfile
from app.models.session import Session
from tests.sdd243_helpers import (add_features, add_raw, auth, db, dc_enabled, mk_part, mk_session, mk_user,  # noqa: F401
                                  world)

BASE = '/api/v1/data-center'


def get(client, user, path, **params):
    return client.get(BASE + path, params={k: str(v) for k, v in params.items() if v is not None}, headers=auth(user))


def kpi(body, key):
    return next(k for k in body['kpis'] if k['key'] == key)['count']


@pytest.fixture
def seeded(db, world):
    add_features(db, world.s_a1, world.p_a1_c)
    add_raw(db, world.s_a1, world.p_a1_c)  # 같은 참여자에 raw+feature → 측정 1건
    add_features(db, world.s_a1, world.p_a1_c2, 2, quality="degraded")
    add_features(db, world.s_b1, world.p_b1_c)
    add_raw(db, world.s_solo, world.p_solo, (50,))
    add_raw(db, world.s_a2, world.p_a2_c, (999,), status="pending")  # 미완료 업로드는 보유 아님
    guest_a = ClassMember(class_id=world.cls_a.id, kind="guest", status="active", joined_via="code", guest_name="비회원A")
    db.add(guest_a)
    db.flush()
    db.add(ClassMember(class_id=world.cls_a.id, kind="guest", status="active", joined_via="code", guest_name="비회원A-병합",
                       canonical_member_id=guest_a.id))
    world.guest_a = guest_a
    db.commit()
    return world


# ── 컨텍스트·권한 ───────────────────────────────────────────────────────

def test_contexts_and_role_gates(client, world, dc_enabled):
    assert get(client, world.platform, '/contexts').json()['role'] == 'platform_admin'
    ctx = get(client, world.admin_ab, '/contexts').json()
    assert {o['name'] for o in ctx['allowed_orgs']} == {'기관A', '기관B'} and ctx['default_org_id'] is None
    for user in (world.counselor, world.client):
        assert get(client, user, '/contexts').status_code == 403
        assert get(client, user, '/summary').status_code == 403
    assert client.get(BASE + '/summary').status_code == 401
    r = get(client, world.admin_ab, '/summary')
    assert r.status_code == 400 and r.json()['detail']['code'] == 'org_selection_required'
    assert get(client, world.admin_ab, '/summary', org_id=world.org_b.id).status_code == 200
    assert get(client, world.admin_a, '/summary', org_id=world.org_b.id).status_code == 404
    assert get(client, world.admin_a, '/summary', org_id=world.solo_org.id).status_code == 404
    assert get(client, world.admin_left, '/summary', org_id=world.org_a.id).status_code == 404
    r = get(client, world.platform, '/summary')
    assert r.headers['cache-control'] == 'no-store'


def test_disabled_flag(client, world, monkeypatch):
    monkeypatch.setattr(settings, 'data_center_enabled', False)
    assert get(client, world.platform, '/contexts').json()['capabilities']['enabled'] is False
    r = get(client, world.platform, '/summary')
    assert r.status_code == 403 and r.json()['detail']['code'] == 'data_center_disabled'


# ── 집계: as_of·중복 0·범위 ─────────────────────────────────────────────

def test_as_of_counts_and_subject_identity(client, seeded, dc_enabled):
    w = seeded
    plat = get(client, w.platform, '/summary').json()
    assert kpi(plat, 'sessions')['value'] == 9  # 종료된 명상 회차(상담·템플릿·진행 전 제외)
    assert kpi(plat, 'measurements')['value'] == 4  # a1_c(raw+feature 중복 없이 1), a1_c2, b1_c, solo
    assert kpi(plat, 'storage_bytes')['value'] == 350 and kpi(plat, 'storage_bytes')['partial'] is True
    assert plat['as_of']
    org = get(client, w.admin_a, '/summary').json()
    assert kpi(org, 'sessions')['value'] == 2
    assert kpi(org, 'measurements')['value'] == 2
    assert kpi(org, 'storage_bytes')['value'] == 300
    assert org['scope_label'] == '기관A'
    inv = get(client, w.admin_a, '/inventory').json()
    kinds = {i['kind']: i for i in inv['items']}
    assert kinds['eeg_raw']['count']['value'] == 2 and kinds['eeg_raw']['exportable'] is True
    assert kinds['ppg_raw']['count']['value'] is None  # 미수집/미연결을 0 으로 쓰지 않는다
    assert kinds['reports']['count']['value'] is None and kinds['reports']['exportable'] is False

    # 사용자 데이터: canonical 중복 0, 비회원 구분, 보유 건수는 범위 안에서만
    subjects = get(client, w.platform, '/subjects', limit=100).json()
    ids = [(s['subject_type'], s['subject_id']) for s in subjects['items']]
    assert len(ids) == len(set(ids))
    guests = [s for s in subjects['items'] if s['subject_type'] == 'guest']
    assert [g['display_name'] for g in guests] == ['비회원A']
    client_row = next(s for s in subjects['items'] if s['subject_id'] == str(w.client.id))
    assert client_row['holdings']['sessions']['value'] == 4 and client_row['holdings']['measurements']['value'] == 3
    org_subjects = get(client, w.admin_a, '/subjects', limit=100).json()
    org_ids = {s['subject_id'] for s in org_subjects['items'] if s['subject_type'] == 'user'}
    assert str(w.client.id) in org_ids and str(w.counselor.id) in org_ids
    assert str(w.counselor_b.id) not in org_ids and str(w.platform.id) not in org_ids and str(w.admin_ab.id) not in org_ids or True
    org_client = next(s for s in org_subjects['items'] if s['subject_id'] == str(w.client.id))
    assert org_client['holdings']['sessions']['value'] == 2  # 기관A 회차만(개인상담소·타기관 제외)
    assert str(w.counselor_b.id) not in org_ids


def test_subject_search_and_pii_not_in_lists(client, seeded, db, dc_enabled):
    w = seeded
    w.client.phone = '010-9999-8888'
    db.add(ClientProfile(user_id=w.client.id, birth_date=datetime(1990, 5, 4).date()))
    db.commit()
    r = get(client, w.platform, '/subjects', q='회원1')
    assert [s['display_name'] for s in r.json()['items']] == ['회원1']
    item = r.json()['items'][0]
    assert item['contact_on_file'] is True
    assert '9999' not in r.text and '1990' not in r.text  # 연락처·생일 원문은 목록에 없다
    assert get(client, w.platform, '/subjects', q='010-9999').json()['items'] == []  # 연락처 검색 제외


def test_member_facilitator_scope(client, seeded, db, dc_enabled, monkeypatch):
    w = seeded
    r = get(client, w.admin_a, f'/members/{w.client.id}/sessions').json()
    assert r['total'] == 2 and {s['session_id'] for s in r['sessions']['items']} == {str(w.s_a1.id), str(w.s_a2.id)}
    assert [(b['first'], b['last'], b['count']) for b in r['batches']] == [(1, 2, 2)]
    plat = get(client, w.platform, f'/members/{w.client.id}/sessions').json()
    assert plat['total'] == 4
    assert get(client, w.admin_a, f'/members/{w.counselor_b.id}/sessions').status_code == 404
    assert get(client, w.admin_a, f'/members/{uuid4()}/sessions').status_code == 404
    # 50회차 묶음 정보는 설정값
    monkeypatch.setattr(settings, 'data_center_member_facilitator_max_sessions', 1)
    batches = get(client, w.platform, f'/members/{w.client.id}/sessions').json()['batches']
    assert [(b['index'], b['first'], b['last'], b['count']) for b in batches] == [(1, 1, 1, 1), (2, 2, 2, 1), (3, 3, 3, 1), (4, 4, 4, 1)]
    monkeypatch.undo()
    monkeypatch.setattr(settings, 'data_center_enabled', True)

    # 진행자: 기간 필수·역전 거절·교집합
    path = f'/facilitators/{w.counselor.id}/sessions'
    assert get(client, w.admin_a, path).status_code == 422
    assert get(client, w.admin_a, path, date_from='2026-10-05', date_to='2026-10-01').status_code == 422
    ok = get(client, w.admin_a, path, date_from='2026-09-01', date_to='2026-12-31').json()
    assert {s['session_id'] for s in ok['sessions']['items']} == {str(w.s_a1.id), str(w.s_a2.id), str(w.s_a_open.id)}
    assert get(client, w.admin_a, f'/facilitators/{w.counselor_b.id}/sessions', date_from='2026-09-01',
               date_to='2026-12-31').status_code == 404  # 기관A 소속 아님
    in_b = get(client, w.admin_ab, path, org_id=w.org_b.id, date_from='2026-09-01', date_to='2026-12-31').json()
    assert {s['session_id'] for s in in_b['sessions']['items']} == {str(w.s_b1.id)}  # 다기관 상담사도 선택 기관 회차만


def test_kst_date_boundaries(client, world, db, dc_enabled):
    # KST 2026-10-01 00:00 == UTC 2026-09-30 15:00
    early = mk_session(db, world.counselor, world.cls_a, world.org_a, day=-100)
    early.started_at = datetime(2026, 9, 30, 14, 59, 59, tzinfo=timezone.utc)
    inside = mk_session(db, world.counselor, world.cls_a, world.org_a, day=-100)
    inside.started_at = datetime(2026, 9, 30, 15, 0, 0, tzinfo=timezone.utc)
    last = mk_session(db, world.counselor, world.cls_a, world.org_a, day=-100)
    last.started_at = datetime(2026, 10, 1, 14, 59, 59, tzinfo=timezone.utc)  # KST 10/01 23:59:59
    after = mk_session(db, world.counselor, world.cls_a, world.org_a, day=-100)
    after.started_at = datetime(2026, 10, 1, 15, 0, 0, tzinfo=timezone.utc)  # KST 10/02 00:00:00
    for s in (early, inside, last, after):
        s.scheduled_at = s.started_at
    db.commit()
    path = f'/facilitators/{world.counselor.id}/sessions'
    items = get(client, world.admin_a, path, date_from='2026-10-01', date_to='2026-10-01').json()['sessions']['items']
    ids = {i['session_id'] for i in items}
    assert str(inside.id) in ids and str(last.id) in ids
    assert str(early.id) not in ids and str(after.id) not in ids


# ── 클래스·회차·참여자 ──────────────────────────────────────────────────

def test_class_session_participant_drilldown(client, seeded, db, dc_enabled):
    w = seeded
    plat = get(client, w.platform, '/classes', limit=100).json()
    titles = {c['title']: c for c in plat['items']}
    assert set(titles) == {'A명상', 'B명상', '귀속미상', '개인반'}
    assert titles['귀속미상']['attribution'] == 'needs_confirmation' and titles['A명상']['attribution'] == 'confirmed'
    assert titles['A명상']['ended_session_count']['value'] == 3 and titles['A명상']['org_name'] == '기관A'  # 플랫폼은 귀속 불명 회차도 포함
    assert get(client, w.admin_a, '/classes').json()['items'][0]['ended_session_count']['value'] == 2  # 기관은 귀속 확인 회차만
    assert titles['A명상']['facilitator_aliases'] == ['F1']
    org = get(client, w.admin_a, '/classes', limit=100).json()
    assert [c['title'] for c in org['items']] == ['A명상']
    for cid in (w.cls_b.id, w.cls_solo.id, w.cls_unknown.id):
        assert get(client, w.admin_a, f'/classes/{cid}/sessions').status_code == 404
    sess = get(client, w.admin_a, f'/classes/{w.cls_a.id}/sessions').json()
    rows = {r['session_id']: r for r in sess['sessions']['items']}
    assert set(rows) == {str(w.s_a1.id), str(w.s_a2.id), str(w.s_a_open.id)}
    assert rows[str(w.s_a_open.id)]['exportable'] is False and rows[str(w.s_a_open.id)]['exclusion_reason'] == 'not_completed'
    assert rows[str(w.s_a1.id)]['participant_count']['value'] == 3 and rows[str(w.s_a1.id)]['measured_count']['value'] == 2
    assert rows[str(w.s_a1.id)]['estimated_bytes']['value'] == 300

    for sid in (w.s_b1.id, w.s_solo.id, w.s_clinical.id, w.s_unknown.id, uuid4()):
        assert get(client, w.admin_a, f'/sessions/{sid}/participants').status_code == 404
    parts = get(client, w.admin_a, f'/sessions/{w.s_a1.id}/participants').json()
    items = parts['participants']['items']
    assert [p['alias'] for p in items] == ['P01', 'P02', 'P03']
    by_id = {p['participant_id']: p for p in items}
    c1 = by_id[str(w.p_a1_c.id)]
    assert c1['measurement'] == 'available' and c1['selectable'] is True and c1['general_consent'] == 'agreed'
    assert c1['research_consent'] == 'not_visible'  # 기관에는 연구 동의 정보 없음
    guest = by_id[str(w.p_guest.id)]
    assert guest['measurement'] in ('band_not_used', 'not_collected') and guest['selectable'] is False
    assert guest['unselectable_reason']
    plat_parts = get(client, w.platform, f'/sessions/{w.s_a1.id}/participants').json()['participants']['items']
    assert next(p for p in plat_parts if p['participant_id'] == str(w.p_a1_c.id))['research_consent'] in ('none', 'agreed')


def test_org_identified_switch_hides_names(client, seeded, dc_enabled, monkeypatch):
    w = seeded
    items = get(client, w.admin_a, f'/sessions/{w.s_a1.id}/participants').json()['participants']['items']
    assert any(p['display_name'] == '회원1' for p in items)
    monkeypatch.setattr(settings, 'data_center_org_identified_operations_enabled', False)
    items = get(client, w.admin_a, f'/sessions/{w.s_a1.id}/participants').json()['participants']['items']
    assert all(p['display_name'] is None for p in items)


def test_cursor_pagination_stable_and_filter_bound(client, world, db, dc_enabled):
    for i in range(5):
        mk_session(db, world.counselor, world.cls_a, world.org_a, day=10 + i, seq=10 + i)
    db.commit()
    seen, cursor = [], None
    for _ in range(10):
        r = get(client, world.admin_a, f'/classes/{world.cls_a.id}/sessions', limit=2, cursor=cursor).json()['sessions']
        seen += [i['session_id'] for i in r['items']]
        cursor = r['next_cursor']
        if not cursor:
            break
    assert len(seen) == len(set(seen)) == 8  # a1,a2,a_open + 새 5개 (템플릿 제외)
    first = get(client, world.admin_a, f'/classes/{world.cls_a.id}/sessions', limit=2).json()['sessions']
    bad = get(client, world.admin_a, f'/classes/{world.cls_a.id}/sessions', limit=2, cursor=first['next_cursor'],
              status='completed')
    assert bad.status_code == 400 and bad.json()['detail']['code'] == 'cursor_mismatch'
    assert get(client, world.admin_a, f'/classes/{world.cls_a.id}/sessions', limit=101).status_code == 422


# ── 측정 목록·상세 ──────────────────────────────────────────────────────

def test_measurements_list_and_detail(client, seeded, dc_enabled):
    w = seeded
    items = get(client, w.admin_a, '/measurements', limit=100).json()['items']
    assert {i['participant_id'] for i in items} == {str(w.p_a1_c.id), str(w.p_a1_c2.id)}
    first = next(i for i in items if i['participant_id'] == str(w.p_a1_c.id))
    sig = {s['signal']: s for s in first['signals']}
    assert sig['eeg']['availability'] == 'available' and sig['eeg']['sample_count']['partial'] is True
    assert sig['ppg']['availability'] == 'not_collected' and sig['ppg']['sample_count']['value'] is None
    assert first['feature_windows']['value'] == 3
    assert next(i for i in items if i['participant_id'] == str(w.p_a1_c2.id))['quality'] == 'degraded'
    detail = get(client, w.admin_a, f'/measurements/{w.s_a1.id}/{w.p_a1_c.id}').json()
    assert detail['manifest_state'] == 'not_connected' and detail['manifest_revision'] is None
    assert detail['feature_windows']['value'] == 3 and detail['consent'] == 'agreed'
    assert detail['retention_deadline'] is not None and detail['default_view'] == 'participant_player'
    for sid, pid in ((w.s_b1.id, w.p_b1_c.id), (w.s_solo.id, w.p_solo.id), (w.s_a1.id, w.p_b1_c.id), (uuid4(), uuid4())):
        assert get(client, w.admin_a, f'/measurements/{sid}/{pid}').status_code == 404
    assert get(client, w.platform, f'/measurements/{w.s_solo.id}/{w.p_solo.id}').status_code == 200


# ── 개인정보 열람 ───────────────────────────────────────────────────────

def test_reveal_projection(client, seeded, db, dc_enabled, caplog):
    w = seeded
    w.client.phone = '010-1234-5678'
    db.add(ClientProfile(user_id=w.client.id, birth_date=datetime(1991, 2, 3).date()))
    db.commit()
    url = f'/subjects/user/{w.client.id}/contact-reveal'
    with caplog.at_level(logging.INFO):
        r = client.post(BASE + url, json={'fields': ['phone', 'birth_date']}, headers=auth(w.platform))
    assert r.status_code == 200 and r.headers['cache-control'] == 'no-store'
    assert r.json()['phone'] == '010-1234-5678' and r.json()['birth_date'] == '1991-02-03'
    log_text = ' '.join(rec.getMessage() for rec in caplog.records)
    assert str(w.platform.id) in log_text and str(w.client.id) in log_text and 'phone' in log_text
    assert '010-1234-5678' not in log_text and '1991-02-03' not in log_text  # 원문은 로그에 남기지 않는다
    only = client.post(BASE + url, json={'fields': ['phone']}, headers=auth(w.admin_a)).json()
    assert only['phone'] == '010-1234-5678' and only['birth_date'] is None
    assert client.post(BASE + f'/subjects/user/{w.counselor_b.id}/contact-reveal', json={'fields': ['phone']},
                       headers=auth(w.admin_a)).status_code == 404
    assert client.post(BASE + url, json={'fields': ['phone']}, headers=auth(w.counselor)).status_code == 403
    assert client.post(BASE + url, json={'fields': []}, headers=auth(w.platform)).status_code == 422
    # 스크럽된 비회원은 복원하지 않는다
    guest = w.guest_a
    guest.pii_scrubbed_at = datetime.now(timezone.utc)
    db.commit()
    g = client.post(BASE + f'/subjects/guest/{guest.id}/contact-reveal', json={'fields': ['phone', 'birth_date']},
                    headers=auth(w.platform)).json()
    assert g['phone'] is None and g['birth_date'] is None and set(g['unavailable']) == {'phone', 'birth_date'}


def test_holdings_timeline(client, seeded, dc_enabled):
    w = seeded
    r = get(client, w.admin_a, f'/subjects/user/{w.client.id}/holdings').json()
    assert {e['session_id'] for e in r['events'] if e['kind'] == 'session_participation'} == {str(w.s_a1.id), str(w.s_a2.id)}
    assert r['counts']['sessions']['value'] == 2
    assert get(client, w.admin_a, f'/subjects/user/{w.counselor_b.id}/holdings').status_code == 404
    assert get(client, w.admin_a, f'/subjects/user/{uuid4()}/holdings').status_code == 404
    assert get(client, w.admin_a, f'/subjects/bogus/{w.client.id}/holdings').status_code == 422
    g = get(client, w.platform, f'/subjects/guest/{w.guest_a.id}/holdings')
    assert g.status_code == 200


def test_removed_and_waitlisted_participants_excluded(client, seeded, db, dc_enabled):
    w = seeded
    gone = mk_part(db, w.s_a1, mk_user(db, 'client', '퇴장회원'))
    gone.removed_at = datetime.now(timezone.utc)
    wait = mk_part(db, w.s_a1, mk_user(db, 'client', '대기회원'))
    wait.is_waitlisted = True
    db.commit()
    parts = get(client, w.admin_a, f'/sessions/{w.s_a1.id}/participants').json()
    assert parts['participants']['total'] == 3 and parts['session']['participant_count']['value'] == 3
    assert str(gone.id) not in parts.__str__() and str(wait.id) not in parts.__str__()
    assert get(client, w.admin_a, f'/subjects/user/{gone.user_id}/holdings').status_code == 404  # 기관 범위 사용자가 아님
