"""SDD-243 측정 1건 상세 조회(B04): 파형·feature·표시 지표·PSD.

- 파형은 호출자가 고른 `[from,to)` 에 해당하는 청크만 **순차로 한 청크씩** 읽어 해제한다(전 회차를 FE/메모리에 올리지 않는다).
  좁으면 원본 샘플, 길면 시간 버킷 min/max envelope. 채널당 값 수 ≤ max_points(기본 2000, 최대 4000).
- gap·reset·overlap·시간축 불명은 연결·보간·묵시 중복제거를 하지 않고 segment/gap/사유로 드러낸다.
- 244 와의 경계: manifest·청크 바이트·디코더는 `MeasurementBackend`(T06 `get_manifest`, T03 `decode_raw_chunk`) 로 주입한다.
  T06 이 연결되기 전 기본 backend 는 `NullBackend`(manifest_not_connected)이며, 임의 shim 으로 완료 처리하지 않는다.
- 표시 지표(6값)는 저장된 당시 snapshot 만 통과시킨다. 서버가 feature 로 재구성하거나 점수·종합점수를 만들지 않는다.
"""
import math
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any, Callable, Iterable, Protocol
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app.models.eeg_feature import EEGFeatureWindow
from app.models.session import SessionParticipant
from app.schemas import data_center as dc
from app.schemas.data_center import GapRange  # noqa: F401 — manifest gap 표현(계약 DTO 재사용)
from app.services.data_center_policy import ResolvedContext, deny, not_found, scoped_participants
from app.services.data_center_query import decode_cursor, encode_cursor, filters_hash, now

MAX_POINTS_DEFAULT = 2000
MAX_POINTS_LIMIT = 4000
MAX_CHUNKS_PER_REQUEST = 2000
SPECTRUM_MIN_US = 2_000_000
SPECTRUM_MAX_US = 30_000_000
COVERAGE_MIN = 0.98  # 요청 구간 중 실제 연속 데이터가 차지해야 하는 비율

FEATURE_COLUMNS = (
    'focus_index', 'cognitive_load', 'relaxation_index', 'stress_index', 'emotional_stability', 'total_neural_activity',
    'faa', 'hemispheric_balance', 'delta_power', 'theta_power', 'alpha_power', 'beta_power', 'gamma_power', 'total_power',
    'meditation_level', 'attention_level', 'signal_quality', 'sdnn', 'rmssd', 'lf_power', 'hf_power', 'lf_hf_ratio',
    'heart_rate', 'respiratory_rate', 'motion',
)
FEATURE_UNITS = {'heart_rate': 'bpm', 'respiratory_rate': 'breaths/min', 'sdnn': 'ms', 'rmssd': 'ms', 'faa': 'ratio'}


# ── 244 경계(계약 기반 어댑터 인터페이스) ───────────────────────────────

@dataclass(frozen=True)
class ChunkRef:
    """manifest 가 알려 주는 청크 1개. `meta` 는 디코더에 그대로 전달되는 불투명 값(저장 key 는 API 로 노출하지 않는다)."""
    signal: str
    stream_id: str
    segment_id: str
    chunk_index: int
    first_sample_index: int
    end_sample_index_exclusive: int
    start_us: int | None  # 측정 시작 기준 상대 µs, 시간축 불명이면 None
    end_us: int | None
    meta: Any = None


@dataclass(frozen=True)
class StreamInfo:
    stream_id: str
    segment_id: str
    signal: str
    rate_hz: float | None  # manifest 의 명목 rate(검증된 25Hz 를 30Hz 로 라벨 교체하지 않는다)
    observed_rate_hz: float | None
    channels: tuple[str, ...]
    units: tuple[str, ...]
    time_basis: str


@dataclass(frozen=True)
class ManifestView:
    revision: int
    close_state: str  # pending_upload | partial | complete | unknown
    default_view: str
    signals: dict[str, tuple[str, str | None]]  # signal -> (availability, reason)
    streams: tuple[StreamInfo, ...]
    chunks: tuple[ChunkRef, ...]
    gaps: tuple[dc.GapRange, ...] = ()


class SampleLike(Protocol):
    sample_index: int
    relative_us: Fraction | None
    values: tuple[float, ...]
    channels: tuple[str, ...]
    time_basis: str
    null_reasons: dict[str, str]


