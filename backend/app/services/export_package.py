"""SDD-071 허용 필드만 직렬화하는 참가자 ZIP 생성기."""
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from app.models.eeg_feature import EEGFeatureWindow
from app.models.record import Report

FEATURE_COLUMNS = (
    'window_index', 'quality', 'device_timestamp_ms', 'play_group_id',
    'focus_index', 'cognitive_load', 'relaxation_index', 'stress_index',
    'emotional_stability', 'total_neural_activity', 'faa', 'hemispheric_balance',
    'delta_power', 'theta_power', 'alpha_power', 'beta_power', 'gamma_power',
    'total_power', 'meditation_level', 'attention_level', 'signal_quality',
    'sdnn', 'rmssd', 'lf_power', 'hf_power', 'lf_hf_ratio', 'heart_rate', 'respiratory_rate', 'motion',
)
MAX_ROWS = 100_000
MAX_BYTES = 100 * 1024 * 1024
METRIC_KEYS = ('focus_index_stability_score', 'total_neural_activity_score', 'cognitive_load_stability_score',
               'stress_score', 'hemispheric_balance_score', 'emotional_stability_score', 'relaxation_score')
TIMELINE_KEYS = ('t', 'concentration', 'relaxation', 'stress', 'heart_rate', 'respiratory_rate',
                 'sdnn', 'rmssd', 'lf_power', 'hf_power', 'lf_hf_ratio', 'motion')
LABELS = dict(zip(FEATURE_COLUMNS, (
    '구간 내 0부터 시작하는 윈도우 순서', '원천 품질(valid/degraded/invalid)', '디바이스 동기화 시각', '측정 실행 구간',
    '집중 원천값', '인지부하 원천값', '이완 원천값', '스트레스 원천값', '정서안정 원천값', '총 신경활동 원천값',
    '전두엽 알파 비대칭', '좌우 균형 원천값', '델타 파워', '세타 파워', '알파 파워', '베타 파워', '감마 파워',
    '총 파워', '명상 수준 원천값', '주의 수준 원천값', '신호 품질(0~1)', '박동 간격 표준편차',
    '연속 박동 간격 차이의 제곱평균제곱근', '저주파 파워', '고주파 파워', '저주파/고주파 비율', '심박수', '호흡수', '움직임 원천값',
)))
UNITS = {'window_index': 'index (nominal 1 s)', 'quality': 'enum', 'device_timestamp_ms': 'ms epoch',
         'play_group_id': 'identifier', 'sdnn': 'ms', 'rmssd': 'ms', 'lf_power': 'ms²', 'hf_power': 'ms²',
         'lf_hf_ratio': 'ratio', 'heart_rate': 'beats/min', 'respiratory_rate': 'breaths/min', 'signal_quality': 'ratio (0..1)'}
