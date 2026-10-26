"""SDD-244 G1 불변 계약. 저장/디코더/인가 구현 없이 순수 DTO만 정의한다.

JSON Schema는 구조 검사용이며 model_validator의 교차 필드 규칙은 소비자도
README의 의미 검증 규칙대로 검사해야 한다. 내부 ID와 공개 alias DTO를 분리한다.
"""
from typing import Annotated, Literal, Self, get_args
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

NonNegative = Annotated[int, Field(ge=0, strict=True)]
Positive = Annotated[int, Field(gt=0, strict=True)]
Finite = Annotated[float, Field(allow_inf_nan=False, strict=True)]
Sha256 = Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]
def _int64(value: str) -> str:
    if value == '-0' or not -(2**63) <= int(value) < 2**63:
        raise ValueError('canonical int64 범위 필요')
    return value


DecimalInt = Annotated[str, Field(pattern=r'^-?(0|[1-9][0-9]{0,18})$'), AfterValidator(_int64)]
Text = Annotated[str, Field(min_length=1)]
Alias = Annotated[str, Field(pattern=r'^[A-Z][A-Za-z0-9_-]{0,63}$')]
Signal = Literal['eeg', 'ppg', 'acc']
TimeBasis = Literal['host_estimated', 'device_relative', 'utc_verified', 'session_relative']
Availability = Literal['available', 'not_collected', 'unsupported_client', 'expired', 'withdrawn', 'lost', 'unknown', 'blocked']


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False, json_schema_extra={'$schema': 'https://json-schema.org/draft/2020-12/schema'})


class Rate(Contract):
    numerator: Positive
    denominator: Positive


class ParserProfile(Contract):
    firmware: Text
    device_model: Text
    profile_id: Text
    version: Text
    parameters_hash: Sha256
    platform: Literal['mb-web', 'mb-app-js', 'native-candidate', 'synthetic']
    verification: Literal['unverified', 'synthetic_only', 'device_verified']
    packet_endian: Literal['little', 'big', 'mixed', 'unknown']
    tick_hz: Positive
    tick_bits: Positive
    header_anchor: Literal['first_sample', 'last_sample', 'unknown']


class Anchor(Contract):
    sample_index: NonNegative
    utc_us: DecimalInt | None
    monotonic_us: DecimalInt
    relative_us: DecimalInt
    device_tick_raw: DecimalInt | None
    device_tick_unwrapped: DecimalInt | None
    clock_segment_id: UUID
    uncertainty_us: NonNegative | None
    rule: Literal['anchor_plus_index_delta_over_rate']


class RawSection(Contract):
    name: Literal['samples', 'packets', 'packet_map']
    offset: NonNegative
    length: NonNegative
    row_stride: NonNegative
    encoding: Literal['eeg-i32-i32-u8-f32-f32-le', 'ppg-u32-u32-le', 'acc-i16-i16-i16-f32-f32-f32-le', 'bytes', 'utf8-jsonl']


class RawHeader(Contract):
    schema_version: Literal['mb-biosignal-raw-v2']
    signal_type: Signal
    stream_id: UUID
    segment_id: UUID
    chunk_index: NonNegative
    parser_profile: ParserProfile
    rate: Rate
    observed_rate: Rate | None
    observed_rate_window_us: Positive | None
    observed_rate_reason: Text | None
    channels: list[Text]
    units: list[Text]
    scale: list[Finite]
    sample_count: NonNegative
    packet_count: NonNegative
    first_sample_index: NonNegative
    end_sample_index_exclusive: NonNegative
    time_basis: TimeBasis
    anchor: Anchor
    sections: Annotated[list[RawSection], Field(min_length=3, max_length=3)]

    @model_validator(mode='after')
    def coherent(self) -> Self:
        layouts = {
            'eeg': (['fp1', 'fp2'], ['uV', 'uV'], 17, 'eeg-i32-i32-u8-f32-f32-le', 250),
            'ppg': (['red', 'ir'], ['ADC_count', 'ADC_count'], 8, 'ppg-u32-u32-le', 50),
            'acc': (['x', 'y', 'z'], ['g', 'g', 'g'], 18, 'acc-i16-i16-i16-f32-f32-f32-le', None),
        }
        channels, units, stride, encoding, rate = layouts[self.signal_type]
        if self.channels != channels or self.units != units or len(self.scale) != len(channels):
            raise ValueError('신호별 채널·단위·환산계수 불일치')
        if rate and self.rate.numerator != rate * self.rate.denominator:
            raise ValueError('EEG 250Hz / PPG 50Hz 명목 rate 불일치')
        if self.observed_rate is None:
            if not self.observed_rate_reason or self.observed_rate_window_us is not None:
                raise ValueError('실측 rate 미확인 사유 필요')
        elif self.observed_rate_window_us is None or self.observed_rate_reason is not None:
            raise ValueError('실측 rate에는 관측 구간 필요')
        if self.end_sample_index_exclusive - self.first_sample_index != self.sample_count:
            raise ValueError('샘플 범위/count 불일치')
        if self.time_basis == 'device_relative' and self.anchor.utc_us is not None:
            raise ValueError('device_relative UTC 승격 금지')
        if self.time_basis == 'utc_verified' and self.anchor.utc_us is None:
            raise ValueError('UTC 근거 필요')
        offset = 0
        expected = [('samples', stride, encoding), ('packets', 0, 'bytes'), ('packet_map', 0, 'utf8-jsonl')]
        for section, (name, size, codec) in zip(self.sections, expected, strict=True):
            if (section.name, section.row_stride, section.encoding) != (name, size, codec) or section.offset != offset:
                raise ValueError('section 순서/stride/encoding/범위 불일치')
            offset += section.length
        if self.sections[0].length != stride * self.sample_count or offset > 1_048_576:
            raise ValueError('sample bytes/count 또는 청크 상한 불일치')
        return self


