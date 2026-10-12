"""SDD-027 EEG 롤업 · raw chunk manifest Pydantic 스키마"""

from pydantic import BaseModel, Field

# EEG-QRY-03: presign/ack 요청 1건이 담을 수 있는 raw 청크 최대 개수.
# 상한이 없으면 한 요청이 무한정 큰 목록을 보내 서버가 청크 수에 비례해 조회·서명을 수행한다.
_RAW_CHUNK_BATCH_MAX = 500


class HRVMotionFeatures(BaseModel):
    """PPG HRV·ACC 움직임 입력 계약. 미수신·산출 불가는 null 보존."""

    sdnn: float | None = Field(None, description="SDNN (ms)")
    rmssd: float | None = Field(None, description="RMSSD (ms)")
    lf_power: float | None = Field(None, description="LF 파워 (ms²)")
    hf_power: float | None = Field(None, description="HF 파워 (ms²)")
    lf_hf_ratio: float | None = None
    heart_rate: float | None = Field(None, description="심박수 (bpm)")
    respiratory_rate: float | None = Field(None, description="호흡수 (breaths/min)")
    motion: float | None = Field(None, ge=0, le=1, description="움직임 활동도 (0~1)")


class HRVMotionSummary(BaseModel):
    """비-null 원천 샘플의 평균과 심박수 최소·최대. 해당 지표가 없으면 null."""

    sdnn_mean: float | None = None
    rmssd_mean: float | None = None
    lf_hf_ratio_mean: float | None = None
    heart_rate_mean: float | None = None
    heart_rate_min: float | None = None
    heart_rate_max: float | None = None
    respiratory_rate_mean: float | None = None
    lf_power_mean: float | None = None
    hf_power_mean: float | None = None
    motion_mean: float | None = None


# ---------------------------------------------------------------------------
# T1. 60초 롤업
# ---------------------------------------------------------------------------


class EEGRollupBucket(BaseModel):
    """단일 버킷(예: 60초) 집계. metrics 값은 유효 샘플 없으면 null(0 치환 금지)."""

    bucket_index: int
    # EEG-RUP-01: pause/resume 실행 세그먼트 식별자 — window_index 가 세그먼트마다 재시작하므로
    # 응답에서 이 값이 빠지면 서로 다른 실행 구간의 버킷을 구분할 수 없다(레거시는 null).
    play_group_id: str | None = None
    start_sec: int
    end_sec: int
    sample_count: int
    valid_count: int
    coverage: float
    metrics: dict[str, float | None]


class EEGRollupOverall(HRVMotionSummary):
    """전 구간 요약 — 유효 샘플 수 가중 평균(버킷 단순 평균 아님)."""

    sample_count: int
    valid_count: int
    metrics: dict[str, float | None]


class EEGRollupResponse(BaseModel):
    session_id: str
    participant_id: str | None = None
    resolution_sec: int
    algorithm_version: int | None = None
    window_count: int
    bucket_count: int
    buckets: list[EEGRollupBucket]
    overall: EEGRollupOverall


# ---------------------------------------------------------------------------
# T2/T3. raw chunk manifest + presigned PUT / ack
# ---------------------------------------------------------------------------


class RawChunkMeta(BaseModel):
    """presigned 발급 요청 1건 — raw 재해석 계약 메타데이터. 시간범위는 null 보존."""

    stream_id: str = Field("default", max_length=128)
    chunk_index: int = Field(..., ge=0)
    start_ms: float | None = None
    end_ms: float | None = None
    sample_rate: int = Field(250, ge=1)
    channel_count: int = Field(2, ge=1)
    unit: str = Field("uV", max_length=20)
    schema_version: str = Field("1.0", max_length=20)
    checksum: str | None = Field(None, max_length=128)
    size_bytes: int | None = Field(None, ge=0)
    content_type: str = Field("application/octet-stream", max_length=100)


class RawPresignRequest(BaseModel):
    participant_id: str | None = None
    play_group_id: str | None = Field(None, max_length=64)
    # EEG-QRY-03: 한 요청의 청크 수를 상한으로 제한한다(개별 SELECT 폭주·과대 요청 방지).
    chunks: list[RawChunkMeta] = Field(..., min_length=1, max_length=_RAW_CHUNK_BATCH_MAX)


class RawPresignItem(BaseModel):
    chunk_id: str
    stream_id: str
    chunk_index: int
    object_key: str
    upload_url: str
    upload_status: str


class RawPresignResponse(BaseModel):
    session_id: str
    participant_id: str | None = None
    chunks: list[RawPresignItem]


class RawAckItem(BaseModel):
    """업로드 완료 확인 1건. checksum/size 는 클라이언트가 실제 업로드 값으로 갱신 가능."""

    chunk_id: str
    checksum: str | None = Field(None, max_length=128)
    size_bytes: int | None = Field(None, ge=0)


class RawAckRequest(BaseModel):
    participant_id: str | None = None
    play_group_id: str | None = Field(None, max_length=64)
    # EEG-QRY-03: 한 요청의 청크 수를 상한으로 제한한다(개별 SELECT 폭주·과대 요청 방지).
    chunks: list[RawAckItem] = Field(..., min_length=1, max_length=_RAW_CHUNK_BATCH_MAX)


class RawAckResponse(BaseModel):
    session_id: str
    acked: int
    # EEG-RAW-02: S3 HEAD 검증 실패(객체 없음/크기 불일치)로 failed 마킹된 청크 수.
    failed: int = 0
    eeg_record_id: str | None = None
    file_count: int
