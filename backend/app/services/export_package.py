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


# ═══════════════════════════════════════════════════════════════════════════
# SDD-243 B06 — 데이터 센터 원본 ZIP·독립 part
#
# - 디스크 임시파일로 조각(piece)을 만들고, 압축 크기를 정확히 측정해 part 에 배치한다(메모리 누적 없음).
# - 모든 part 는 루트 README/data_dictionary/manifest 를 포함해 단독으로 열린다. ZIP 중첩·분할압축 없음.
# - 최종 크기는 루트 메타·central directory 포함 **실제 파일 크기**로 검사하고, 넘으면 예약분을 늘려 재패킹한다(유한 재시도).
# - 원본 bin 은 바이트 분할하지 않는다. 단독 상한 초과·무손실 권한 없음은 차단하고 사유를 manifest 에 남긴다.
# - 244 T12 `iter_export_artifacts` 는 `ArtifactSource` 어댑터로 주입한다(통합 시 감독이 연결). 인가 결정은 호출자가
#   PackagePolicy 로 전달하며, 어댑터의 필터가 서버 인가를 대신하지 않는다.
# ═══════════════════════════════════════════════════════════════════════════
import io
import os
import re
import shutil
import zlib
from dataclasses import dataclass, field
from typing import BinaryIO, Callable, Iterable, Iterator, Literal, Sequence
from zipfile import ZipInfo

PACKAGE_SCHEMA = 'data-center-package-v1'
ZIP_ENTRY_OVERHEAD = 160  # local(30+name) + central(46+name) + zip64 extra 여유
ZIP_END_RESERVE = 128
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)  # 생성 시각 비노출(date-withheld)
_NUMERIC = re.compile(r'^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$')
_FORMULA = ('=', '+', '-', '@', '\t', '\r')
_SAFE_PATH = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.\-]*(/[A-Za-z0-9][A-Za-z0-9_.\-]*)*$')


class PackageError(Exception):
    def __init__(self, code: str, message: str = '') -> None:
        super().__init__(message or code)
        self.code = code


@dataclass(frozen=True)
class PackageScope:
    """한 참여자의 ZIP 안 위치. 모두 별칭이며 원 UUID·실명·원본 경로를 담지 않는다."""
    class_alias: str  # 예: class-C01
    session_label: str  # 예: session-001_date-withheld
    participant_alias: str  # 예: P01
    session_alias: str = ''
    manifest_revision: int | None = None

    @property
    def directory(self) -> str:
        return f'{self.class_alias}/{self.session_label}/participant-{self.participant_alias}'


@dataclass
class RowArtifact:
    name: str  # 참여자 폴더 기준 상대 경로(예: eeg_raw.csv, features/eeg.jsonl)
    fmt: Literal['csv', 'jsonl', 'parquet']
    rows: Callable[[], Iterable[Sequence | dict]]
    header: Sequence[str] = ()
    kind: str = 'table'
    signal: str | None = None
    schema_version: str = '1'
    dictionary_key: str | None = None
    parquet_types: dict[str, str] | None = None  # column -> float32|float64|int64|string
    time_column: str | None = 'timestamp'
    extra_range: list[dict] = field(default_factory=list)


@dataclass
class BinArtifact:
    name: str
    open: Callable[[], BinaryIO]
    size_bytes: int
    sha256: str
    kind: str = 'raw_bin'
    signal: str | None = None
    schema_version: str = 'mb-biosignal-raw-v2'
    dictionary_key: str | None = None
    extra_range: list[dict] = field(default_factory=list)


@dataclass
class MissingArtifact:
    kind: str
    reason: str  # not_collected / unsupported_client / expired / withdrawn / lost / unknown / manifest_not_connected …
    signal: str | None = None


@dataclass
class TextArtifact:
    """작은 단일 파일(meta.json, README_ko.md). 분할하지 않는다."""
    name: str
    text: str
    kind: str = 'meta'
    signal: str | None = None
    schema_version: str = '1'
    dictionary_key: str | None = None
    extra_range: list[dict] = field(default_factory=list)


Artifact = RowArtifact | BinArtifact | MissingArtifact | TextArtifact