class PacketMap(Contract):
    packet_seq: NonNegative
    byte_offset: NonNegative
    byte_length: Positive
    first_sample_index: NonNegative | None
    sample_count: NonNegative
    tick_raw: DecimalInt | None
    tick_unwrapped: DecimalInt | None
    received_utc_us: DecimalInt | None
    received_monotonic_us: DecimalInt
    header_anchor: Literal['first_sample', 'last_sample', 'unknown']
    clock_segment_id: UUID
    malformed_reason: Text | None

    @model_validator(mode='after')
    def malformed_has_no_samples(self) -> Self:
        if self.malformed_reason and (self.sample_count != 0 or self.first_sample_index is not None):
            raise ValueError('malformed 패킷에서 샘플 위조 금지')
        if self.sample_count and self.first_sample_index is None:
            raise ValueError('정상 샘플 시작 index 필요')
        return self


class RawChunkMeta(Contract):
    session_id: UUID
    participant_id: UUID
    play_group_id: UUID | None
    chunk_id: UUID
    header: RawHeader
    checksum: Sha256
    size_bytes: Annotated[int, Field(gt=12, le=1_048_576, strict=True)]
    object_key: Text
    object_version_id: Text | None


class AckReceipt(Contract):
    chunk_id: UUID
    checksum: Sha256
    size_bytes: Positive
    status: Literal['uploaded', 'failed', 'pending']
    verified_at_us: DecimalInt | None
    failure_reason: Text | None

    @model_validator(mode='after')
    def verified_success(self) -> Self:
        if self.status == 'uploaded' and (self.verified_at_us is None or self.failure_reason is not None):
            raise ValueError('성공 ACK에는 검증시각 필요')
        if self.status != 'uploaded' and not self.failure_reason:
            raise ValueError('미확정 ACK 사유 필요')
        return self


class TimeRange(Contract):
    from_us: DecimalInt
    to_us: DecimalInt

    @model_validator(mode='after')
    def ordered(self) -> Self:
        if int(self.from_us) > int(self.to_us):
            raise ValueError('[from,to) 범위 역전')
        return self


class GapEvent(Contract):
    discovered_at_us: DecimalInt
    event_id_alias: Alias
    signal: Signal
    stream_alias: Alias
    segment_alias: Alias
    start_us: DecimalInt
    end_us: DecimalInt | None
    reason: Literal['ble_disconnect', 'packet_gap', 'local_write_failed', 'process_terminated', 'clock_reset', 'wall_clock_jump', 'reanchor', 'unknown', 'upload_pending', 'not_rendered']
    observed_or_estimated: Literal['observed', 'estimated', 'unknown']
    expected_samples: NonNegative | None
    received_samples: NonNegative | None
    reconnect_count: NonNegative
    sequence: NonNegative

    @model_validator(mode='after')
    def unknown_is_not_zero(self) -> Self:
        if self.end_us is not None and int(self.end_us) < int(self.start_us):
            raise ValueError('gap 범위 역전')
        if self.observed_or_estimated == 'unknown' and self.expected_samples is not None:
            raise ValueError('불명 손실량은 null')
        return self


class AlgorithmSnapshot(Contract):
    algorithm_id: Text
    algorithm_version: Text
    parameters_hash: Sha256
    parameters: dict[str, Finite | str | bool | list[Finite]]
    filter_version: Text
    build: Text


class NormalizationMetric(Contract):
    m: Finite | None
    s: Annotated[float, Field(gt=0, allow_inf_nan=False, strict=True)] | None
    direction: Literal[-1, 1] | None
    source: Literal['standard_model', 'cohort', 'b0']
    b0_version: Text | None
    fallback_reason: Text | None


    @model_validator(mode='after')
    def source_parameters(self) -> Self:
        if self.source == 'standard_model' and any(v is None for v in (self.m, self.s, self.direction)):
            raise ValueError('standard_model sigmoid 파라미터 필요')
        if self.source in ('cohort', 'b0') and (not self.b0_version or not self.fallback_reason):
            raise ValueError('B0/cohort 버전 및 선택 사유 필요')
        return self


class NormalizationSnapshot(Contract):
    model_id_alias: Alias
    version: Text
    params_hash: Sha256
    focus: NormalizationMetric
    relaxation: NormalizationMetric
    emotional: NormalizationMetric
    formula_version: Text
    formula_constants: dict[str, Finite]
    source: Literal['standard_model', 'cohort', 'b0', 'mixed']
    cached: bool