README = '''# MIND BREEZE 분석용 데이터

단일 종료 세션(s001)의 참가자(p001) 패키지입니다. 가명은 이 ZIP 내부에서만 의미가 있습니다.
가명화는 익명화를 보장하지 않습니다. 승인된 서비스 분석 목적과 보관·재배포 책임을 지켜 주세요.
raw EEG/음성/상담 본문/실명/이메일/생년월일/성별은 포함하지 않습니다.

feature_timeseries.csv는 UTF-8, 쉼표 구분, 헤더 한 행입니다. 빈 필드는 원천 NULL이며 0과 다릅니다.
부동소수점 원천값을 반올림·보간·정규화하지 않습니다. 소수점은 점(.)입니다.
quality는 valid/degraded/invalid 원천값 그대로이며 invalid 행도 삭제하지 않습니다.
window_index는 play_group_id마다 다시 0부터 시작할 수 있어 참가자 전체의 연속 시간으로 해석하면 안 됩니다.
play_group_id가 없으면 빈 필드이며 구간을 추측하지 않습니다. device_timestamp_ms가 없으면 절대시각은 알 수 없습니다.
8개 원천 주요값·밴드파워/부가 9개·HRV/움직임 8개와 식별/시간/품질 4개, 총 29개 컬럼입니다.
EEG 파워·지표·움직임의 단위/스케일은 저장 컬럼만으로 확정하지 않으며 SDK 원천 단위로 표기합니다.
PPG 유래 박동변이는 ECG HRV와 같다고 단정할 수 없습니다. 의료 진단용 데이터가 아닙니다.

report.json은 참가자에게 명시 귀속된 최신 완료 client 리포트의 허용 필드만 포함합니다.
report의 metrics는 이미 생성된 리포트 값이고 feature CSV와 동일한 척도가 아닐 수 있습니다.
report.timeline은 리포트에 저장된 값이며 구간 재시작 정보가 부족할 수 있으므로 원천 분석에는 CSV를 사용하세요.
리포트가 없거나 미완료이면 생략 사유가 manifest에 표시됩니다. EEG 없는 CSV는 헤더만 포함합니다.
manifest는 실제 행수·파일별 바이트·SHA-256·포함/누락 사유를 제공합니다(자기 자신의 해시는 제외).
ZIP 전체 체크섬과 보관 만료는 서버 작업 원장에 저장됩니다. 생성 후 최대 24시간, 다운로드 URL은 최대 5분입니다.
원천은 작업 시작 시 DB 스냅샷으로 읽습니다. 이후 들어온 데이터나 수정된 리포트는 새 작업으로 요청하세요.
'''


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def _json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _report_payload(report: Report) -> dict:
    content = report.content if isinstance(report.content, dict) else {}
    eeg = content.get('eeg')
    allowed = None
    if isinstance(eeg, dict):
        # 하위 구조도 허용 필드로 제한해 임의 사용자 프로필이나 상담 내용의 혼입을 막는다.
        metrics = eeg.get('metrics')
        timeline = eeg.get('timeline')
        narrative = eeg.get('narrative')
        allowed = {
            'metrics': {key: metrics[key] for key in METRIC_KEYS if key in metrics} if isinstance(metrics, dict) else None,
            'timeline': [{key: row[key] for key in TIMELINE_KEYS if key in row} for row in timeline if isinstance(row, dict)] if isinstance(timeline, list) else None,
            'narrative': {key: narrative[key] for key in ('journey', 'body', 'mind', 'closing') if key in narrative} if isinstance(narrative, dict) else None,
        }
    return {'type': report.type, 'status': report.status, 'data_credibility': report.data_credibility, 'content': {'eeg': allowed}}


