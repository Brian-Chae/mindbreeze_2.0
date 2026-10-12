"""표준 모델 응답 계약과 유한 분포 파라미터 검증."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

MetricKey = Literal[
    "focusIndex", "relaxationIndex", "stressIndex", "totalNeuralActivity",
    "faa", "cognitiveLoad", "emotionalStability", "autonomicStability",
    "sdnn", "avgHeartRate", "breathingStability",
]


class DistributionParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    m: Annotated[float, Field(strict=True, allow_inf_nan=False)]
    s: Annotated[float, Field(strict=True, allow_inf_nan=False, gt=0)]
    direction: Literal[1, -1]


class NormalizationModelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    version: int
    n_samples: int
    params: dict[MetricKey, DistributionParams]
    created_at: datetime
    is_active: bool


class NormalizationModelListResponse(BaseModel):
    items: list[NormalizationModelResponse]


class ActiveNormalizationModelResponse(BaseModel):
    active: NormalizationModelResponse | None


class ActivateNormalizationModelResponse(BaseModel):
    active: NormalizationModelResponse
