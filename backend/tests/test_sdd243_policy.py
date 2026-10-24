"""SDD-243 B01 — 계약·인가 기반: 기관 교집합, 정책 스위치, 금지 목적, 계약 fixture."""
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.config import settings
from app.schemas.data_center import DataCenterContext
from app.schemas.data_export import DataCenterExportRequest
from app.services import data_center_policy as pol
from tests.sdd243_helpers import db, dc_enabled, world  # noqa: F401


def code_of(exc: HTTPException) -> str:
    return exc.detail["code"]


def raises(status: int, fn, *a, **kw) -> HTTPException:
    with pytest.raises(HTTPException) as info:
        fn(*a, **kw)
    assert info.value.status_code == status, info.value.detail
    return info.value


def req(scope, target, **kw) -> DataCenterExportRequest:
    base = dict(scope=scope, target_id=target, include=['features'])
    base.update(kw)
    return DataCenterExportRequest(**base)


# ── 컨텍스트·기관 교집합 ────────────────────────────────────────────────

def test_org_scope_intersection(db, world, dc_enabled):
    ctx = pol.resolve_context(db, world.admin_a.id, None)
    assert ctx.role == 'org_admin' and ctx.scope_org_id == world.org_a.id
    # 선택하지 않은 다기관 관리자는 기관 선택을 요구한다
    assert code_of(raises(400, pol.resolve_context, db, world.admin_ab.id, None)) == 'org_selection_required'
    ab = pol.resolve_context(db, world.admin_ab.id, world.org_b.id)
    assert ab.scope_org_id == world.org_b.id
    # 소속 없는 기관·개인상담소·비활성 기관·없는 ID 는 모두 같은 404
    for org_id in (world.org_b.id, world.solo_org.id, world.dead_org.id, uuid4()):
        err = raises(404, pol.resolve_context, db, world.admin_a.id, org_id)
        assert code_of(err) == 'not_found'
    # 소속해제·계정 정지·비활성 기관 소속 관리자는 접근 불가
    raises(404, pol.resolve_context, db, world.admin_left.id, world.org_a.id)
    raises(403, pol.resolve_context, db, world.admin_inactive.id, world.org_a.id)
    raises(404, pol.resolve_context, db, world.admin_dead.id, world.dead_org.id)
    assert code_of(raises(403, pol.resolve_context, db, world.admin_none.id, None)) == 'no_admin_org'


def test_forbidden_roles(db, world, dc_enabled):
    for user in (world.counselor, world.client):
        assert code_of(raises(403, pol.resolve_context, db, user.id, None)) == 'role_forbidden'
    raises(403, pol.resolve_context, db, uuid4(), None)  # 없는 계정


def test_session_scope_excludes_other_orgs_solo_clinical_unknown(db, world, dc_enabled):
    ctx = pol.resolve_context(db, world.admin_a.id, None)
    ids = {s.id for s in pol.scoped_sessions(db, ctx).all()}
    assert ids == {world.s_a1.id, world.s_a2.id, world.s_a_open.id}
    # 귀속 미상 회차/클래스, 개인상담소, 상담 세션, 템플릿, 타기관은 모두 제외
    for excluded in (world.s_unknown, world.s_unknown_cls, world.s_sess_unknown, world.s_conflict, world.s_solo, world.s_clinical, world.s_template,
                     world.s_b1, world.s_b2):
        assert excluded.id not in ids
    ab = pol.resolve_context(db, world.admin_ab.id, world.org_b.id)
    assert {s.id for s in pol.scoped_sessions(db, ab).all()} == {world.s_b1.id, world.s_b2.id}
    platform = pol.resolve_context(db, world.platform.id, None)
    assert platform.is_platform
    all_ids = {s.id for s in pol.scoped_sessions(db, platform).all()}
    assert world.s_clinical.id not in all_ids and world.s_template.id not in all_ids
    assert {world.s_a1.id, world.s_b1.id, world.s_solo.id, world.s_unknown.id} <= all_ids