class ArtifactReference(Contract):
    artifact_id_alias: Alias
    artifact_kind: Literal['raw', 'packets', 'sample_map', 'feature', 'raw_derived', 'indices', 'normalization', 'algorithm', 'gap', 'display_status']
    path: Annotated[str, Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_./-]*$')]
    schema_version: Text
    dictionary_key: Text
    row_count: NonNegative | None
    size_bytes: NonNegative | None
    sha256: Sha256 | None
    uncompressed_sha256: Sha256 | None
    time_range: TimeRange | None
    selection: TimeRange | None
    extra_range: list[TimeRange]
    retention: Literal['raw_90_days', 'feature_policy', 'metadata_policy']
    retention_deadline_us: DecimalInt | None
    consent_scope: list[Text]
    consent_version: Text
    availability: Availability
    unavailable_reason: Text | None
    ack_state: Literal['verified', 'committed', 'pending', 'failed', 'unavailable']

    @model_validator(mode='after')
    def valid_file(self) -> Self:
        if any(part in ('', '.', '..') for part in self.path.split('/')):
            raise ValueError('안전한 상대 경로 필요')
        if self.availability == 'available':
            if self.sha256 is None or self.size_bytes is None or self.unavailable_reason is not None:
                raise ValueError('가용 파일은 hash/size 필수')
        elif not self.unavailable_reason:
            raise ValueError('미제공 파일 사유 필요')
        return self


class StreamCloseSequence(Contract):
    stream_alias: Alias
    segment_alias: Alias
    signal: Signal
    last_chunk_sequence: NonNegative | None
    last_feature_sequence: NonNegative | None
    received_samples: NonNegative


class ViewCloseSequence(Contract):
    stream_alias: Alias
    view_instance_alias: Alias
    last_snapshot_sequence: NonNegative | None


class CloseIntent(Contract):
    intent_id_alias: Alias
    expected_artifacts: dict[Alias, Sha256]
    streams: list[StreamCloseSequence]
    snapshots: list[ViewCloseSequence]
    last_gap_sequence: NonNegative | None
    end_reason: Text

    @model_validator(mode='after')
    def distinct_scopes(self) -> Self:
        streams = {(s.stream_alias, s.segment_alias, s.signal) for s in self.streams}
        views = {(s.stream_alias, s.view_instance_alias) for s in self.snapshots}
        if len(streams) != len(self.streams) or len(views) != len(self.snapshots):
            raise ValueError('종료 순번 scope 중복')
        return self


class SignalCoverage(Contract):
    signal: Signal
    availability: Availability
    unavailable_reason: Text | None
    expected_samples: NonNegative | None
    acked_samples: NonNegative
    lost_samples: NonNegative | None
    unknown_samples: bool

    @model_validator(mode='after')
    def reason_required(self) -> Self:
        if self.availability != 'available' and not self.unavailable_reason:
            raise ValueError('미수집/미제공 사유 필요')
        return self


class ExportStream(Contract):
    stream_alias: Alias
    segment_alias: Alias
    signal: Signal
    profile: ParserProfile
    rate: Rate
    observed_rate: Rate | None
    observed_rate_window_us: Positive | None
    observed_rate_reason: Text | None
    channels: list[Text]
    units: list[Text]
    time_basis: TimeBasis


class ManifestRevision(Contract):
    schema_version: Literal['manifest-v1']
    revision: Positive
    session_alias: Alias
    participant_alias: Alias
    close_state: Literal['pending_upload', 'partial', 'complete', 'unknown']
    close_intent: CloseIntent | None
    time_basis: Literal['session_relative', 'utc_verified', 'host_estimated']
    default_view: Literal['participant_player', 'session_player', 'unavailable']
    streams: list[ExportStream]
    signals: Annotated[list[SignalCoverage], Field(min_length=3, max_length=3)]
    artifacts: list[ArtifactReference]
    gaps: list[GapEvent]
    models: list[NormalizationSnapshot]
    algorithms: list[AlgorithmSnapshot]
    policy_recheck_required: Literal[True]
    raw_packet_policy: Literal['lossless_authorized', 'blocked_requires_redaction', 'redacted_packet_view']

    @model_validator(mode='after')
    def complete_requires_expected_set(self) -> Self:
        if {s.signal for s in self.signals} != {'eeg', 'ppg', 'acc'}:
            raise ValueError('세 신호 coverage 필요')
        by_id = {a.artifact_id_alias: a for a in self.artifacts}
        if len(by_id) != len(self.artifacts) or len({a.path for a in self.artifacts}) != len(self.artifacts):
            raise ValueError('artifact ID/path 중복')
        if self.close_state == 'complete':
            if self.close_intent is None:
                raise ValueError('close intent 없이 complete 금지')
            if set(self.close_intent.expected_artifacts) != set(by_id):
                raise ValueError('expected artifact set 불일치')
            for key, checksum in self.close_intent.expected_artifacts.items():
                artifact = by_id[key]
                if artifact.sha256 != checksum or artifact.ack_state not in ('verified', 'committed'):
                    raise ValueError('미검증 artifact는 complete 금지')
            last_gap = max((g.sequence for g in self.gaps), default=None)
            if last_gap != self.close_intent.last_gap_sequence:
                raise ValueError('gap sequence 불일치')
        return self


