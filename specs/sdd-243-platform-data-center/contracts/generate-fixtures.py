"""SDD-243 FE mock 용 계약 fixture 생성기 (합성값만).

실행: cd backend && PYTHONPATH=. python ../specs/sdd-243-platform-data-center/contracts/generate-fixtures.py
각 fixture 는 backend/app/schemas/{data_center,data_export}.py 모델로 검증되어야 하며
backend/tests/test_sdd243_policy.py::test_contract_fixtures_validate 가 드리프트를 막는다.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from app.schemas import data_center as dc
from app.schemas import data_export as de

OUT = Path(__file__).parent / 'fixtures'
NOW = datetime(2026, 10, 24, 3, 0, tzinfo=timezone.utc)
U = lambda n: UUID(int=n)  # noqa: E731 — 읽기 쉬운 합성 UUID
FILTERS = 'a' * 64


def page(model_items, total=None):
    return dc.DataCenterPage(items=model_items, next_cursor=None, total=total, as_of=NOW, filters_hash=FILTERS)


def count(n=None, partial=False, reason=None):
    return dc.Count(value=n, partial=partial, unavailable_reason=reason)


session_row = dc.SessionRow(
    session_id=U(11), class_id=U(1), seq=3, title='아침 호흡 명상 3회차', scheduled_at=NOW, started_at=NOW,
    ended_at=NOW, status='completed', participant_count=count(2), measured_count=count(1),
    estimated_bytes=count(1_200_000, partial=True), exportable=True)
signals = [
    dc.SignalHolding(signal='eeg', availability='available', sample_count=count(900000)),
    dc.SignalHolding(signal='ppg', availability='unsupported_client', unavailable_reason='구 앱은 PPG 를 보내지 않음',
                     sample_count=count(None, reason='미수집')),
    dc.SignalHolding(signal='acc', availability='not_collected', sample_count=count(None, reason='미수집')),
]
X = {
    'context.json': dc.DataCenterContext(
        role='org_admin', actor_id=U(900), current_org=dc.OrgRef(id=U(100), name='기관A'),
        allowed_orgs=[dc.OrgRef(id=U(100), name='기관A')], default_org_id=U(100),
        capabilities=dc.Capabilities(enabled=True, tabs=['overview', 'subjects', 'classes', 'jobs', 'audits'],
                                     can_research=False, can_export_identified=True, can_reveal_contact=True,
                                     can_view_platform_audits=False),
        limits=dc.PolicyLimits(
            policy_version='dc-policy-1', policy_hash='b' * 64, default_identity='pseudonymized',
            require_reason=True, reason_min_length=2, reason_max_length=500, reauth_ttl_seconds=300,
            artifact_ttl_seconds=86400, url_ttl_seconds=60, preview_ttl_seconds=300, max_active_jobs_per_actor=1,
            member_facilitator_max_sessions=50, part_max_bytes=1_000_000_000)),
    'summary.json': dc.SummaryResponse(as_of=NOW, scope_label='기관A', kpis=[
        dc.KpiItem(key='classes', label='클래스', unit='개', count=count(4)),
        dc.KpiItem(key='storage_bytes', label='저장량(메타데이터 기준)', unit='B', count=count(52_000_000, True)),
        dc.KpiItem(key='retention_due_7d', label='7일 내 만료', unit='건', count=count(None, reason='미집계'))]),
    'class-list.json': page([dc.ClassListItem(
        class_id=U(1), title='아침 호흡 명상', org_id=U(100), org_name='기관A', status='active',
        ended_session_count=count(12), stored_bytes=count(None, reason='미집계'), facilitator_aliases=['F1'],
        attribution='confirmed', last_session_at=NOW)], total=1),
    'class-sessions.json': dc.ClassSessionsResponse(class_id=U(1), title='아침 호흡 명상', org_name='기관A',
                                                      sessions=page([session_row], total=1)),
    'session-participants.json': dc.SessionParticipantsResponse(session=session_row, participants=page([
        dc.ParticipantRow(participant_id=U(21), alias='P01', display_name=None, subject_type='user',
                          subject_id=U(31), attendance_status='attended', band_used=True, measurement='available',
                          general_consent='agreed', research_consent='not_visible', retention_deadline=NOW,
                          selectable=True),
        dc.ParticipantRow(participant_id=U(22), alias='P02', display_name=None, subject_type='guest',
                          subject_id=U(32), attendance_status='attended', band_used=False,
                          measurement='band_not_used', general_consent='none', research_consent='not_visible',
                          retention_deadline=None, selectable=False, unselectable_reason='band_not_used')], total=2)),
    'subjects.json': page([dc.SubjectListItem(
        subject_type='user', subject_id=U(31), display_name='회원1', email='member1@example.invalid', role='client',
        status='active', org_names=['기관A'], member_type='member',
        holdings={'sessions': count(3), 'measurements': count(2)}, contact_on_file=True, created_at=NOW)], total=1),
    'measurement-detail.json': dc.MeasurementDetail(
        session_id=U(11), participant_id=U(21), alias='P01', as_of=NOW, manifest_revision=2,
        manifest_state='available', signals=signals, feature_windows=count(900), consent='agreed',
        retention_deadline=NOW, allowed_formats=['csv', 'parquet'], band_used=True,
        default_view='participant_player'),
    'waveform.json': dc.WaveformResponse(
        session_id=U(11), participant_id=U(21), signal_type='eeg', availability='available', manifest_revision=2,
        from_us='0', to_us='10000000', method='minmax_envelope', max_points=2000, source_sample_count=2500,
        returned_count=3, nominal_rate_hz=250.0, observed_rate_hz=249.98, time_basis='session_relative',
        t_us=['0', '4000000', '8000000'],
        channels=[dc.WaveformChannel(name='fp1', unit='uV', min=[-10.5, -8.0, None], max=[11.0, 9.5, None]),
                  dc.WaveformChannel(name='fp2', unit='uV', min=[-9.0, -7.5, None], max=[10.0, 8.5, None])],
        segments=[dc.WaveformSegment(stream_id='S01', segment_id='G01', point_start=0, point_end=2,
                                     first_sample_index=0, end_sample_index_exclusive=1500),
                  dc.WaveformSegment(stream_id='S01', segment_id='G02', point_start=2, point_end=3,
                                     first_sample_index=1750, end_sample_index_exclusive=2500)],
        gaps=[dc.GapRange(start_us='6000000', end_us='7000000', reason='ble_disconnect',
                          observed_or_estimated='observed')]),
    'features.json': dc.FeaturePage(session_id=U(11), participant_id=U(21), as_of=NOW,
                                    algorithm_versions={'eeg': 'looxid-sdk-x'}, total=1, items=[dc.FeatureRow(
        window_index=0, t_rel_ms=0, quality='valid', source='scalar_1hz',
        values={'focus_index': 1.234567890123, 'total_neural_activity': None, 'faa': 0.01}, units={'faa': 'ratio'})]),
    'indices.json': dc.IndicesPage(session_id=U(11), participant_id=U(21), as_of=NOW, view='participant_player',
                                   items=[dc.IndexRow(
        t_rel_ms=0,
        focus=dc.IndexMetric(value=62, status='snapshot', source='participant_player'),
        relaxation=dc.IndexMetric(value=48, status='snapshot', source='participant_player'),
        emotional_balance=dc.IndexMetric(value=None, status='display_history_missing', source='none',
                                         reason='저장 이전 표시값 없음'),
        bpm=dc.IndexMetric(value=71, status='snapshot', source='participant_player'),
        respiration=dc.IndexMetric(value=None, status='insufficient_window', source='none',
                                   reason='첫 60초 창 부족'),
        hrv_sdnn_ms=dc.IndexMetric(value=44, status='snapshot', source='participant_player'),
        model_version='display-model-1')]),
    'spectrum.json': dc.SpectrumResponse(session_id=U(11), participant_id=U(21), computable=True, from_us='0',
                                         to_us='10000000', freq_hz=[0.0, 0.5, 1.0],
                                         channels=[dc.SpectrumChannel(name='fp1', psd=[0.1, 0.2, 0.3])]),
    'export-preview.json': de.ExportPreview(
        preview_token='p' * 32, expires_at=NOW, request_hash='c' * 64, as_of=NOW, scope='class',
        purpose='operations', identity='pseudonymized', session_count=12, participant_count=24,
        targets=[de.ExportTargetRef(ordinal=1, session_id=U(11), participant_id=U(21), manifest_revision=2)],
        targets_truncated=True, exclusions=[de.ExportExclusion(session_id=U(12), reason='not_completed')],
        estimated_bytes=48_000_000, estimated_part_count=1, extra_range_notices=[],
        policy_version='dc-policy-1', policy_hash='b' * 64, eligible=True),
    'export-status.json': de.DataCenterExportStatus(
        export_id=U(500), status='ready', scope='class', purpose='operations', identity='pseudonymized',
        session_count=12, participant_count=24, completed_count=24,
        parts=[de.ExportPartStatus(part_id=U(501), part_no=1, status='ready', size_bytes=48_000_000)],
        expected_part_count=1, created_at=NOW, expires_at=NOW, policy_version='dc-policy-1'),
    'export-proof.json': de.ExportProof(proof='eyJhbGciOi...(서명 토큰, 불투명)', expires_at=NOW),
    'part-download.json': de.PartDownload(url='https://storage.example.invalid/part1.zip?X-Amz-Signature=SYNTHETIC', expires_at=NOW, part_no=1),
    'download-audits.json': page([de.DownloadAuditItem(
        event_id=U(700), event='url_issued', result='issued', at=NOW, actor_id=U(900), actor_role='org_admin', org_id=U(100),
        job_id=U(500), purpose='operations', identity='pseudonymized', reason='운영 점검', part_no=1, session_count=12,
        size_bytes=48_000_000, policy_version='dc-policy-1')], total=1),
}
OUT.mkdir(parents=True, exist_ok=True)
for name, model in X.items():
    (OUT / name).write_text(json.dumps(json.loads(model.model_dump_json()), ensure_ascii=False, indent=2) + '\n')
(OUT / 'error-403.json').write_text(json.dumps(
    {'detail': {'code': 'platform_only', 'message': '플랫폼 관리자 전용 기능입니다'}}, ensure_ascii=False, indent=2) + '\n')
print(f'{len(X) + 1} fixtures')