def test_selection_authorization_is_404_outside_scope(db, world, dc_enabled):
    ctx = pol.resolve_context(db, world.admin_a.id, None)
    ok = pol.authorize_selection(db, ctx, req('session', world.s_a1.id), 'operations', 'pseudonymized')
    assert ok.scope == 'session'
    outside = [
        req('session', world.s_b1.id), req('session', world.s_solo.id), req('session', world.s_clinical.id),
        req('session', world.s_unknown.id), req('session', world.s_sess_unknown.id),
        req('session', world.s_conflict.id), req('session', uuid4()),
        req('class', world.cls_b.id), req('class', world.cls_solo.id), req('class', world.cls_unknown.id),
        req('participant', world.p_b1_c.id, session_id=world.s_b1.id),
        req('participant', world.p_a1_c.id, session_id=world.s_b1.id),  # 다른 회차의 참여자 조합
        req('member', uuid4()),
        req('facilitator', world.counselor_b.id),  # 기관A 소속 아님
    ]
    for r in outside:
        assert code_of(raises(404, pol.authorize_selection, db, ctx, r, 'operations', 'pseudonymized')) == 'not_found'
    # 다기관 회원은 기관A 범위의 회차만 선택 대상(기관B·개인상담소 회차는 범위 밖)
    member = pol.authorize_selection(db, ctx, req('member', world.client.id), 'operations', 'pseudonymized')
    assert member.scope == 'member'
    # 다기관 상담사: 기관A 에서는 A 회차만(타기관·개인상담소 회차는 교집합에서 제외)
    fac = pol.authorize_selection(db, ctx, req('facilitator', world.counselor.id), 'operations', 'pseudonymized')
    sessions = {s.id for s in pol.selection_sessions(db, fac).all()}
    assert sessions == {world.s_a1.id, world.s_a2.id, world.s_a_open.id}
    member_sessions = {s.id for s in pol.selection_sessions(db, member).all()}
    assert member_sessions == {world.s_a1.id, world.s_a2.id}


def test_platform_selection_global(db, world, dc_enabled):
    ctx = pol.resolve_context(db, world.platform.id, None)
    sel = pol.authorize_selection(db, ctx, req('member', world.client.id), 'operations', 'pseudonymized')
    assert {s.id for s in pol.selection_sessions(db, sel).all()} == {
        world.s_a1.id, world.s_a2.id, world.s_b1.id, world.s_solo.id}
    raises(404, pol.authorize_selection, db, ctx, req('session', uuid4()), 'operations', 'pseudonymized')


# ── 정책 스위치·금지 목적 ───────────────────────────────────────────────

def test_forbidden_purpose(db, world, dc_enabled):
    org = pol.resolve_context(db, world.admin_a.id, None)
    plat = pol.resolve_context(db, world.platform.id, None)
    sel = req('session', world.s_a1.id)
    # 기관은 연구 목적 불가(연구 동의가 있어도), 식별+연구는 누구도 불가
    assert code_of(raises(403, pol.authorize_selection, db, org, sel, 'research', 'pseudonymized')) == 'research_forbidden'
    assert code_of(raises(403, pol.authorize_selection, db, plat, sel, 'research', 'identified')) == 'identity_forbidden'
    pol.authorize_selection(db, plat, sel, 'research', 'pseudonymized')
    # 플랫폼 전용 리소스는 기관에 403
    assert code_of(raises(403, pol.require_platform, org)) == 'platform_only'
    pol.require_platform(plat)


def test_policy_switches(db, world, dc_enabled, monkeypatch):
    org = pol.resolve_context(db, world.admin_a.id, None)
    sel = req('session', world.s_a1.id)
    assert pol.authorize_selection(db, org, sel, 'operations', 'identified').identity == 'identified'
    assert org.to_schema().capabilities.can_export_identified is True
    before = org.policy.policy_hash
    monkeypatch.setattr(settings, 'data_center_org_identified_operations_enabled', False)
    off = pol.resolve_context(db, world.admin_a.id, None)
    assert off.policy.policy_hash != before
    assert off.to_schema().capabilities.can_export_identified is False
    assert code_of(raises(403, pol.authorize_selection, db, off, sel, 'operations', 'identified')) == 'identity_forbidden'
    # 플랫폼 식별 운영은 별도 스위치와 무관
    plat = pol.resolve_context(db, world.platform.id, None)
    pol.authorize_selection(db, plat, sel, 'operations', 'identified')
    # 설정값이 limits 에 반영된다
    monkeypatch.setattr(settings, 'data_center_reauth_ttl_seconds', 120)
    monkeypatch.setattr(settings, 'data_center_max_active_jobs_per_actor', 2)
    limits = pol.resolve_context(db, world.admin_a.id, None).to_schema().limits
    assert (limits.reauth_ttl_seconds, limits.max_active_jobs_per_actor) == (120, 2)
    assert limits.default_identity == 'pseudonymized' and limits.provisional is True


