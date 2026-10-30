"""SDD-209(B3/BE-3): 리포트 반영 범위(report_included) 필터 — 리포트 전 경로가 공유하는 단일 판정.

정책(P2): 참가자는 기본 `제외`이고 명시 선택한 경우에만 리포트에 반영된다. 제외한 참가자는
**집계·리포트에서만** 빠지고 저장(원본·지표)은 그대로다.

- 상담사 리포트 EEG: 첫 참가자 1명이 아니라 **반영에 동의한 참가자 전원**의 집계(1:1 은 그 1명).
- 상담사 리포트 transcript_segments·영상·AI 공통 요약: 그룹 공통 녹음은 참여자별 기여분을 분리할 수 없으므로
  대기열 밖 참가자 중 1명이라도 제외면 넣지 않는다(원본은 보존).
- 내담자 리포트: 제외한 본인의 리포트는 내용 없이 안내(stub)만.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.session import SessionParticipant

# 상담사 리포트에 쓰는 안내(전원 제외) / 내담자 본인 리포트 안내(제외)
COUNSELOR_ALL_EXCLUDED_NOTICE = "참가자가 제외를 선택했어요"
CLIENT_EXCLUDED_NOTICE = "리포트에 반영되지 않아요"
# 제외 때문에 비운 not_measured 와 실제 미측정을 구분하는 사유 코드(하위호환: 없으면 기존 문구)
EXCLUDED_REASON = "participant_excluded"
SCOPE_VERSION = 1


@dataclass(frozen=True)
class ReportScope:
    """한 클래스의 리포트 반영 범위(대기열 밖 참가자 기준)."""

    included_ids: frozenset[UUID] = field(default_factory=frozenset)
    excluded_ids: frozenset[UUID] = field(default_factory=frozenset)

    @property
    def has_participants(self) -> bool:
        return bool(self.included_ids or self.excluded_ids)

    @property
    def any_excluded(self) -> bool:
        return bool(self.excluded_ids)

    @property
    def all_excluded(self) -> bool:
        return self.has_participants and not self.included_ids

    def is_excluded(self, participant_id: UUID | None) -> bool:
        return participant_id is not None and participant_id in self.excluded_ids


def scopes_for_sessions(session_ids: Iterable[UUID], db: DBSession) -> dict[UUID, ReportScope]:
    """세션별 리포트 반영 범위를 배치로 만든다(대기열 참가자는 리포트 대상이 아니라 제외하고 센다)."""
    ids = list(set(session_ids))
    if not ids:
        return {}
    rows = (
        db.query(
            SessionParticipant.session_id,
            SessionParticipant.id,
            SessionParticipant.report_included,
            SessionParticipant.entered_at,
        )
        .filter(
            SessionParticipant.session_id.in_(ids),
            SessionParticipant.is_waitlisted.is_(False),
        )
        .all()
    )
    included: dict[UUID, set[UUID]] = {sid: set() for sid in ids}
    excluded: dict[UUID, set[UUID]] = {sid: set() for sid in ids}
    # SDD-209(B9): 입장 시각이 기록되는 클래스(참여자 중 한 명이라도 entered_at 이 있는 클래스)에서는
    # 초대만 받고 들어오지 않은 참여자(entered_at NULL)를 범위에서 뺀다 — 불참자가 기본 `제외`로 세어져
    # 그룹 공통 기록이 통째로 빠지는 것을 막는다. 기록 도입 전 클래스(전원 NULL)는 기존 규칙 그대로.
    has_entry_record = {sid for sid, _pid, _flag, entered in rows if entered is not None}
    for sid, pid, flag, entered in rows:
        if sid in has_entry_record and entered is None:
            continue
        (included if flag else excluded)[sid].add(pid)
    return {
        sid: ReportScope(frozenset(included[sid]), frozenset(excluded[sid])) for sid in ids
    }


def scope_for_session(session_id: UUID, db: DBSession) -> ReportScope:
    return scopes_for_sessions([session_id], db).get(session_id, ReportScope())


def is_participant_excluded(session_id: UUID, participant_id: UUID | None, db: DBSession) -> bool:
    """이 참가자가 리포트 반영에서 제외 상태인지(없는 참가자·대기열은 제외로 보지 않음)."""
    if participant_id is None:
        return False
    row = (
        db.query(SessionParticipant.report_included, SessionParticipant.is_waitlisted)
        .filter(
            SessionParticipant.id == participant_id,
            SessionParticipant.session_id == session_id,
        )
        .first()
    )
    if row is None:
        return False
    return (not bool(row[0])) and not bool(row[1])


def scope_marker(scope: ReportScope) -> dict:
    """리포트 content 스냅샷에 남기는 범위 표식(조회 방어 필터가 신구 스냅샷을 구분하는 근거)."""
    return {
        "version": SCOPE_VERSION,
        "included_participants": len(scope.included_ids),
        "excluded_participants": len(scope.excluded_ids),
    }


def excluded_eeg_block() -> dict:
    """전원 제외 시 EEG 구간 — 비우고 안내만(프론트는 not_measured 로 섹션을 숨기고 notice 를 표기)."""
    return {"status": "not_measured", "excluded": True, "reason": EXCLUDED_REASON, "notice": COUNSELOR_ALL_EXCLUDED_NOTICE}


def client_excluded_content(title: str | None, session_type: str | None, scheduled_at) -> dict:
    """제외한 내담자 본인 리포트 — 지표·서사·기록 없이 안내만."""
    return {
        "title": title or "내 마음 리포트",
        "session_type": session_type,
        "scheduled_at": scheduled_at,
        "report_scope": {"version": SCOPE_VERSION, "excluded": True, "notice": CLIENT_EXCLUDED_NOTICE},
        "eeg": {"status": "not_measured", "excluded": True, "reason": EXCLUDED_REASON, "notice": CLIENT_EXCLUDED_NOTICE},
        "ai_record": {"status": "not_available", "reason": "excluded"},
        "approved": False,
    }


def strip_counselor_shared_sources(content: dict) -> dict:
    """그룹 공통 녹음에서 파생한 항목(발화 기록·영상·AI 요약)을 상담사 리포트 content 에서 제거한다."""
    out = dict(content)
    out["transcript_segments"] = None
    if "video" in out:
        out["video"] = (
            {"available": False, "status": (out["video"] or {}).get("status")}
            if isinstance(out.get("video"), dict)
            else out["video"]
        )
    out["ai_record"] = {"status": "not_available", "reason": "excluded"}
    out.pop("summary", None)
    return out


def apply_read_filter(
    content: dict, *, report_type: str, participant_id: UUID | None, scope: ReportScope
) -> dict:
    """저장된 스냅샷이 구버전이어도 제외가 보장되도록 조회 시점에 한 번 더 거른다(방어 필터)."""
    if not isinstance(content, dict):
        return content
    if report_type == "client":
        if scope.is_excluded(participant_id):
            return client_excluded_content(
                content.get("title"), content.get("session_type"), content.get("scheduled_at")
            )
        return content
    # 상담사 리포트
    if not scope.any_excluded:
        return content
    out = strip_counselor_shared_sources(content)
    marker = content.get("report_scope")
    new_snapshot = isinstance(marker, dict) and marker.get("version") == SCOPE_VERSION
    if scope.all_excluded:
        out["eeg"] = excluded_eeg_block()
        out.pop("client_comments", None)
    elif not new_snapshot and scope.is_excluded(participant_id):
        # 구 스냅샷은 첫 참가자 1명만 집계했다 — 그 1명이 제외면 EEG 를 비운다.
        out["eeg"] = excluded_eeg_block()
    return out
