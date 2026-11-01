"""SDD-265 — 회원 본인 데이터 저장 현황 목록 (`GET /upload-status/me/sessions`).

- 본인 `SessionParticipant` 가 있는 회차만, 본인 한 명 기준 수치만 돌려준다(타인 이름·인원 없음).
- 회차 요약은 목록과 같은 `_summaries(user_id=…)` 를 쓴다(같은 계산, 캐시 키만 사용자별).
- 계약 정본: specs/sdd-265-upload-status-redesign/contract.md §3
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DBSession

from app.models.class_program import Class
from app.models.organization import Organization
from app.models.session import Session, SessionParticipant
from app.schemas.upload_status_overview import MemberSessionItem, MemberSessionsResponse
from app.services import upload_metrics_service as metrics_svc
from app.services import upload_status_overview_service as ov
from app.services.upload_status_service import _i, _iso, _matches

DEFAULT_LIMIT = 10
MEMBER_STATUSES = ("in_progress", "completed")


@dataclass(frozen=True)
class MemberResult:
    etag: str
    poll_interval_sec: int
    body: MemberSessionsResponse | None


def _candidates(db: DBSession, user_id: uuid.UUID, *, since: datetime, limit: int, cursor: tuple | None) -> list:
    p = SessionParticipant
    eff = ov.effective_time()
    base = (
        select(
            Session.id.label("session_id"), Session.class_id, Session.status, Session.started_at, Session.ended_at,
            Session.title.label("session_title"), Session.seq, Class.title.label("class_title"),
            Class.organization_id, Organization.name.label("organization_name"),
            ov.group_key().label("grp"), eff.label("eff"), func.count().over().label("total"),
        )
        .join(p, p.session_id == Session.id)
        .outerjoin(Class, Class.id == Session.class_id)
        .outerjoin(Organization, Organization.id == Class.organization_id)
        .where(p.user_id == user_id, p.removed_at.is_(None), p.waitlist_cancelled_at.is_(None),
               p.superseded_by_participant_id.is_(None),
               Session.hidden_at.is_(None), Session.is_template.is_(False),
               Session.status.in_(MEMBER_STATUSES), eff >= since)
        .group_by(Session.id, Class.id, Organization.id)
    )
    inner = base.subquery()
    stmt = select(inner).order_by(inner.c.grp.asc(), inner.c.eff.desc(), inner.c.session_id.asc()).limit(limit)
    if cursor is not None:
        stmt = stmt.where(ov.keyset_after(inner.c.grp, inner.c.eff, inner.c.session_id, cursor))
    return db.execute(stmt).all()


def _item(c, s: dict, as_of: datetime) -> MemberSessionItem:
    part = s["_parts"][0] if s["_parts"] else None
    pm = s["_pms"][0] if s["_pms"] else None
    prog = part.progress if part else None
    return MemberSessionItem(
        session_id=str(c.session_id), class_id=str(c.class_id) if c.class_id else None, class_title=c.class_title,
        session_title=c.session_title, seq=c.seq, organization_name=c.organization_name,
        session_status=c.status, started_at=_iso(c.started_at), ended_at=_iso(c.ended_at),
        # 수집 제외(excluded)는 4값 배지에 없다 → no_data 로 두고 collection_state 로 구분한다(문제 아님).
        status="no_data" if part is None or part.status == "excluded" else part.status,
        collection_state=part.collection_state if part else "unknown",
        progress_state=prog.state if prog else "expected_unknown",
        percent=prog.total.percent if prog else None,
        bytes_arrived=pm.bytes_arrived if pm else 0, bytes_expected=pm.bytes_expected if pm else None,
        bytes_basis="estimate" if pm and pm.bytes_expected is not None else None,
        duration_min=metrics_svc.duration_minutes(c.started_at, c.ended_at, c.status, as_of),
        measured_min=(pm.windows // 60) if pm else 0,
        last_received_at=s["last_received_at"])


def load_member_sessions(db: DBSession, actor: dict, *, limit: int = DEFAULT_LIMIT, since: str | None = None,
                         cursor: str | None = None, if_none_match: str | None = None) -> MemberResult:
    user_id = uuid.UUID(str(actor["id"]))
    as_of = ov._utcnow()
    since_dt = ov.parse_since(since, as_of)
    cur = ov._parse_cursor(cursor)
    rows = _candidates(db, user_id, since=since_dt, limit=limit + 1, cursor=cur)
    total = _i(rows[0].total) if rows else 0
    has_more = len(rows) > limit
    cands = rows[:limit]
    summaries = ov._summaries(db, cands, as_of, user_id) if cands else {}
    items = [_item(c, summaries[c.session_id], as_of) for c in cands]
    next_cursor = ov._cursor_of(cands[-1]) if has_more else None

    payload = json.dumps([[it.model_dump() for it in items], total, limit, next_cursor], sort_keys=True,
                         ensure_ascii=False)
    etag = f'W/"{hashlib.sha256(payload.encode()).hexdigest()[:32]}"'
    poll = 5 if any(it.session_status == "in_progress" for it in items) else 60
    if _matches(if_none_match, etag):
        return MemberResult(etag, poll, None)
    body = MemberSessionsResponse(
        as_of=_iso(as_of), poll_interval_sec=poll, etag=etag, since=_iso(since_dt), limit=limit,
        total_candidates=total, items=items, next_cursor=next_cursor, has_more=next_cursor is not None)
    return MemberResult(etag, poll, body)


def forbidden() -> HTTPException:
    return HTTPException(403, detail={"code": "upload_status_forbidden"})