def build_package(db, job, session, participant, root: Path) -> tuple[Path, list[str]]:
    """제한된 배치로 CSV를 기록하고 ZIP64 패키지를 생성한다."""
    folder = root / 'participants' / 'p001'
    folder.mkdir(parents=True)
    entries = []
    warnings = []

    def record(path: Path, *, row_count: int | None = None, reason: str | None = None) -> None:
        if path.stat().st_size > MAX_BYTES:
            raise ValueError('export_size_limit')
        entries.append({'path': str(path.relative_to(root)), 'included': True, 'reason': reason,
                        'row_count': row_count, 'size_bytes': path.stat().st_size, 'sha256': sha256_file(path)})

    features = db.query(*(getattr(EEGFeatureWindow, col) for col in FEATURE_COLUMNS)).filter(
        EEGFeatureWindow.session_id == session.id, EEGFeatureWindow.participant_id == participant.id,
    )
    has_features = features.first() is not None
    latest_report = db.query(Report).filter(
        Report.session_id == session.id, Report.participant_id == participant.id, Report.type == 'client',
    ).order_by(Report.created_at.desc(), Report.id.desc()).first()
    stored_eeg = latest_report.content.get('eeg') if latest_report and isinstance(latest_report.content, dict) else None
    explicitly_not_measured = isinstance(stored_eeg, dict) and stored_eeg.get('status') == 'not_measured'
    measurement = 'measured' if has_features else ('not_measured' if explicitly_not_measured else 'unknown')
    if 'features' in job.include:
        csv_path = folder / 'feature_timeseries.csv'
        count = 0
        with csv_path.open('w', encoding='utf-8', newline='') as stream:
            writer = csv.writer(stream)
            writer.writerow(FEATURE_COLUMNS)
            for row in features.order_by(EEGFeatureWindow.play_group_id, EEGFeatureWindow.window_index, EEGFeatureWindow.id).yield_per(1000):
                count += 1
                if count > MAX_ROWS or stream.tell() > MAX_BYTES:
                    raise ValueError('export_size_limit')
                # csv.writer는 None을 빈 셀로, float를 손실 없는 Python 문자열로 기록한다.
                writer.writerow(tuple(row))
        reason = None if count else measurement
        record(csv_path, row_count=count, reason=reason)
        if reason:
            warnings.append(reason)
    else:
        entries.append({'path': 'participants/p001/feature_timeseries.csv', 'included': False, 'reason': 'not_requested'})
    report_path = folder / 'report.json'
    if 'report' in job.include:
        reports = db.query(Report).filter(Report.session_id == session.id, Report.participant_id == participant.id, Report.type == 'client')
        report = reports.filter(Report.status == 'completed').order_by(Report.created_at.desc(), Report.id.desc()).first()
        if report:
            _json(report_path, _report_payload(report))
            record(report_path)
        else:
            reason = 'report_pending' if reports.first() else 'report_missing'
            entries.append({'path': 'participants/p001/report.json', 'included': False, 'reason': reason})
            warnings.append(reason)
    else:
        entries.append({'path': 'participants/p001/report.json', 'included': False, 'reason': 'not_requested'})
    # 모호한 레거시 user_id를 현재 참가자의 데이터로 추정해서 내보내지 않는다.
    unresolved = db.query(EEGFeatureWindow.id).filter(EEGFeatureWindow.session_id == session.id, EEGFeatureWindow.participant_id.is_(None)).first()
    legacy_report = db.query(Report.id).filter(Report.session_id == session.id, Report.participant_id.is_(None)).first()
    if unresolved or legacy_report:
        warnings.append('unresolved_owner_excluded')
    metadata = root / 'session_metadata.json'
    _json(metadata, {'session_key': 's001', 'participant_key': 'p001', 'type': session.type, 'status': session.status,
                     'scheduled_at': _iso(session.scheduled_at), 'started_at': _iso(session.started_at),
                     'ended_at': _iso(session.ended_at), 'measurement_status': measurement})
    record(metadata)
    dictionary = root / 'data_dictionary.json'
    _json(dictionary, {'schema_version': job.schema_version, 'columns': [
        {'name': key, 'meaning': LABELS[key], 'unit': UNITS.get(key, 'SDK 원천 단위/스케일 미확정'),
         'missing': '빈 필드 = 원천 NULL (0과 다름)'} for key in FEATURE_COLUMNS]})
    record(dictionary)
    readme = root / 'README_ko.md'
    readme.write_text(README, encoding='utf-8')
    record(readme)
    _json(root / 'manifest.json', {'schema_version': job.schema_version, 'generated_at': datetime.now(timezone.utc).isoformat(),
                                 'snapshot_at': _iso(job.snapshot_at), 'files': entries, 'warnings': warnings})
    if sum(path.stat().st_size for path in root.rglob('*') if path.is_file()) > MAX_BYTES:
        raise ValueError('export_size_limit')
    zip_path = root / 'data.zip'
    with ZipFile(zip_path, 'w', ZIP_DEFLATED, allowZip64=True) as archive:
        for path in sorted(root.rglob('*')):
            if path.is_file() and path != zip_path:
                archive.write(path, str(path.relative_to(root)))
    return zip_path, warnings