class FeatureScalars(Contract):
    focus_index: Finite | None
    cognitive_load: Finite | None
    relaxation_index: Finite | None
    stress_index: Finite | None
    emotional_stability: Finite | None
    total_neural_activity: Finite | None
    faa: Finite | None
    hemispheric_balance: Finite | None
    delta_power: Finite | None
    theta_power: Finite | None
    alpha_power: Finite | None
    beta_power: Finite | None
    gamma_power: Finite | None
    total_power: Finite | None
    meditation_level: Finite | None
    attention_level: Finite | None
    signal_quality: Finite | None
    sdnn: Finite | None
    rmssd: Finite | None
    lf_power: Finite | None
    hf_power: Finite | None
    lf_hf_ratio: Finite | None
    heart_rate: Finite | None
    respiratory_rate: Finite | None
    motion: Finite | None
    quality: Literal['valid', 'degraded', 'invalid'] | None
    device_timestamp_ms: Finite | None


class DerivedReference(Contract):
    artifact_id_alias: Alias
    sha256: Sha256
    field_path: Text
    first_sample_index: NonNegative
    sample_count: NonNegative
    availability: Literal['available', 'expired', 'withdrawn', 'unknown']
    unavailable_reason: Text | None


class SourceWindow(Contract):
    signal: Signal
    stream_alias: Alias
    segment_alias: Alias
    raw_artifact_id_alias: Alias
    raw_sha256: Sha256
    first_sample_index: NonNegative
    end_sample_index_exclusive: NonNegative
    time_range: TimeRange
    valid_sample_count: NonNegative

    @model_validator(mode='after')
    def bounded(self) -> Self:
        if self.end_sample_index_exclusive < self.first_sample_index or self.valid_sample_count > self.end_sample_index_exclusive - self.first_sample_index:
            raise ValueError('원창 범위/유효 count 불일치')
        return self


class BandPowers(Contract):
    delta: Finite | None
    theta: Finite | None
    alpha: Finite | None
    beta: Finite | None
    gamma: Finite | None


class Spectrum(Contract):
    frequencies: list[Finite | None]
    ch1Power: list[Finite | None]
    ch2Power: list[Finite | None]
    timestamp: Finite | None

    @model_validator(mode='after')
    def matching_bins(self) -> Self:
        if not len(self.frequencies) == len(self.ch1Power) == len(self.ch2Power):
            raise ValueError('PSD 주파수/bin 길이 불일치')
        return self


class BrainMetrics(Contract):
    arousal: Finite | None
    valence: Finite | None
    attention: Finite | None
    relaxation: Finite | None


class BrainState(Contract):
    currentState: Text
    confidence: Finite | None
    stateHistory: list[Text]
    recommendations: list[Text] | None
    metrics: BrainMetrics | None


class EEGQuality(Contract):
    overall: Finite | None
    fp1: Finite | None
    fp2: Finite | None
    sqi: DerivedReference


class EEGIndices(Contract):
    focusIndex: Finite | None
    relaxationIndex: Finite | None
    stressIndex: Finite | None
    hemisphericBalance: Finite | None
    cognitiveLoad: Finite | None
    emotionalStability: Finite | None
    totalPower: Finite | None
    totalNeuralActivity: Finite | None
    faa: Finite | None


class EEGRawAnalysis(Contract):
    ch1SQI: DerivedReference
    ch2SQI: DerivedReference
    overallSQI: DerivedReference


class EEGOutput(Contract):
    filteredData: DerivedReference
    signalQuality: EEGQuality
    bandPowers: BandPowers
    brainState: BrainState
    frequencySpectrum: Spectrum
    indices: EEGIndices
    rawAnalysis: EEGRawAnalysis
    channelBandPowers: list[BandPowers] | None
    channelBandPowers_reason: Text | None


class PPGQuality(Contract):
    overall: Finite | None
    red: Finite | None
    ir: Finite | None
    sqi: DerivedReference
    redSQI: DerivedReference
    irSQI: DerivedReference
    overallSQI: DerivedReference


class Vitals(Contract):
    heartRate: Finite | None
    hrv: Finite | None
    spo2: Finite | None


class PeakInfo(Contract):
    peakCount: NonNegative | None
    avgPeakInterval: Finite | None
    peakQuality: Finite | None


class AdvancedHRV(Contract):
    sdnn: Finite | None
    pnn50: Finite | None
    lfPower: Finite | None
    hfPower: Finite | None
    lfHfRatio: Finite | None
    stressIndex: Finite | None
    avnn: Finite | None
    pnn20: Finite | None
    sdsd: Finite | None
    hrMax: Finite | None
    hrMin: Finite | None


class Beat(Contract):
    beat_id: Text
    peak_sample_index: NonNegative
    rr_ms: Finite | None
    accepted: bool
    exclusion_reason: Text | None


class PPGOutput(Contract):
    filteredData: DerivedReference
    signalQuality: PPGQuality
    vitals: Vitals
    peakInfo: PeakInfo
    advancedHRV: AdvancedHRV
    rrIntervals: list[Finite | None]
    beats: list[Beat] | None
    beats_reason: Text | None