class ArtifactSource:
    """244 T12 `iter_export_artifacts` 와 맞물리는 어댑터 경계."""

    def artifacts(self, scope: PackageScope, target: object, policy: 'PackagePolicy',
                  signals: frozenset[str]) -> Iterator[Artifact]:  # pragma: no cover
        raise NotImplementedError


@dataclass(frozen=True)
class PackagePolicy:
    part_max_bytes: int = 1_000_000_000
    identity: str = 'pseudonymized'
    purpose: str = 'operations'
    exact_time_allowed: bool = False
    lossless_allowed: bool = False
    policy_version: str = ''
    eeg_format: str = 'csv'
    piece_target_bytes: int | None = None  # None 이면 part_max//4
    forbidden_strings: frozenset[str] = frozenset()  # 원 UUID·장치 ID 등(어디에도 나오면 안 됨)

    @property
    def piece_target(self) -> int:
        return max(1024, min(self.piece_target_bytes or self.part_max_bytes // 4, self.part_max_bytes // 4))


@dataclass
class Piece:
    scope: PackageScope
    rel_path: str  # 참여자 폴더 기준
    stage_path: Path
    kind: str
    signal: str | None
    fmt: str
    bytes: int
    sha256: str
    rows: int | None
    first: str | None
    last: str | None
    schema_version: str
    dictionary_key: str | None
    compressed: int
    piece_index: int = 1
    piece_count: int = 1
    extra_range: list[dict] = field(default_factory=list)

    @property
    def arcname(self) -> str:
        return f'{self.scope.directory}/{self.rel_path}'

    @property
    def cost(self) -> int:
        return self.compressed + ZIP_ENTRY_OVERHEAD + 2 * len(self.arcname)


@dataclass
class PartInfo:
    part_no: int
    path: Path
    size_bytes: int
    sha256: str
    file_count: int


@dataclass
class PackageResult:
    parts: list[PartInfo]
    files: list[dict]
    exclusions: list[dict]
    source_revisions: list[dict]
    warnings: list[str]


def _check_rel_path(path: str) -> str:
    if not _SAFE_PATH.match(path) or '..' in path.split('/'):
        raise PackageError('unsafe_path', path)
    return path


def _cell(value: object) -> str:
    """CSV 셀: None→빈칸(0 과 구별), 비유한 수 거부, 문자 메타는 수식 주입 방지."""
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, float):
        if value != value or value in (float('inf'), float('-inf')):
            raise PackageError('nonfinite_value')
        return repr(value)
    text = str(value)
    if text and text[0] in _FORMULA and not _NUMERIC.match(text):
        return "'" + text
    return text


def _scan_forbidden(path: Path, forbidden: frozenset[str]) -> None:
    if not forbidden:
        return
    needles = [s.encode() for s in forbidden if s]
    keep = max((len(n) for n in needles), default=0) - 1
    tail = b''
    with open(path, 'rb') as fh:
        while chunk := fh.read(1 << 20):
            window = tail + chunk
            if any(n in window for n in needles):
                raise PackageError('pseudonym_leak', path.name)
            tail = window[-keep:] if keep > 0 else b''


def _compressed_size(path: Path) -> int:
    comp = zlib.compressobj(zlib.Z_DEFAULT_COMPRESSION, zlib.DEFLATED, -15)
    total = 0
    with open(path, 'rb') as fh:
        while chunk := fh.read(1 << 20):
            total += len(comp.compress(chunk))
    return total + len(comp.flush())


def _finish_piece(scope: PackageScope, art: RowArtifact | BinArtifact, path: Path, rel: str, rows: int | None,
                  first: str | None, last: str | None, policy: PackagePolicy, fmt: str) -> Piece:
    _scan_forbidden(path, policy.forbidden_strings)
    return Piece(scope=scope, rel_path=rel, stage_path=path, kind=art.kind, signal=art.signal, fmt=fmt,
                 bytes=path.stat().st_size, sha256=sha256_file(path), rows=rows, first=first, last=last,
                 schema_version=art.schema_version, dictionary_key=art.dictionary_key,
                 compressed=_compressed_size(path), extra_range=list(art.extra_range))


def _piece_name(name: str, index: int) -> str:
    if index == 1:
        return name
    stem, dot, ext = name.rpartition('.')
    return f'{stem}.cont-{index:04d}{dot}{ext}' if dot else f'{name}.cont-{index:04d}'


def _stage_rows(scope: PackageScope, art: RowArtifact, stage: Path, policy: PackagePolicy, counter: Iterator[int]) -> list[Piece]:
    pieces: list[Piece] = []
    header = list(art.header)
    time_idx = header.index(art.time_column) if art.fmt == 'csv' and art.time_column in header else None
    index = 0
    handle = None
    writer = None
    state = {'rows': 0, 'first': None, 'last': None, 'path': None, 'rel': None}
    pq_buffer: dict[str, list] = {}

    def open_piece() -> None:
        nonlocal handle, writer, index
        index += 1
        state.update(rows=0, first=None, last=None, rel=_piece_name(art.name, index), path=stage / f'{next(counter):08d}.piece')
        if art.fmt == 'csv':
            handle = open(state['path'], 'w', encoding='utf-8', newline='')
            writer = csv.writer(handle, lineterminator='\r\n')
            writer.writerow(header)
        elif art.fmt == 'jsonl':
            handle = open(state['path'], 'w', encoding='utf-8', newline='')

    def close_piece() -> None:
        nonlocal handle
        if art.fmt == 'parquet':
            _flush_parquet(final=True)
        elif handle is not None:
            handle.close()
        handle = None
        if state['rows']:
            pieces.append(_finish_piece(scope, art, state['path'], state['rel'], state['rows'], state['first'],
                                        state['last'], policy, art.fmt))
        elif state['path'] is not None:
            state['path'].unlink(missing_ok=True)

    pq_writer = None

    def _flush_parquet(final: bool = False) -> None:
        nonlocal pq_writer
        import pyarrow as pa
        import pyarrow.parquet as pq
        types = {'float32': pa.float32(), 'float64': pa.float64(), 'int64': pa.int64(), 'string': pa.string()}
        schema = pa.schema([(c, types[(art.parquet_types or {})[c]]) for c in header])
        if pq_buffer and any(pq_buffer.values()):
            table = pa.table({c: pq_buffer[c] for c in header}, schema=schema)
            if pq_writer is None:
                pq_writer = pq.ParquetWriter(state['path'], schema, compression='zstd')
            pq_writer.write_table(table)
            for c in header:
                pq_buffer[c] = []
        if final and pq_writer is not None:
            pq_writer.close()
            pq_writer = None

    approx = 0
    open_piece()
    if art.fmt == 'parquet':
        pq_buffer.update({c: [] for c in header})
    for row in art.rows():
        if art.fmt == 'csv':
            cells = [_cell(v) for v in row]
            if len(cells) != len(header):
                raise PackageError('row_width_mismatch', art.name)
            writer.writerow(cells)
            size = sum(len(c) + 1 for c in cells)
            stamp = cells[time_idx] if time_idx is not None else None
        elif art.fmt == 'jsonl':
            line = json.dumps(row, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'
            handle.write(line)
            size = len(line)
            stamp = str(row.get(art.time_column)) if isinstance(row, dict) and art.time_column in row else None
        else:
            values = row if isinstance(row, dict) else dict(zip(header, row))
            for c in header:
                pq_buffer[c].append(values.get(c))
            size = 8 * len(header)
            stamp = None if art.time_column not in values else str(values[art.time_column])
            if len(pq_buffer[header[0]]) >= 20000:
                _flush_parquet()
        state['rows'] += 1
        approx += size
        if stamp is not None:
            state['first'] = state['first'] if state['first'] is not None else stamp
            state['last'] = stamp
        if approx >= policy.piece_target:
            close_piece()
            approx = 0
            open_piece()
    close_piece()
    if not pieces:  # 행이 하나도 없으면 헤더만 있는 파일을 남긴다(0 행과 미수집을 manifest 사유로 구분)
        if art.fmt == 'csv':
            path = stage / f'{next(counter):08d}.piece'
            path.write_text(','.join(header) + '\r\n', encoding='utf-8')
            pieces.append(_finish_piece(scope, art, path, art.name, 0, None, None, policy, 'csv'))
        elif art.fmt == 'jsonl':
            path = stage / f'{next(counter):08d}.piece'
            path.write_bytes(b'')
            pieces.append(_finish_piece(scope, art, path, art.name, 0, None, None, policy, 'jsonl'))
    for i, p in enumerate(pieces, start=1):
        p.piece_index, p.piece_count = i, len(pieces)
        p.rel_path = _piece_name(art.name, i)
    return pieces


def _stage_text(scope: PackageScope, art: TextArtifact, stage: Path, policy: PackagePolicy, counter: Iterator[int]) -> Piece:
    path = stage / f'{next(counter):08d}.piece'
    path.write_text(art.text, encoding='utf-8')
    fmt = 'json' if art.name.endswith('.json') else 'text'
    return _finish_piece(scope, art, path, art.name, None, None, None, policy, fmt)  # type: ignore[arg-type]


def _stage_bin(scope: PackageScope, art: BinArtifact, stage: Path, policy: PackagePolicy, counter: Iterator[int]) -> Piece:
    path = stage / f'{next(counter):08d}.piece'
    digest = hashlib.sha256()
    with art.open() as src, open(path, 'wb') as dst:
        while chunk := src.read(1 << 20):
            digest.update(chunk)
            dst.write(chunk)
    if path.stat().st_size != art.size_bytes or digest.hexdigest() != art.sha256:
        path.unlink(missing_ok=True)
        raise PackageError('artifact_integrity', art.name)  # 서버 정본과 hash/크기가 다르면 만들지 않는다
    piece = Piece(scope=scope, rel_path=art.name, stage_path=path, kind=art.kind, signal=art.signal, fmt='bin',
                  bytes=art.size_bytes, sha256=art.sha256, rows=None, first=None, last=None,
                  schema_version=art.schema_version, dictionary_key=art.dictionary_key,
                  compressed=_compressed_size(path), extra_range=list(art.extra_range))
    return piece


README_TEXT = '''# MIND BREEZE 데이터 센터 반출 패키지

- 이 ZIP 은 단독으로 열립니다(part 마다 이 안내·data_dictionary.json·manifest.json 이 들어 있습니다). 여러 part 는 manifest.json 의 part 목록을 따릅니다.
- 파일은 UTF-8, 쉼표 구분(RFC 4180), 헤더 한 행입니다. 빈 칸/null 은 "수집·산출되지 않음"이며 0 과 다릅니다. 값은 반올림·보간하지 않았습니다.
- 모든 신호의 timestamp 는 측정 시작 기준 상대 초(feature 의 t_rel_ms 도 같은 원점)입니다. 가명 패키지는 날짜·절대시각·장치 시각을 담지 않습니다(date-withheld).
- 큰 파일은 행·레코드·row group 경계에서 나뉘며 `*.cont-0002.*` 형식으로 이어집니다. 각 조각에 헤더/스키마가 반복됩니다.
- 파일별 SHA-256·바이트·행수·범위·이어짐은 manifest.json 에 있습니다. ZIP 자체의 해시는 서버 작업 기록에 있습니다.
- 가명화는 익명화를 보장하지 않습니다. 승인된 목적 안에서 보관·재배포 책임을 지켜 주세요. 진단·치료 목적의 의료 데이터가 아닙니다.
- 원본 바이너리(raw bin)는 무손실 권한이 있을 때만 포함합니다. 권한이 없으면 포함하지 않으며 manifest 의 exclusions 에 사유(blocked_requires_redaction)가 기록됩니다.
- 상담·채팅·AI 본문, 실명(가명 패키지), 이메일, 전화, 생일 일자는 포함하지 않습니다.
'''

DICTIONARY_BASE = {
    'schema': PACKAGE_SCHEMA,
    'time_origin': '측정 시작(첫 샘플 index 0) 기준 상대 초; feature t_rel_ms 는 같은 원점의 ms',
    'null_policy': '빈 칸/JSON null = 미수집·산출 불가(0 아님). 사유는 manifest.exclusions 와 sidecar 에 기록',
    'files': {
        'eeg_raw': {'columns': ['timestamp', 'fp1', 'fp2'], 'units': {'timestamp': 's', 'fp1': 'uV', 'fp2': 'uV'}, 'float': 'float32 유효숫자 9자리'},
        'ppg_raw': {'columns': ['timestamp', 'red', 'ir'], 'units': {'timestamp': 's', 'red': 'ADC count', 'ir': 'ADC count'}, 'int': 'unsigned24 정수'},
        'acc_raw': {'columns': ['timestamp', 'x', 'y', 'z'], 'units': {'timestamp': 's', 'x': 'g', 'y': 'g', 'z': 'g'}},
        'features': {'columns': 'features.csv 헤더 참조(play_group_id, window_index, t_rel_ms, 원천 25개 지표, quality, device_timestamp_ms)'},
        'indices': {'columns': 'see indices.csv header', 'hrv': 'SDNN(ms) — RMSSD 는 features 에 별도', 'note': '종합 점수 없음'},
    },
}


def _participant_manifest_rows(pieces: list[Piece]) -> list[dict]:
    out = []
    for p in pieces:
        out.append({'path': p.arcname, 'kind': p.kind, 'signal': p.signal, 'format': p.fmt, 'bytes': p.bytes,
                    'sha256': p.sha256, 'rows': p.rows, 'schema_version': p.schema_version,
                    'dictionary_key': p.dictionary_key, 'range': {'first': p.first, 'last': p.last},
                    'piece_index': p.piece_index, 'piece_count': p.piece_count,
                    'continues': p.piece_index > 1, 'continues_in_next': p.piece_index < p.piece_count,
                    'extra_range': p.extra_range})
    return out


def _pack(pieces: list[Piece], cap: int) -> list[list[Piece]]:
    """참여자 경계를 우선하되 한 참여자가 한 part 보다 크면 조각 경계로 나눈다."""
    groups: list[list[Piece]] = []
    for p in pieces:
        if groups and groups[-1][0].scope == p.scope:
            groups[-1].append(p)
        else:
            groups.append([p])
    parts: list[list[Piece]] = [[]]
    used = 0
    for group in groups:
        size = sum(p.cost for p in group)
        if used and used + size > cap and size <= cap:
            parts.append([])
            used = 0
        for p in group:
            if p.cost > cap:
                raise PackageError('single_oversize', p.arcname)
            if used + p.cost > cap and parts[-1]:
                parts.append([])
                used = 0
            parts[-1].append(p)
            used += p.cost
    return [p for p in parts if p]


def _write_parts(job_alias: str, parts: list[list[Piece]], out: Path, policy: PackagePolicy, meta: dict) -> list[PartInfo]:
    infos: list[PartInfo] = []
    summary = [{'part_no': i, 'file_count': len(ps)} for i, ps in enumerate(parts, start=1)]
    readme = README_TEXT.encode()
    dictionary = json.dumps({**meta['dictionary']}, ensure_ascii=False, indent=2).encode()
    for no, ps in enumerate(parts, start=1):
        name = f'mbdc_{job_alias}_{policy.identity}_part{no}.zip'
        manifest = {
            'schema': PACKAGE_SCHEMA, 'job': job_alias, 'part_no': no, 'part_count': len(parts), 'state': 'complete',
            'identity': policy.identity, 'purpose': policy.purpose, 'eeg_format': policy.eeg_format,
            'policy_version': policy.policy_version, 'time': 'exact_utc' if policy.exact_time_allowed else 'date-withheld',
            'parts': summary, 'files': _participant_manifest_rows(ps), 'exclusions': meta['exclusions'],
            'source_revisions': meta['source_revisions'], 'preview_exclusion_counts': meta.get('preview_exclusion_counts', {}),
        }
        path = out / name
        with ZipFile(path, 'w', ZIP_DEFLATED, allowZip64=True) as zf:
            for arc, data in (('README_ko.md', readme), ('data_dictionary.json', dictionary),
                              ('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode())):
                info = ZipInfo(arc, FIXED_ZIP_TIME)
                info.compress_type, info.external_attr = ZIP_DEFLATED, 0o644 << 16
                zf.writestr(info, data)
            for p in ps:
                info = ZipInfo(p.arcname, FIXED_ZIP_TIME)
                info.compress_type, info.external_attr, info.file_size = ZIP_DEFLATED, 0o644 << 16, p.bytes
                with zf.open(info, 'w') as dest, open(p.stage_path, 'rb') as src:
                    shutil.copyfileobj(src, dest, 1 << 20)
        infos.append(PartInfo(no, path, path.stat().st_size, sha256_file(path), len(ps)))
    return infos


def build_data_center_package(job_alias: str, artifacts: Iterable[tuple[PackageScope, Artifact]], output_dir: Path,
                              policy: PackagePolicy, *, preview_exclusion_counts: dict | None = None,
                              max_repack: int = 8) -> PackageResult:
    """(scope, artifact) 스트림 → part ZIP 들. 인가·가명 별칭 결정은 호출자 책임이고 여기서는 누출·크기·무결성을 강제한다."""
    out = Path(output_dir)
    stage = out / '_stage'
    stage.mkdir(parents=True, exist_ok=True)
    counter = iter(range(1, 10**9))
    pieces: list[Piece] = []
    exclusions: list[dict] = []
    revisions: dict[tuple[str, str], int | None] = {}
    seen: set[str] = set()
    root_budget = len(README_TEXT.encode()) + 4096
    try:
        for scope, art in artifacts:
            revisions[(scope.session_label, scope.participant_alias)] = scope.manifest_revision
            if isinstance(art, MissingArtifact):
                exclusions.append({'scope': scope.directory, 'kind': art.kind, 'signal': art.signal, 'reason': art.reason})
                continue
            _check_rel_path(art.name)
            if isinstance(art, BinArtifact):
                if not policy.lossless_allowed:  # 원 UUID/tick/UTC 가 header 에 있어 그대로 담지 않는다
                    exclusions.append({'scope': scope.directory, 'kind': art.kind, 'signal': art.signal,
                                       'reason': 'blocked_requires_redaction'})
                    continue
                piece = _stage_bin(scope, art, stage, policy, counter)
                if piece.cost + root_budget > policy.part_max_bytes:  # 바이트 분할 금지 → 차단 + 대체 포맷 안내
                    piece.stage_path.unlink(missing_ok=True)
                    exclusions.append({'scope': scope.directory, 'kind': art.kind, 'signal': art.signal,
                                       'reason': 'single_oversize_bin', 'alternative': 'csv_or_parquet'})
                    continue
                new = [piece]
            elif isinstance(art, TextArtifact):
                new = [_stage_text(scope, art, stage, policy, counter)]
            else:
                new = _stage_rows(scope, art, stage, policy, counter)
            for p in new:
                if p.arcname in seen:
                    raise PackageError('duplicate_path', p.arcname)
                seen.add(p.arcname)
            pieces.extend(new)
        if not pieces:
            raise PackageError('empty_package')
        meta = {'dictionary': {**{k: v for k, v in DICTIONARY_BASE.items() if k != 'files'},
                               'files': {k: v for k, v in DICTIONARY_BASE['files'].items()}},
                'exclusions': exclusions,
                'source_revisions': [{'session': k[0], 'participant': k[1], 'manifest_revision': v}
                                     for k, v in sorted(revisions.items())],
                'preview_exclusion_counts': preview_exclusion_counts or {}}
        reserve = _compressed_bytes(README_TEXT.encode()) + 2048 + ZIP_END_RESERVE
        infos: list[PartInfo] = []
        for _ in range(max_repack):
            cap = policy.part_max_bytes - reserve
            if cap <= 0:
                raise PackageError('part_limit_unreachable')
            parts = _pack(pieces, cap)
            for old in out.glob('mbdc_*.zip'):
                old.unlink()
            infos = _write_parts(job_alias, parts, out, policy, meta)
            over = max(i.size_bytes for i in infos) - policy.part_max_bytes
            if over <= 0:
                break
            reserve += over * 2 + 1024  # 루트 메타·central directory 가 예상보다 컸다 — 마지막 조각을 다음 part 로 밀어낸다
        else:
            raise PackageError('part_limit_unreachable')
        files = [row for p in pieces for row in _participant_manifest_rows([p])]
        return PackageResult(parts=infos, files=files, exclusions=exclusions, source_revisions=meta['source_revisions'],
                             warnings=sorted({f"{e['reason']}:{e.get('signal') or e['kind']}" for e in exclusions}))
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def _compressed_bytes(data: bytes) -> int:
    comp = zlib.compressobj(zlib.Z_DEFAULT_COMPRESSION, zlib.DEFLATED, -15)
    return len(comp.compress(data)) + len(comp.flush())
