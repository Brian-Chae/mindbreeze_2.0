"""SDD-264 — 폰 생성량(기대량) 보고 스키마. 계약: specs/sdd-264-upload-progress-expected/contract.md §1."""

from pydantic import BaseModel

MAX_COUNT = 10_000_000
RAW_SIGNALS = ("eeg", "ppg", "acc")


class ExpectedRaw(BaseModel):
    eeg: int | None
    ppg: int | None
    acc: int | None


class ExpectedValues(BaseModel):
    feature: int
    raw: ExpectedRaw


class IngestExpectedResponse(BaseModel):
    session_id: str
    participant_id: str
    expected: ExpectedValues
    final: bool
    changed: bool
    ignored: list[str]
    updated_at: str