class Magnitude(Contract):
    timestamp: Finite | None
    value: Finite | None


class Activity(Contract):
    type: Literal['stationary', 'sitting', 'walking', 'running']
    confidence: Finite | None
    intensity: Finite | None


class Movement(Contract):
    avgMovement: Finite | None
    stdMovement: Finite | None
    maxMovement: Finite | None
    totalMovement: Finite | None


class Posture(Contract):
    tiltAngle: Finite | None
    stability: Finite | None
    balance: Finite | None


class ACCQuality(Contract):
    overall: Finite | None
    reliability: Finite | None
    consistency: Finite | None


class ACCOutput(Contract):
    filteredData: DerivedReference
    magnitude: DerivedReference
    activity: Activity
    movement: Movement
    posture: Posture
    signalQuality: ACCQuality


class FeatureRecord(Contract):
    schema_version: Literal['feature-v1']
    feature_id_alias: Alias
    sequence: NonNegative
    signal: Signal
    play_group_id: Alias | None
    window_index: NonNegative
    t_rel_ms: Finite
    computed_at_us: DecimalInt
    measured_at_us: DecimalInt
    algorithm: AlgorithmSnapshot
    source_windows: Annotated[list[SourceWindow], Field(min_length=1)]
    scalars: FeatureScalars
    scalar_null_reasons: dict[str, Text]
    detail_null_reasons: dict[str, Text]
    eeg: EEGOutput | None
    ppg: PPGOutput | None
    acc: ACCOutput | None
    quality: Text

    @model_validator(mode='after')
    def complete_output(self) -> Self:
        for signal in ('eeg', 'ppg', 'acc'):
            if (getattr(self, signal) is not None) != (signal == self.signal):
                raise ValueError('실제 emit 신호 output 하나만 기록')
        expected = {key for key, value in self.scalars.model_dump().items() if value is None}
        if set(self.scalar_null_reasons) != expected:
            raise ValueError('null 스칼라별 사유 누락/불일치')
        required: set[str] = set()

        def numeric(annotation: object) -> bool:
            if annotation in (float, int):
                return True
            return any(numeric(arg) for arg in get_args(annotation) if arg is not type(None))

        def visit(value: object, path: str, annotation: object = None) -> None:
            if value is None:
                if numeric(annotation):
                    required.add(path)
            elif isinstance(value, BaseModel):
                for name, field in type(value).model_fields.items():
                    visit(getattr(value, name), path + '.' + name, field.annotation)
            elif isinstance(value, list):
                args = get_args(annotation)
                for index, item in enumerate(value):
                    visit(item, path + '.' + str(index), args[0] if args else None)

        visit(getattr(self, self.signal), self.signal)
        if set(self.detail_null_reasons) != required:
            raise ValueError('상세 수치 null의 경로별 사유 누락/불일치')
        return self


class DisplayMetric(Contract):
    input_source: Literal['local_ble', 'socket', 'remote_fallback', 'reconstructed', 'unavailable']
    event_age_ms: Finite | None
    value: NonNegative | None
    display_input: Finite | None
    normalized_output: Finite | None
    measured_at_us: DecimalInt | None
    source_feature_id: Alias | None
    provenance_reason: Text | None
    held: bool
    stale: bool
    lead_off: bool
    quality: Text
    null_reason: Text | None
    normalization_source: Literal['standard_model', 'cohort', 'b0', 'physical', 'unavailable']

    @model_validator(mode='after')
    def nullable_reason(self) -> Self:
        if self.value is None and not self.null_reason:
            raise ValueError('결측 표시값 사유 필요')
        if self.value is not None and self.null_reason is not None:
            raise ValueError('실제 표시값에 결측 사유 금지')
        if self.source_feature_id is None and not self.provenance_reason:
            raise ValueError('원 feature 없는 값의 출처 필요')
        return self


class MindMetric(DisplayMetric):
    value: Annotated[int, Field(ge=0, le=100, strict=True)] | None
    normalized_output: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] | None


class DisplaySnapshot(Contract):
    schema_version: Literal['indices-v1']
    stream_alias: Alias
    view_instance_alias: Alias
    view_kind: Literal['participant_player', 'session_player']
    second_index: NonNegative
    t_rel_ms: Finite
    play_group_id: Alias | None
    window_index: NonNegative | None
    displayed_at_us: DecimalInt | None
    render_status: Literal['rendered', 'not_rendered', 'unavailable']
    focus: MindMetric
    relaxation: MindMetric
    emotional: MindMetric
    bpm: DisplayMetric
    respiration: DisplayMetric
    hrv: DisplayMetric
    hrv_metric: Literal['sdnn']
    normalization: NormalizationSnapshot | None
    algorithm: AlgorithmSnapshot | None
    display_pipeline_version: Text | None
    source: Literal['displayed', 'reconstructed', 'report_aggregate', 'unavailable']
    display_match: bool | Literal['unverified']
    unavailable_reason: Text | None

    @model_validator(mode='after')
    def genuine_snapshot(self) -> Self:
        metrics = [self.focus, self.relaxation, self.emotional, self.bpm, self.respiration, self.hrv]
        if self.render_status != 'rendered' and any(m.value is not None for m in metrics):
            raise ValueError('미렌더 초에 표시값 생성 금지')
        if self.source == 'displayed' and (self.render_status != 'rendered' or self.displayed_at_us is None or self.display_match is not True or self.algorithm is None or self.display_pipeline_version is None):
            raise ValueError('당시 표시 snapshot 근거 필요')
        if self.source in ('reconstructed', 'report_aggregate') and self.display_match is not False:
            raise ValueError('재계산/집계는 당시 표시 일치 주장 금지')
        if self.source == 'unavailable' and (self.display_match != 'unverified' or not self.unavailable_reason):
            raise ValueError('과거 표시 이력 없음 명시 필요')
        for metric in (self.bpm, self.respiration, self.hrv):
            if metric.normalization_source not in ('physical', 'unavailable') or metric.normalized_output is not None:
                raise ValueError('몸3은 정규화하지 않은 물리량')
        if any(m.value is not None for m in metrics[:3]) and self.normalization is None:
            raise ValueError('마음3 모델 snapshot 필요')
        return self