def test_disabled_blocks_data_but_contexts_report_disabled(db, world, monkeypatch):
    monkeypatch.setattr(settings, 'data_center_enabled', False)
    assert code_of(raises(403, pol.resolve_context, db, world.platform.id, None)) == 'data_center_disabled'
    ctx = pol.list_contexts(db, world.platform.id)
    assert ctx.capabilities.enabled is False and ctx.capabilities.tabs == []


def test_contexts_listing(db, world, dc_enabled):
    plat = pol.list_contexts(db, world.platform.id)
    assert plat.role == 'platform_admin' and plat.allowed_orgs == [] and 'standard' in plat.capabilities.tabs
    assert plat.capabilities.can_research is True
    ab = pol.list_contexts(db, world.admin_ab.id)
    assert {o.name for o in ab.allowed_orgs} == {'기관A', '기관B'}
    assert ab.default_org_id is None  # 둘 이상이면 선택 필요
    assert set(ab.capabilities.tabs) == {'overview', 'subjects', 'classes', 'jobs', 'audits'}
    assert ab.capabilities.can_research is False and ab.capabilities.can_view_platform_audits is False
    single = pol.list_contexts(db, world.admin_a.id)
    assert single.default_org_id == world.org_a.id and single.current_org.name == '기관A'
    # 개인상담소·소속해제·비활성 기관은 목록에 없다
    left = pol.list_contexts(db, world.admin_left.id)
    assert left.allowed_orgs == []
    raises(403, pol.list_contexts, db, world.counselor.id)


def test_request_dto_has_no_report_include():
    with pytest.raises(Exception):
        DataCenterExportRequest(scope='session', target_id=uuid4(), include=['report'])
    with pytest.raises(Exception):
        DataCenterExportRequest(scope='session', target_id=uuid4(), include=['features'], unknown=1)


def test_reason_and_cache_key(db, world, dc_enabled):
    assert pol.normalize_reason('  운영 점검  ', pol.DataCenterPolicy.from_settings()) == '운영 점검'
    for bad in ('a', ' a ', 'x' * 501, '   '):
        raises(422, pol.normalize_reason, bad, pol.DataCenterPolicy.from_settings())
    assert len(pol.normalize_reason('가' * 500, pol.DataCenterPolicy.from_settings())) == 500
    a = pol.resolve_context(db, world.admin_a.id, None)
    plat = pol.resolve_context(db, world.platform.id, None)
    k1 = pol.cache_key(a, 'x', 'r', 's')
    assert k1 != pol.cache_key(plat, 'x', 'r', 's') and k1 != pol.cache_key(a, 'y', 'r', 's')
    assert a.policy.policy_hash in k1 or len(k1) == 64


# ── 계약 fixture(FE mock 용) 드리프트 방지 ──────────────────────────────

FIXTURES = Path(__file__).parents[2] / 'specs/sdd-243-platform-data-center/contracts/fixtures'


def test_contract_fixtures_validate():
    from app.schemas import data_center as dc, data_export as de
    mapping = {
        'context.json': dc.DataCenterContext,
        'summary.json': dc.SummaryResponse,
        'class-list.json': dc.DataCenterPage[dc.ClassListItem],
        'class-sessions.json': dc.ClassSessionsResponse,
        'session-participants.json': dc.SessionParticipantsResponse,
        'subjects.json': dc.DataCenterPage[dc.SubjectListItem],
        'measurement-detail.json': dc.MeasurementDetail,
        'waveform.json': dc.WaveformResponse,
        'features.json': dc.FeaturePage,
        'indices.json': dc.IndicesPage,
        'spectrum.json': dc.SpectrumResponse,
        'export-preview.json': de.ExportPreview,
        'export-status.json': de.DataCenterExportStatus,
        'export-proof.json': de.ExportProof,
        'part-download.json': de.PartDownload,
        'download-audits.json': dc.DataCenterPage[de.DownloadAuditItem],
        'error-403.json': None,
    }
    assert FIXTURES.exists(), '계약 fixture 디렉터리가 필요하다'
    for name, model in mapping.items():
        data = json.loads((FIXTURES / name).read_text())
        if model is not None:
            model.model_validate(data)
    assert DataCenterContext is dc.DataCenterContext