class MeasurementBackend(Protocol):
    def get_manifest(self, session_id: UUID, participant_id: UUID, revision: int | None = None) -> ManifestView | None: ...
    def fetch(self, chunk: ChunkRef) -> bytes: ...
    def decode(self, payload: bytes, chunk: ChunkRef) -> Iterable[SampleLike]: ...


class NullBackend:
    """T06 미연결 기본값 — manifest 가 없으므로 데이터를 만들어 내지 않는다."""

    def get_manifest(self, session_id: UUID, participant_id: UUID, revision: int | None = None) -> None:
        return None

    def fetch(self, chunk: ChunkRef) -> bytes:  # pragma: no cover — manifest 가 없으면 호출되지 않는다
        raise RuntimeError('backend not connected')

    def decode(self, payload: bytes, chunk: ChunkRef) -> Iterable[SampleLike]:  # pragma: no cover
        raise RuntimeError('backend not connected')


_registered: MeasurementBackend | None = None


def register_backend(backend: MeasurementBackend | None) -> None:
    """244 T06/T03 어댑터를 연결하는 단일 지점(통합 단계에서 호출)."""
    global _registered
    _registered = backend


def default_backend() -> MeasurementBackend:
    return _registered or NullBackend()


# ── 공통 ────────────────────────────────────────────────────────────────

def authorize_measurement(db: DBSession, context: ResolvedContext, session_id: UUID, participant_id: UUID) -> SessionParticipant:
    part = scoped_participants(db, context).filter(SessionParticipant.id == participant_id,
                                                   SessionParticipant.session_id == session_id).first()
    if part is None:
        raise not_found()
    return part


def parse_us(value: str | None) -> int | None:
    return int(value) if value is not None else None


def _check_range(from_us: int | None, to_us: int | None) -> None:
    if from_us is not None and to_us is not None and from_us >= to_us:
        raise deny(422, 'range_invalid', '구간의 시작이 끝보다 앞서야 합니다')


def _manifest(backend: MeasurementBackend, session_id: UUID, participant_id: UUID) -> ManifestView | None:
    manifest = backend.get_manifest(session_id, participant_id, None)
    if manifest is not None and manifest.close_state == 'pending_upload':
        raise deny(409, 'manifest_pending', '측정 데이터가 아직 준비 중입니다. 잠시 후 다시 시도해 주세요')
    return manifest


def _select_chunks(manifest: ManifestView, signal: str, from_us: int | None, to_us: int | None) -> list[ChunkRef]:
    chunks = [c for c in manifest.chunks if c.signal == signal]
    chunks.sort(key=lambda c: (c.start_us is None, c.start_us or 0, c.stream_id, c.segment_id, c.chunk_index))
    picked = []
    for c in chunks:
        if c.start_us is not None and c.end_us is not None:
            if (to_us is not None and c.start_us >= to_us) or (from_us is not None and c.end_us <= from_us):
                continue
        picked.append(c)
    if len(picked) > MAX_CHUNKS_PER_REQUEST:
        raise deny(413, 'range_too_large', '조회 구간이 너무 깁니다. 구간을 줄여 주세요')
    return picked


def _stream_of(manifest: ManifestView, chunk: ChunkRef) -> StreamInfo | None:
    for s in manifest.streams:
        if s.stream_id == chunk.stream_id and s.segment_id == chunk.segment_id and s.signal == chunk.signal:
            return s
    for s in manifest.streams:
        if s.signal == chunk.signal:
            return s
    return None


def _stream_samples(backend: MeasurementBackend, chunks: list[ChunkRef]):
    """청크를 한 번에 하나씩 읽고 해제한다."""
    for chunk in chunks:
        payload = backend.fetch(chunk)
        yield chunk, list(backend.decode(payload, chunk))
        del payload


def _empty_waveform(sel: dc.MeasurementSelection, signal: str, max_points: int, availability: str, reason: str | None,
                    revision: int | None = None, *, time_basis: str = 'unknown', from_us=None, to_us=None) -> dc.WaveformResponse:
    return dc.WaveformResponse(session_id=sel.session_id, participant_id=sel.participant_id, signal_type=signal,  # type: ignore[arg-type]
                               availability=availability, unavailable_reason=reason, manifest_revision=revision,  # type: ignore[arg-type]
                               max_points=max_points, time_basis=time_basis,  # type: ignore[arg-type]
                               from_us=None if from_us is None else str(from_us), to_us=None if to_us is None else str(to_us))


@dataclass
class _Run:
    key: tuple[str, str]
    start: int
    end: int
    first_index: int
    last_index: int


# ── 파형(#16) ───────────────────────────────────────────────────────────