class DecodedSample(Contract):
    signal: Signal
    sample_index: NonNegative
    packet_seq: NonNegative
    relative_us: DecimalInt
    utc_us: DecimalInt | None
    time_basis: TimeBasis
    adc: list[int]
    physical: list[Finite]
    lead_off: NonNegative | None
    unit: Text


class ExportSelection(Contract):
    signals: list[Signal]
    time_range: TimeRange
    sample_format: Literal['csv', 'parquet']
    view_kind: Literal['participant_player', 'session_player']


class ExportPolicy(Contract):
    time_policy: Literal['relative_only', 'exact_authorized']
    raw_packets_authorized: bool
    allowed_artifact_kinds: list[Text]
    policy_revision: Text


class ExportArtifact(ArtifactReference):
    """adapter의 bytes/row iterator는 이 메타와 함께 반환한다(JSON 외부)."""


# ───────────────────────────────────────────────────────────────────────────
# T04 API wrapper (additive). 위 G1 DTO는 변경하지 않고 요청/응답 wrapper만 확장한다.
# 기존 eeg-raw presign/ack 형태(participant_id·play_group_id·chunks[] / chunks[{chunk_id,
# upload_status, checksum, size_bytes}])에 signal/stream 필드를 더한 형태다.
# ───────────────────────────────────────────────────────────────────────────

MAX_BATCH = 100
MAX_OBJECT_BYTES = 1_048_576
ArtifactKind = Literal['feature', 'raw_derived', 'indices', 'normalization', 'algorithm']
UploadStatus = Literal['pending', 'uploaded', 'failed']
PlayGroup = Annotated[str, Field(max_length=64)]


class PresignChunk(Contract):
    """raw presign 요청 1건. identity/시간/profile은 header(RawHeader)가 정본이다."""
    # 클라이언트가 만드는 업로드 alias(Alias 패턴). feature/indices가 이 raw를 가리킬 때
    # (SourceWindow.raw_artifact_id_alias) 같은 문자열을 쓴다. 회차·참여자 안에서 유일.
    chunk_alias: Alias
    header: RawHeader
    checksum: Sha256
    size_bytes: Annotated[int, Field(gt=12, le=MAX_OBJECT_BYTES, strict=True)]
    content_type: Annotated[str, Field(max_length=100)] = 'application/octet-stream'


class PresignRequest(Contract):
    participant_id: UUID | None = None
    play_group_id: PlayGroup | None = None
    # SDD-246 T09: 지정하면 서버가 해당 capture stream 의 종료 cutoff·권한코드로 archive 수락 여부를 판정한다(미지정=현행).
    capture_stream_id: UUID | None = None
    chunks: Annotated[list[PresignChunk], Field(min_length=1, max_length=MAX_BATCH)]


class PresignItem(Contract):
    chunk_id: UUID
    chunk_alias: Alias
    signal_type: Signal
    stream_id: UUID
    segment_id: UUID
    chunk_index: NonNegative
    object_key: Text
    checksum: Sha256
    size_bytes: Positive
    # uploaded 상태(이미 검증 ACK됨)이면 upload_url=None — PUT 없이 ACK만 재요청한다.
    upload_url: str | None
    # presign이 반환한 헤더를 그대로 PUT에 실어야 한다(서명·checksum 바인딩).
    upload_headers: dict[str, str]
    upload_status: UploadStatus
    expires_in_sec: NonNegative


class PresignResponse(Contract):
    session_id: UUID
    participant_id: UUID
    chunks: list[PresignItem]
    # SDD-246 T09: capture_stream_id 를 보냈을 때만. archive 수락은 live 최신성을 바꾸지 않는다(live_fresh_applied=False 고정).
    archive_ingest: dict[str, str | bool | None] | None = None


class AckItem(Contract):
    chunk_id: UUID
    # v2는 등록된 값과 일치해야 한다(덮어쓰기 불가). 불일치 → failed.
    checksum: Sha256
    size_bytes: Positive


class AckRequest(Contract):
    participant_id: UUID | None = None
    play_group_id: PlayGroup | None = None
    chunks: Annotated[list[AckItem], Field(min_length=1, max_length=MAX_BATCH)]


