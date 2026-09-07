"""SDD-027 EEG 롤업 · raw chunk manifest Pydantic 스키마"""

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# T1. 60초 롤업
# ---------------------------------------------------------------------------


class EEGRollupBucket(BaseModel):
    """단일 버킷(예: 60초) 집계. metrics 값은 유효 샘플 없으면 null(0 치환 금지)."""

    bucket_index: int
    start_sec: int
    end_sec: int
    sample_count: int
    valid_count: int
    coverage: float
    metrics: dict[str, float | None]


class EEGRollupOverall(BaseModel):
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

    stream_id: str = Field("default", max_length=64)
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
    chunks: list[RawChunkMeta] = Field(..., min_length=1)


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
    chunks: list[RawAckItem] = Field(..., min_length=1)


class RawAckResponse(BaseModel):
    session_id: str
    acked: int
    eeg_record_id: str | None = None
    file_count: int