def read_waveform(backend: MeasurementBackend, sel: dc.MeasurementSelection, signal: str,
                  max_points: int = MAX_POINTS_DEFAULT) -> dc.WaveformResponse:
    if not 10 <= max_points <= MAX_POINTS_LIMIT:
        raise deny(422, 'max_points_invalid', f'max_points 는 10~{MAX_POINTS_LIMIT} 입니다')
    from_us, to_us = parse_us(sel.from_us), parse_us(sel.to_us)
    _check_range(from_us, to_us)
    manifest = _manifest(backend, sel.session_id, sel.participant_id)
    if manifest is None:
        return _empty_waveform(sel, signal, max_points, 'unknown', 'manifest_not_connected', from_us=from_us, to_us=to_us)
    availability, reason = manifest.signals.get(signal, ('unknown', 'signal_missing'))
    if availability != 'available':
        return _empty_waveform(sel, signal, max_points, availability, reason, manifest.revision, from_us=from_us, to_us=to_us)
    chunks = _select_chunks(manifest, signal, from_us, to_us)
    if not chunks:
        return _empty_waveform(sel, signal, max_points, 'available', 'no_data_in_range', manifest.revision,
                               from_us=from_us, to_us=to_us)
    starts = [c.start_us for c in chunks if c.start_us is not None]
    ends = [c.end_us for c in chunks if c.end_us is not None]
    if not starts or not ends or len(starts) != len(chunks):
        return _empty_waveform(sel, signal, max_points, 'unknown', 'legacy_time_origin_unknown', manifest.revision,
                               from_us=from_us, to_us=to_us)
    eff_from = max(from_us, min(starts)) if from_us is not None else min(starts)
    eff_to = min(to_us, max(ends)) if to_us is not None else max(ends)
    if eff_to <= eff_from:
        return _empty_waveform(sel, signal, max_points, 'available', 'no_data_in_range', manifest.revision,
                               from_us=from_us, to_us=to_us)
    span = eff_to - eff_from
    buckets = max_points // 2

    raw_points: list[tuple[int, int, tuple[str, str], tuple[float, ...]]] = []  # (t_us, sample_index, key, values)
    overflow = False
    source_count = 0
    channels: tuple[str, ...] = ()
    time_basis = 'unknown'
    mins: list[list[float | None]] = []
    maxs: list[list[float | None]] = []
    bucket_key: list[tuple[str, str] | None] = []
    bucket_first: list[int] = []
    bucket_last: list[int] = []
    gaps: list[dc.GapRange] = []
    notes: dict[str, str] = {}
    prev: tuple[tuple[str, str], int, int] | None = None  # (key, sample_index, t_us)
    breaks: set[int] = set()  # raw_points 인덱스 중 새 segment 가 시작하는 위치

    for chunk, samples in _stream_samples(backend, chunks):
        key = (chunk.stream_id, chunk.segment_id)
        for s in samples:
            if s.relative_us is None:
                return _empty_waveform(sel, signal, max_points, 'unknown', 'legacy_time_origin_unknown', manifest.revision,
                                       from_us=from_us, to_us=to_us)
            t = int(s.relative_us)  # 내림 — 유리수 시간에서 직접 계산(누적 반올림 없음)
            if t < eff_from or t >= eff_to:
                continue
            if not channels:
                channels, time_basis = tuple(s.channels), s.time_basis
                mins = [[None] * buckets for _ in channels]
                maxs = [[None] * buckets for _ in channels]
                bucket_key = [None] * buckets
                bucket_first = [0] * buckets
                bucket_last = [0] * buckets
            source_count += 1
            new_segment = False
            if prev is None or prev[0] != key:
                new_segment = True
            elif s.sample_index <= prev[1] or t <= prev[2]:
                new_segment = True
                notes['overlap'] = 'chunk_overlap'
            elif s.sample_index != prev[1] + 1:
                new_segment = True
                gaps.append(dc.GapRange(start_us=str(prev[2]), end_us=str(t), reason='sample_index_gap',
                                        observed_or_estimated='observed'))
            prev = (key, s.sample_index, t)
            vals = tuple(float(v) for v in s.values)
            if not overflow:
                if new_segment:
                    breaks.add(len(raw_points))
                raw_points.append((t, s.sample_index, key, vals))
                if len(raw_points) > max_points:
                    overflow = True
            b = min(buckets - 1, ((t - eff_from) * buckets) // span)
            for ci, v in enumerate(vals):
                lo, hi = mins[ci][b], maxs[ci][b]
                mins[ci][b] = v if lo is None or v < lo else lo
                maxs[ci][b] = v if hi is None or v > hi else hi
            if bucket_key[b] is None:
                bucket_key[b], bucket_first[b] = key, s.sample_index
            elif bucket_key[b] != key:
                bucket_key[b] = ('*', '*')  # 한 버킷에 두 segment — 경계 표시
            bucket_last[b] = s.sample_index
    if source_count == 0:
        return _empty_waveform(sel, signal, max_points, 'available', 'no_data_in_range', manifest.revision,
                               from_us=from_us, to_us=to_us)

    stream = _stream_of(manifest, chunks[0])
    units = {n: u for n, u in zip(stream.channels, stream.units)} if stream else {}
    gaps += [g for g in manifest.gaps if int(g.start_us) < eff_to and (g.end_us is None or int(g.end_us) > eff_from)]

    if not overflow:
        order = range(len(raw_points))
        t_us = [str(raw_points[i][0]) for i in order]
        ch = [dc.WaveformChannel(name=name, unit=units.get(name, ''),
                                 values=[raw_points[i][3][ci] for i in order]) for ci, name in enumerate(channels)]
        runs: list[_Run] = []
        for i in order:
            t, idx, key, _ = raw_points[i]
            if not runs or i in breaks:
                runs.append(_Run(key, i, i + 1, idx, idx))
            else:
                runs[-1].end, runs[-1].last_index = i + 1, idx
        method, returned = 'raw', len(raw_points)
    else:
        t_us = [str(eff_from + (b * span) // buckets) for b in range(buckets)]
        ch = [dc.WaveformChannel(name=name, unit=units.get(name, ''), min=mins[ci], max=maxs[ci])
              for ci, name in enumerate(channels)]
        runs = []
        for b in range(buckets):
            key = bucket_key[b]
            if key is None:
                continue
            if runs and runs[-1].end == b and runs[-1].key == key and key != ('*', '*'):
                runs[-1].end, runs[-1].last_index = b + 1, bucket_last[b]
            else:
                runs.append(_Run(key, b, b + 1, bucket_first[b], bucket_last[b]))
        method, returned = 'minmax_envelope', buckets
    segments = [dc.WaveformSegment(stream_id=r.key[0], segment_id=r.key[1], point_start=r.start, point_end=r.end,
                                   first_sample_index=r.first_index, end_sample_index_exclusive=r.last_index + 1) for r in runs]
    return dc.WaveformResponse(
        session_id=sel.session_id, participant_id=sel.participant_id, signal_type=signal,  # type: ignore[arg-type]
        availability='available', manifest_revision=manifest.revision, from_us=str(eff_from), to_us=str(eff_to),
        method=method, max_points=max_points, source_sample_count=source_count, returned_count=returned,  # type: ignore[arg-type]
        nominal_rate_hz=stream.rate_hz if stream else None, observed_rate_hz=stream.observed_rate_hz if stream else None,
        time_basis=time_basis, t_us=t_us, channels=ch, segments=segments, gaps=gaps, null_reasons=notes)  # type: ignore[arg-type]


# ── PSD(#18) ────────────────────────────────────────────────────────────

try:  # numpy 는 livekit 의존성으로 이미 설치돼 있다. 없으면 순수 파이썬 DFT 로 대체.
    import numpy as np
except ImportError:  # pragma: no cover
    np = None


def welch_psd(x: list[float], fs: float, window_sec: float = 2.0, overlap: float = 0.5) -> tuple[list[float], list[float]]:
    """Hann 창·50% overlap·창별 평균 제거·one-sided density (단위: 입력단위²/Hz). 버전 `dc-welch-v1`."""
    n = round(window_sec * fs)
    step = n - round(n * overlap)
    if n < 4 or len(x) < n or step < 1:
        raise ValueError('too short')
    window = [0.5 - 0.5 * math.cos(2 * math.pi * k / n) for k in range(n)]  # periodic Hann
    scale = 1.0 / (fs * sum(w * w for w in window))
    count = (len(x) - n) // step + 1
    bins = n // 2 + 1
    acc = [0.0] * bins
    if np is not None:
        arr = np.asarray(x, dtype=float)
        win = np.asarray(window)
        total = np.zeros(bins)
        for i in range(count):
            seg = arr[i * step:i * step + n]
            seg = (seg - seg.mean()) * win
            total += np.abs(np.fft.rfft(seg)) ** 2
        acc = [float(v) for v in total]
    else:  # pragma: no cover — 대체 경로(검증용 테스트에서 np=None 으로 강제)
        cos_t = [[math.cos(2 * math.pi * k * j / n) for j in range(n)] for k in range(bins)]
        sin_t = [[math.sin(2 * math.pi * k * j / n) for j in range(n)] for k in range(bins)]
        for i in range(count):
            seg = x[i * step:i * step + n]
            mean = sum(seg) / n
            seg = [(v - mean) * w for v, w in zip(seg, window)]
            for k in range(bins):
                re = sum(v * c for v, c in zip(seg, cos_t[k]))
                im = sum(v * s for v, s in zip(seg, sin_t[k]))
                acc[k] += re * re + im * im
    psd = [v / count * scale for v in acc]
    last = bins - 1 if n % 2 == 0 else bins
    for k in range(1, last):  # one-sided: DC·Nyquist 제외 두 배
        psd[k] *= 2
    return [k * fs / n for k in range(bins)], psd


def read_spectrum(backend: MeasurementBackend, sel: dc.MeasurementSelection) -> dc.SpectrumResponse:
    from_us, to_us = parse_us(sel.from_us), parse_us(sel.to_us)
    if from_us is None or to_us is None:
        raise deny(422, 'range_required', '스펙트럼은 구간(from_us, to_us)이 필요합니다')
    _check_range(from_us, to_us)

    def no(reason: str) -> dc.SpectrumResponse:
        return dc.SpectrumResponse(session_id=sel.session_id, participant_id=sel.participant_id, computable=False,
                                   reason=reason, from_us=str(from_us), to_us=str(to_us))

    span = to_us - from_us
    if span < SPECTRUM_MIN_US:
        return no('range_too_short')
    if span > SPECTRUM_MAX_US:
        return no('range_too_long')
    manifest = _manifest(backend, sel.session_id, sel.participant_id)
    if manifest is None:
        return no('manifest_not_connected')
    availability, _ = manifest.signals.get('eeg', ('unknown', None))
    if availability != 'available':
        return no(f'signal_{availability}')
    if any(int(g.start_us) < to_us and (g.end_us is None or int(g.end_us) > from_us) for g in manifest.gaps):
        return no('gap_in_range')
    chunks = _select_chunks(manifest, 'eeg', from_us, to_us)
    if not chunks:
        return no('no_data_in_range')
    stream = _stream_of(manifest, chunks[0])
    if stream is None or not stream.rate_hz:
        return no('rate_unknown')
    series: list[list[float]] = []
    names: tuple[str, ...] = ()
    prev: tuple[tuple[str, str], int] | None = None
    first_t = last_t = None
    for chunk, samples in _stream_samples(backend, chunks):
        key = (chunk.stream_id, chunk.segment_id)
        for s in samples:
            if s.relative_us is None:
                return no('time_axis_unknown')
            t = int(s.relative_us)
            if t < from_us or t >= to_us:
                continue
            if prev is not None and (prev[0] != key or s.sample_index != prev[1] + 1):
                return no('gap_in_range')
            prev = (key, s.sample_index)
            if not series:
                names = tuple(s.channels)
                series = [[] for _ in names]
            for ci, v in enumerate(s.values):
                series[ci].append(float(v))
            first_t = t if first_t is None else first_t
            last_t = t
    if not series or first_t is None or last_t is None:
        return no('no_data_in_range')
    covered = last_t - first_t + 1_000_000 / stream.rate_hz
    if covered < COVERAGE_MIN * span:
        return no('insufficient_coverage')
    try:
        out = [welch_psd(ch, stream.rate_hz) for ch in series]
    except ValueError:
        return no('range_too_short')
    return dc.SpectrumResponse(session_id=sel.session_id, participant_id=sel.participant_id, computable=True,
                               from_us=str(from_us), to_us=str(to_us), freq_hz=out[0][0],
                               channels=[dc.SpectrumChannel(name=n, psd=p) for n, (_, p) in zip(names, out)])


# ── feature(#17) · 표시 지표(#32) ───────────────────────────────────────

def _window_page(db: DBSession, sel: dc.MeasurementSelection, query: dc.DataCenterQuery, flt: str, *, kind: str):
    base = db.query(EEGFeatureWindow).filter(EEGFeatureWindow.session_id == sel.session_id,
                                             EEGFeatureWindow.participant_id == sel.participant_id)
    origin = db.query(func.min(EEGFeatureWindow.device_timestamp_ms)).filter(
        EEGFeatureWindow.session_id == sel.session_id, EEGFeatureWindow.participant_id == sel.participant_id).scalar()
    from_us, to_us = parse_us(sel.from_us), parse_us(sel.to_us)
    _check_range(from_us, to_us)

    def rel_ms(row: EEGFeatureWindow) -> int | None:
        if row.device_timestamp_ms is None or origin is None:
            return None
        return round(row.device_timestamp_ms - origin)

    if from_us is not None or to_us is not None:
        if origin is None:
            base = base.filter(EEGFeatureWindow.id.is_(None))
        else:
            if from_us is not None:
                base = base.filter(EEGFeatureWindow.device_timestamp_ms >= origin + from_us / 1000)
            if to_us is not None:
                base = base.filter(EEGFeatureWindow.device_timestamp_ms < origin + to_us / 1000)
    total = base.count()
    q = base
    as_of = now()
    if query.cursor:
        payload, as_of = decode_cursor(query.cursor, flt)
        q = q.filter((EEGFeatureWindow.window_index > payload['w']) |
                     ((EEGFeatureWindow.window_index == payload['w']) & (EEGFeatureWindow.id > UUID(payload['id']))))
    rows = q.order_by(EEGFeatureWindow.window_index, EEGFeatureWindow.id).limit(query.limit + 1).all()
    more = len(rows) > query.limit
    rows = rows[:query.limit]
    nxt = encode_cursor({'w': rows[-1].window_index, 'id': str(rows[-1].id)}, flt, as_of) if more and rows else None
    return rows, rel_ms, total, nxt, as_of


def read_features(db: DBSession, sel: dc.MeasurementSelection, query: dc.DataCenterQuery) -> dc.FeaturePage:
    flt = filters_hash_for(sel, 'features', query)
    rows, rel_ms, total, nxt, as_of = _window_page(db, sel, query, flt, kind='features')
    items = [dc.FeatureRow(window_index=r.window_index, t_rel_ms=rel_ms(r), quality=r.quality, source='scalar_1hz',
                           values={c: getattr(r, c) for c in FEATURE_COLUMNS},  # 원 float·null 그대로(0 대체 없음)
                           units={c: FEATURE_UNITS[c] for c in FEATURE_COLUMNS if c in FEATURE_UNITS}) for r in rows]
    return dc.FeaturePage(session_id=sel.session_id, participant_id=sel.participant_id, as_of=as_of, items=items,
                          next_cursor=nxt, total=total)


def filters_hash_for(sel: dc.MeasurementSelection, resource: str, query: dc.DataCenterQuery) -> str:
    import hashlib
    import json
    payload = {'r': resource, 's': str(sel.session_id), 'p': str(sel.participant_id), 'from': sel.from_us, 'to': sel.to_us}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


MISSING = dc.IndexMetric(value=None, status='display_history_missing', source='none', reason='저장 이전 표시값 없음')


def read_indices(db: DBSession, backend: MeasurementBackend, sel: dc.MeasurementSelection,
                 query: dc.DataCenterQuery) -> dc.IndicesPage:
    """당시 표시 snapshot 만 통과. snapshot 이 없으면 feature 로 재구성하지 않고 null+사유 행을 돌려준다."""
    snapshots: Callable | None = getattr(backend, 'indices', None)
    manifest = backend.get_manifest(sel.session_id, sel.participant_id, None)
    if snapshots is not None and manifest is not None:
        view, rows, nxt = snapshots(sel.session_id, sel.participant_id, manifest.revision, query.cursor, query.limit)
        return dc.IndicesPage(session_id=sel.session_id, participant_id=sel.participant_id, as_of=now(), view=view,
                              items=list(rows), next_cursor=nxt)
    flt = filters_hash_for(sel, 'indices', query)
    rows, rel_ms, _, nxt, as_of = _window_page(db, sel, query, flt, kind='indices')
    items = [dc.IndexRow(t_rel_ms=rel_ms(r), focus=MISSING, relaxation=MISSING, emotional_balance=MISSING, bpm=MISSING,
                         respiration=MISSING, hrv_sdnn_ms=MISSING) for r in rows]
    return dc.IndicesPage(session_id=sel.session_id, participant_id=sel.participant_id, as_of=as_of,
                          view='unavailable', items=items, next_cursor=nxt,
                          note='당시 표시 snapshot 이 저장되지 않았습니다(재구성·리포트 집계값과 섞지 않음)')