class AckResult(Contract):
    chunk_id: UUID
    chunk_alias: Alias
    upload_status: UploadStatus
    checksum: Sha256
    size_bytes: Positive
    verified_at_us: DecimalInt | None
    failure_reason: Text | None
    object_version_id: Text | None = None

    @model_validator(mode='after')
    def verified_success(self) -> Self:
        if self.upload_status == 'uploaded' and (self.verified_at_us is None or self.failure_reason is not None):
            raise ValueError('성공 ACK에는 검증시각 필요')
        if self.upload_status != 'uploaded' and not self.failure_reason:
            raise ValueError('미확정 ACK 사유 필요')
        return self


class AckResponse(Contract):
    session_id: UUID
    acked: NonNegative
    failed: NonNegative
    chunks: list[AckResult]
    eeg_record_id: UUID | None = None
    file_count: NonNegative = 0


class ArtifactPresignChunk(Contract):
    """feature/raw_derived/indices/normalization/algorithm 객체 업로드 등록 1건."""
    # 클라이언트가 만드는 업로드 alias. DerivedReference.artifact_id_alias 가 이 값을 가리킨다.
    artifact_alias: Alias
    # 이 객체(JSONL 묶음)에 들어 있는 FeatureRecord.feature_id_alias 목록.
    # DisplayMetric.source_feature_id 해석에 쓰이며 서버는 객체를 파싱하지 않고 이 목록으로 색인한다.
    feature_id_aliases: Annotated[list[Alias], Field(max_length=2000)] = Field(default_factory=list)
    artifact_kind: ArtifactKind
    stream_id: UUID | None
    segment_id: UUID | None
    signal: Signal | None
    view_instance_id: UUID | None = None
    # kind별 단조 순번(feature=stream/signal별, indices=stream/view별). 모델/알고리즘은 0.
    sequence: NonNegative
    first_sequence: NonNegative | None = None
    last_sequence: NonNegative | None = None
    row_count: NonNegative
    content_encoding: Literal['identity', 'gzip'] = 'identity'
    schema_version: Text
    # checksum/size는 업로드되는 바이트(압축 후), uncompressed_sha256은 압축 해제 원문.
    checksum: Sha256
    uncompressed_sha256: Sha256 | None = None
    size_bytes: Annotated[int, Field(gt=0, le=MAX_OBJECT_BYTES, strict=True)]
    time_range: TimeRange | None = None
    # SDD-246 T09: 이 산출물이 덮는 장치 단조시계 구간(µs). 종료 cutoff 이후 사후전송 판정(capture_stream_id 지정 시)에만 쓴다.
    monotonic_range: TimeRange | None = None
    content_type: Annotated[str, Field(max_length=100)] = 'application/octet-stream'


class ArtifactPresignRequest(Contract):
    participant_id: UUID | None = None
    play_group_id: PlayGroup | None = None
    capture_stream_id: UUID | None = None  # SDD-246 T09 (PresignRequest 와 동일 의미)
    chunks: Annotated[list[ArtifactPresignChunk], Field(min_length=1, max_length=MAX_BATCH)]


class ArtifactPresignItem(Contract):
    artifact_id: UUID
    artifact_alias: Alias
    artifact_kind: ArtifactKind
    sequence: NonNegative
    object_key: Text
    checksum: Sha256
    size_bytes: Positive
    upload_url: str | None
    upload_headers: dict[str, str]
    upload_status: UploadStatus
    expires_in_sec: NonNegative


class ArtifactPresignResponse(Contract):
    session_id: UUID
    participant_id: UUID
    chunks: list[ArtifactPresignItem]
    archive_ingest: dict[str, str | bool | None] | None = None  # SDD-246 T09 (PresignResponse 와 동일 의미)


class ArtifactAckItem(Contract):
    artifact_id: UUID
    checksum: Sha256
    size_bytes: Positive


class ArtifactAckRequest(Contract):
    participant_id: UUID | None = None
    chunks: Annotated[list[ArtifactAckItem], Field(min_length=1, max_length=MAX_BATCH)]


class ArtifactAckResult(Contract):
    artifact_id: UUID
    artifact_alias: Alias
    artifact_kind: ArtifactKind
    upload_status: UploadStatus
    checksum: Sha256
    size_bytes: Positive
    verified_at_us: DecimalInt | None
    failure_reason: Text | None
    # 서버가 객체 내용을 해석해 검색 원장(display_snapshots/normalization_snapshots)에 반영한 행 수
    indexed_rows: NonNegative = 0


class ArtifactAckResponse(Contract):
    session_id: UUID
    acked: NonNegative
    failed: NonNegative
    chunks: list[ArtifactAckResult]


