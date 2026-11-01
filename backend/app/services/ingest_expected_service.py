"""SDD-264 B2 — 폰 생성량(기대량) 보고 저장.

- 필드별 단조 증가(max 병합), 멱등, final 은 뒤처진 보고가 되돌리지 못한다.
- 동시 보고는 행 잠금(PG FOR UPDATE) + 최초 INSERT 경합 재조회로 직렬화 → 결과는 필드별 최댓값.
- 계약 정본: specs/sdd-264-upload-progress-expected/contract.md §1
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.session_ingest_expected import SessionIngestExpected
from app.schemas.ingest_expected import MAX_COUNT, RAW_SIGNALS, ExpectedRaw, ExpectedValues, IngestExpectedResponse

_TOP_KEYS = {"participant_id", "feature", "raw", "final"}


@dataclass(frozen=True)
class ExpectedReport:
    feature: int
    raw: dict[str, int] | None  # None = 원시 미보고(저장값 불변)
    final: bool


def _invalid(field: str) -> HTTPException:
    return HTTPException(422, detail={"code": "invalid_message", "field": field})


def _count(value, field: str) -> int:
    # bool 은 int 의 하위 타입이라 명시적으로 거절한다.
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_COUNT:
        raise _invalid(field)
    return value


def parse_report(payload) -> ExpectedReport:
    """본문 엄격 검증. 위반은 422 `invalid_message` + 첫 위반 field."""
    if not isinstance(payload, dict):
        raise _invalid("body")
    for key in payload:
        if key not in _TOP_KEYS:
            raise _invalid(str(key))
    if "feature" not in payload:
        raise _invalid("feature")
    feature = _count(payload["feature"], "feature")
    if "final" not in payload or not isinstance(payload["final"], bool):
        raise _invalid("final")
    raw: dict[str, int] | None = None
    if "raw" in payload and payload["raw"] is not None:
        src = payload["raw"]
        if not isinstance(src, dict) or set(src) != set(RAW_SIGNALS):
            raise _invalid("raw")
        raw = {name: _count(src[name], f"raw.{name}") for name in RAW_SIGNALS}
    return ExpectedReport(feature=feature, raw=raw, final=payload["final"])


def _iso(dt: datetime) -> str:
    dt = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _locked(db: DBSession, participant_id: uuid.UUID) -> SessionIngestExpected | None:
    return db.execute(
        select(SessionIngestExpected).where(SessionIngestExpected.participant_id == participant_id).with_for_update()
    ).scalar_one_or_none()


def _response(session_id: uuid.UUID, row: SessionIngestExpected, changed: bool, ignored: list[str]) -> IngestExpectedResponse:
    return IngestExpectedResponse(
        session_id=str(session_id), participant_id=str(row.participant_id),
        expected=ExpectedValues(feature=row.feature, raw=ExpectedRaw(eeg=row.raw_eeg, ppg=row.raw_ppg, acc=row.raw_acc)),
        final=row.final, changed=changed, ignored=ignored, updated_at=_iso(row.updated_at))


def _merge(row: SessionIngestExpected, report: ExpectedReport, now: datetime) -> tuple[bool, list[str]]:
    """저장 행에 보고를 병합하고 (changed, ignored) 를 돌려준다."""
    incoming: list[tuple[str, str, int]] = [("feature", "feature", report.feature)]
    if report.raw is not None:
        incoming += [(f"raw.{n}", f"raw_{n}", report.raw[n]) for n in RAW_SIGNALS]

    ignored: list[str] = []
    increased = False
    for label, attr, value in incoming:
        current = getattr(row, attr)
        if current is None or value > current:
            setattr(row, attr, value)
            increased = True
        elif value < current:
            ignored.append(label)

    old_final = row.final
    if ignored:
        pass  # 뒤처진 보고의 final 은 채택하지 않는다
    elif increased:
        row.final = report.final
    else:
        row.final = row.final or report.final

    changed = increased or row.final != old_final
    row.reported_at = now
    if changed:
        row.updated_at = now
    return changed, ignored


def report_expected(db: DBSession, session_id: uuid.UUID, participant_id: uuid.UUID,
                    report: ExpectedReport) -> IngestExpectedResponse:
    now = datetime.now(timezone.utc)
    row = _locked(db, participant_id)
    if row is None:
        row = SessionIngestExpected(
            participant_id=participant_id, session_id=session_id, feature=report.feature,
            raw_eeg=report.raw["eeg"] if report.raw else None, raw_ppg=report.raw["ppg"] if report.raw else None,
            raw_acc=report.raw["acc"] if report.raw else None, final=report.final,
            first_reported_at=now, reported_at=now, updated_at=now)
        try:
            with db.begin_nested():
                db.add(row)
                db.flush()
            db.commit()
            return _response(session_id, row, True, [])
        except IntegrityError:
            # 동시에 첫 보고가 들어온 경우 — 승자 행을 잠그고 병합한다.
            db.expire_all()
            row = _locked(db, participant_id)
            if row is None:
                raise
    changed, ignored = _merge(row, report, now)
    db.commit()
    return _response(session_id, row, changed, ignored)
