"""LINK BAND EEG 스키마 — 실시간 지표 + Raw 데이터"""

from datetime import datetime
from pydantic import BaseModel, Field


class EEGMetricsPayload(BaseModel):
    """1Hz 실시간 분석 지표 (회원 앱 → WebSocket → 상담사)"""
    neural_activity: float = Field(ge=0, le=100, description="신경활성도")
    concentration: float = Field(ge=0, le=100, description="집중도")
    cognitive_stress: float = Field(ge=0, le=100, description="스트레스(인지)")
    eeg_stress: float = Field(ge=0, le=100, description="스트레스(뇌파)")
    emotional_balance: float = Field(ge=0, le=100, description="감정균형도")
    relaxation: float = Field(ge=0, le=100, description="이완도")
    heart_rate: float = Field(ge=0, le=300, description="심박수(BPM)")
    total_movement: float = Field(ge=0, description="움직임 총량(mG)")
    sensor_attached: int = Field(ge=0, le=1, description="센서 부착상태")
    sqi_fp1: float = Field(ge=0, le=100, description="Fp1 신호품질")
    sqi_fp2: float = Field(ge=0, le=100, description="Fp2 신호품질")


class EEGMetricsResponse(BaseModel):
    """DB 저장용 EEG 메트릭"""
    id: str
    session_id: str
    user_id: str
    timestamp: float
    metrics: EEGMetricsPayload
    created_at: datetime


class EEGBatchUploadRequest(BaseModel):
    """세션 종료 후 Raw 데이터 배치 업로드"""
    session_id: str
    user_id: str
    sample_rate: int = 250
    duration_sec: int
    channel_count: int = 2
    # 실제 raw data는 multipart/form-data로 별도 전송


class EEGBatchUploadResponse(BaseModel):
    s3_key: str
    record_id: str
    message: str = "업로드 완료"


class EEGSessionSummary(BaseModel):
    """세션별 EEG 요약 (대시보드 / 리포트용)"""
    session_id: str
    avg_neural_activity: float | None = None
    avg_concentration: float | None = None
    avg_relaxation: float | None = None
    avg_stress: float | None = None
    avg_heart_rate: float | None = None
    data_points: int = 0