class GapEventIn(Contract):
    """클라이언트 gap 이벤트. 서버가 alias로 변환해 manifest에 노출한다."""
    event_type: Literal['gap']
    event_id: UUID
    sequence: NonNegative
    discovered_at_us: DecimalInt
    signal: Signal
    stream_id: UUID
    segment_id: UUID
    start_us: DecimalInt
    end_us: DecimalInt | None
    reason: Literal['ble_disconnect', 'packet_gap', 'local_write_failed', 'process_terminated', 'clock_reset', 'wall_clock_jump', 'reanchor', 'unknown', 'upload_pending', 'not_rendered']
    observed_or_estimated: Literal['observed', 'estimated', 'unknown']
    expected_samples: NonNegative | None
    received_samples: NonNegative | None
    reconnect_count: NonNegative

    @model_validator(mode='after')
    def unknown_is_not_zero(self) -> Self:
        if self.end_us is not None and int(self.end_us) < int(self.start_us):
            raise ValueError('gap 범위 역전')
        if self.observed_or_estimated == 'unknown' and self.expected_samples is not None:
            raise ValueError('불명 손실량은 null')
        return self


class ExpectedArtifactIn(Contract):
    """종료 시 서버가 원장과 대조할 산출물. id는 presign이 돌려준 chunk_id/artifact_id."""
    kind: Literal['raw'] | ArtifactKind
    # presign 때 클라이언트가 정한 chunk_alias / artifact_alias. 서버가 원장에서 UUID로 해석한다.
    alias: Alias
    sha256: Sha256


class MissingArtifact(Contract):
    """종료 판정에서 확정되지 않은 항목(응답 전용). gap 합성/구멍 항목도 포함한다."""
    kind: Literal['raw', 'gap'] | ArtifactKind
    alias: Alias | Text
    sha256: Sha256


class StreamCloseIn(Contract):
    stream_id: UUID
    segment_id: UUID
    signal: Signal
    last_chunk_sequence: NonNegative | None
    last_feature_sequence: NonNegative | None
    received_samples: NonNegative


class ViewCloseIn(Contract):
    stream_id: UUID
    view_instance_id: UUID
    last_snapshot_sequence: NonNegative | None


class LostArtifactIn(Contract):
    """클라이언트가 회복 불가로 선언한 산출물(로컬 쓰기 실패 등). 선언분은 필수 목록에서 빠지고 partial 로 판정된다."""
    kind: Literal['raw'] | ArtifactKind
    alias: Alias
    reason: Text


class CloseIntentIn(Contract):
    event_type: Literal['close_intent']
    intent_id: UUID
    expected_artifacts: list[ExpectedArtifactIn]
    lost_artifacts: list[LostArtifactIn] = Field(default_factory=list)
    streams: list[StreamCloseIn]
    snapshots: list[ViewCloseIn]
    last_gap_sequence: NonNegative | None
    end_reason: Text
    closed_at_us: DecimalInt

    @model_validator(mode='after')
    def distinct_scopes(self) -> Self:
        streams = {(s.stream_id, s.segment_id, s.signal) for s in self.streams}
        views = {(s.stream_id, s.view_instance_id) for s in self.snapshots}
        refs = {(a.kind, a.alias) for a in self.expected_artifacts}
        if len(streams) != len(self.streams) or len(views) != len(self.snapshots) or len(refs) != len(self.expected_artifacts):
            raise ValueError('종료 순번/expected scope 중복')
        return self


class EventsRequest(Contract):
    participant_id: UUID | None = None
    events: Annotated[list[Annotated[GapEventIn | CloseIntentIn, Field(discriminator='event_type')]], Field(min_length=1, max_length=MAX_BATCH)]


class EventResult(Contract):
    event_type: Literal['gap', 'close_intent']
    event_id: UUID
    # recorded=신규, duplicate=동일 내용 재전송(멱등), conflict=같은 id에 다른 내용
    status: Literal['recorded', 'duplicate', 'conflict']
    detail: Text | None = None


class EventsResponse(Contract):
    session_id: UUID
    participant_id: UUID
    events: list[EventResult]
    # close intent가 포함된 경우 판정된 최신 manifest revision 요약
    manifest_revision: Positive | None = None
    close_state: Literal['pending_upload', 'partial', 'complete', 'unknown'] | None = None
    # 미검증/목록 밖/순번 구멍 항목. 구멍·합성 항목의 sha256 은 모두 0(알 수 없음), alias 는 RAWMISSING-*/FEATMISSING-*/IDXMISSING-*/GAPMISSING-*.
    missing_artifacts: list[MissingArtifact] = Field(default_factory=list)


class SignalCapability(Contract):
    signal: Signal
    upload_allowed: bool
    reason: Text | None
    # 연구 반출 동의(신호별). 평가하지 않은 경우 unknown + 사유.
    research_consent: Literal['consented', 'not_consented', 'withdrawn', 'unknown']
    research_reason: Text | None


class CapabilityResponse(Contract):
    session_id: UUID
    participant_id: UUID
    raw_schemas: list[Text]
    artifact_kinds: list[ArtifactKind]
    events: bool
    max_batch: Positive
    max_object_bytes: Positive
    # 서버가 요구하는 업로드 불변성 방식: checksum_bound(서명 헤더 SHA-256 바인딩)
    upload_immutability: Literal['checksum_bound']
    legacy_eeg_raw: bool
    signals: list[SignalCapability]


class ManifestResponse(Contract):
    session_id: UUID
    participant_id: UUID
    latest_revision: Positive | None
    manifest: ManifestRevision | None
