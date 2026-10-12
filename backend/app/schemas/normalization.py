"""정규화 기준 API 계약 및 유한 숫자 검증."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

FiniteMetric = Annotated[float, Field(strict=True, allow_inf_nan=False)]


class BaselineMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    focusIndex: FiniteMetric | None
    relaxationIndex: FiniteMetric | None
    stressIndex: FiniteMetric | None
    totalNeuralActivity: FiniteMetric | None
    faa: FiniteMetric | None
    cognitiveLoad: FiniteMetric | None
    emotionalStability: FiniteMetric | None
    # 구버전 클라이언트 페이로드 호환을 위해 기본값 None
    autonomicStability: FiniteMetric | None = None
    # SDD-046 — 몸(PPG) 지표 보강
    sdnn: FiniteMetric | None = None
    avgHeartRate: FiniteMetric | None = None
    breathingStability: FiniteMetric | None = None


class BaselineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    closed: BaselineMetrics
    open: BaselineMetrics
    device_id: str | None = None
    pipeline_version: str | None = None
    gender: Literal["male", "female"] | None = None
    birth_date: str | None = None


class BaselineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: str
    device_id: str | None
    pipeline_version: str | None
    gender: str | None
    birth_date: str | None
    closed: BaselineMetrics
    open: BaselineMetrics
    created_at: datetime
    is_active: bool


class BaselineListResponse(BaseModel):
    items: list[BaselineResponse]


class ActiveBaselineResponse(BaseModel):
    active: BaselineResponse | None


class ActivateBaselineResponse(BaseModel):
    active: BaselineResponse


class BaselineDeleteResponse(BaseModel):
    ok: Literal[True] = True
