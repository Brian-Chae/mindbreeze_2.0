"""리포트 생성 진행 상태 — SDD-095

세션 종료 후 STT → 화자분리 → AI 요약 → 리포트 생성은 Celery 로 수 분 걸린다.
그동안 사용자에게 '처리 중'을 명확히 보여주기 위해, 진행 상태를 단일 계약으로
파생(derive)하고 Socket.IO `report:progress` 로 브로드캐스트한다.

상태머신 (Report.generation_status)
    pending    — 파이프라인 미시작(녹음 전·리포트 미생성)
    processing — 녹음 저장·STT·요약·리포트 생성 진행 중
    ready      — 리포트 생성 완료(가용한 산출물 포함)
    partial    — 일부만 산출(마이크 오프·저신뢰·전사 없음·요약/리포트 실패)

※ Report.status(승인 게이트: pending_analysis → pending_review → completed/error)와는
   독립 축이다. 승인 상태머신은 그대로 두고 '생성 진행'만 이 서비스가 관장한다.

스텝 계약(프론트 스텝퍼와 1:1) — save(녹음 저장) → stt → summary → ready(완료)
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.record import Report, SessionRecord

logger = logging.getLogger(__name__)

# ── 상태 상수 ────────────────────────────────────────────────────────────
GENERATION_PENDING = "pending"
GENERATION_PROCESSING = "processing"
GENERATION_READY = "ready"
GENERATION_PARTIAL = "partial"

GENERATION_STATUSES: tuple[str, ...] = (
    GENERATION_PENDING,
    GENERATION_PROCESSING,
    GENERATION_READY,
    GENERATION_PARTIAL,
)

# ── 스텝 상수 ────────────────────────────────────────────────────────────
STEP_SAVE = "save"
STEP_STT = "stt"
STEP_SUMMARY = "summary"
STEP_READY = "ready"

STEP_LABELS: dict[str, str] = {
    STEP_SAVE: "녹음 저장",
    STEP_STT: "음성 인식(STT)",
    STEP_SUMMARY: "AI 요약",
    STEP_READY: "리포트 완료",
}
STEP_ORDER: tuple[str, ...] = (STEP_SAVE, STEP_STT, STEP_SUMMARY, STEP_READY)

# 스텝 상태 — pending(대기) / active(진행 중) / done(완료) / skipped(해당 없음) / failed(실패)
STEP_PENDING = "pending"
STEP_ACTIVE = "active"
STEP_DONE = "done"
STEP_SKIPPED = "skipped"
STEP_FAILED = "failed"

# 진행률 가중치 — skipped/failed 는 더 진행할 것이 없으므로 완료로 계산한다(멈춘 표시 방지).
_STEP_WEIGHTS: dict[str, float] = {
    STEP_DONE: 1.0,
    STEP_SKIPPED: 1.0,
    STEP_FAILED: 1.0,
    STEP_ACTIVE: 0.4,
    STEP_PENDING: 0.0,
}

# 사유(reason) 계약 — 프론트가 문구를 붙인다.
REASON_MIC_OFF = "mic_off"
REASON_LOW_CONFIDENCE = "low_confidence"
REASON_NO_TRANSCRIPT = "no_transcript"
REASON_STT_FAILED = "stt_failed"
REASON_SUMMARY_FAILED = "summary_failed"
REASON_REPORT_FAILED = "report_failed"
REASON_TIMEOUT = "timeout"

# 리포트 생성 타임아웃(워치독) — 'processing' 이 이 시간을 넘기면 beat 스윕이 마감한다.
REPORT_GENERATION_TIMEOUT_SECONDS = 30 * 60


def _sid(session_id: str | UUID) -> UUID:
    """세션 ID 정규화 — 잘못된 형식은 ValueError(라우터/태스크가 먼저 검증한다)."""
    return session_id if isinstance(session_id, UUID) else UUID(str(session_id))


def _ai_summary(record: SessionRecord | None) -> dict:
    """SessionRecord.ai_summary 안전 접근(dict 아니면 빈 dict)."""
    if record is None:
        return {}
    summary = record.ai_summary
    return summary if isinstance(summary, dict) else {}


def _has_transcript(record: SessionRecord | None) -> bool:
    return bool(record and record.transcript and record.transcript.strip())


def _latest_report(reports: list[Report]) -> Report | None:
    return reports[-1] if reports else None


def _derive_reason(record: SessionRecord | None, reports: list[Report]) -> str | None:
    """partial 로 마감된 이유(또는 진행 차단 사유)를 단일 값으로 파생한다."""
    record_status = (record.status if record else "idle") or "idle"
    summary = _ai_summary(record)

    if record_status == "manual":
        return REASON_MIC_OFF
    if record_status == "failed":
        # STT 단계 실패(전사문 없음) — 오디오/공급자 오류
        return REASON_STT_FAILED if not _has_transcript(record) else REASON_SUMMARY_FAILED
    if summary.get("transcript_confidence") == "low":
        return REASON_LOW_CONFIDENCE
    if summary.get("summary_failed"):
        return REASON_SUMMARY_FAILED
    # SDD-095 후속(워치독): 생성 실패 사유를 최우선 노출. generation_error 가
    # 타임아웃(REASON_TIMEOUT)이면 시간초과, 그 외(생성 예외 메시지)는 실패로 구분한다.
    for r in reports:
        generation_error = getattr(r, "generation_error", None)
        if generation_error:
            return REASON_TIMEOUT if generation_error == REASON_TIMEOUT else REASON_REPORT_FAILED
    latest = _latest_report(reports)
    if latest is not None and latest.status == "error":
        return REASON_REPORT_FAILED
    if record is not None and not _has_transcript(record) and record_status not in (
        "idle",
        "recording",
        "processing",
    ):
        return REASON_NO_TRANSCRIPT
    return None


def _save_step_state(record: SessionRecord | None) -> str:
    record_status = (record.status if record else "idle") or "idle"
    if record_status == "idle":
        return STEP_PENDING
    if record_status == "recording":
        return STEP_ACTIVE
    if record_status == "manual":
        # 마이크 오프(수동 기록) — 저장할 오디오가 없다.
        return STEP_SKIPPED
    # processing / completed / failed — 녹음 저장은 끝났다.
    return STEP_DONE


def _stt_step_state(record: SessionRecord | None, save_state: str) -> str:
    record_status = (record.status if record else "idle") or "idle"
    if save_state == STEP_SKIPPED or record_status == "manual":
        return STEP_SKIPPED
    if _has_transcript(record):
        return STEP_DONE
    if record_status == "failed":
        return STEP_FAILED
    if record_status in ("processing",):
        return STEP_ACTIVE
    return STEP_PENDING


def _summary_step_state(record: SessionRecord | None, stt_state: str) -> str:
    record_status = (record.status if record else "idle") or "idle"
    if stt_state in (STEP_SKIPPED, STEP_FAILED):
        return STEP_SKIPPED
    summary = _ai_summary(record)
    if not _has_transcript(record):
        return STEP_PENDING
    if summary.get("transcript_confidence") == "low":
        # 저신뢰 전사문은 AI 요약을 제공하지 않는다(SDD-085 G5) — 원본 전사문만 유지.
        return STEP_SKIPPED
    if summary.get("headline"):
        return STEP_DONE
    if summary.get("summary_failed"):
        return STEP_FAILED
    if record_status == "processing":
        return STEP_ACTIVE
    return STEP_PENDING


def _ready_step_state(record: SessionRecord | None, summary_state: str, reports: list[Report]) -> str:
    if reports:
        statuses = [r.generation_status or GENERATION_PENDING for r in reports]
        if all(s in (GENERATION_READY, GENERATION_PARTIAL) for s in statuses):
            return STEP_DONE
        return STEP_ACTIVE
    record_status = (record.status if record else "idle") or "idle"
    if record_status in ("idle", "recording"):
        return STEP_PENDING
    if summary_state in (STEP_ACTIVE, STEP_PENDING) and record_status == "processing":
        return STEP_PENDING
    # 녹음/요약이 끝났는데 리포트 행이 아직 없다 → 리포트 생성 진행 중
    return STEP_ACTIVE if record_status in ("processing", "completed", "failed", "manual") else STEP_PENDING


def _build_steps(record: SessionRecord | None, reports: list[Report]) -> tuple[list[dict], str]:
    """스텝 목록과 '현재 단계(stage)'를 계산한다."""
    save_state = _save_step_state(record)
    stt_state = _stt_step_state(record, save_state)
    summary_state = _summary_step_state(record, stt_state)
    ready_state = _ready_step_state(record, summary_state, reports)

    states = {
        STEP_SAVE: save_state,
        STEP_STT: stt_state,
        STEP_SUMMARY: summary_state,
        STEP_READY: ready_state,
    }
    steps = [
        {"key": key, "label": STEP_LABELS[key], "state": states[key]}
        for key in STEP_ORDER
    ]

    # 현재 단계 = active 우선, 없으면 마지막 완료 다음 단계, 아니면 마지막 스텝
    stage = STEP_READY
    for key in STEP_ORDER:
        if states[key] == STEP_ACTIVE:
            stage = key
            break
    else:
        if states[STEP_READY] == STEP_DONE:
            stage = STEP_READY
        else:
            pending = [k for k in STEP_ORDER if states[k] == STEP_PENDING]
            stage = pending[0] if pending else STEP_READY
    return steps, stage


def _aggregate_generation_status(record: SessionRecord | None, reports: list[Report]) -> str:
    """리포트 행이 있으면 리포트에서, 없으면 레코드 진행에서 생성 상태를 파생한다."""
    if reports:
        statuses = [r.generation_status or GENERATION_PENDING for r in reports]
        if any(s == GENERATION_PROCESSING for s in statuses):
            return GENERATION_PROCESSING
        if all(s == GENERATION_READY for s in statuses):
            return GENERATION_READY
        if all(s in (GENERATION_READY, GENERATION_PARTIAL) for s in statuses):
            return GENERATION_PARTIAL
        return GENERATION_PROCESSING

    record_status = (record.status if record else "idle") or "idle"
    if record_status == "manual":
        # 마이크 오프 — 원본 오디오가 없어 리포트는 부분 산출로 마감된다.
        return GENERATION_PARTIAL
    if record_status == "failed":
        return GENERATION_PARTIAL
    if record_status == "idle":
        return GENERATION_PENDING
    # recording / processing / completed — 리포트 생성이 아직 끝나지 않았다.
    return GENERATION_PROCESSING


def compute_report_progress(session_id: str | UUID, db: DBSession) -> dict:
    """세션의 리포트 생성 진행 상태를 단일 계약 dict 로 파생한다.

    DB 만 읽는다(부작용 없음) — API 응답과 Socket.IO 페이로드가 같은 값을 쓴다.
    """
    sid = _sid(session_id)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
    reports = (
        db.query(Report)
        .filter(Report.session_id == sid)
        .order_by(Report.created_at.asc(), Report.id.asc())
        .all()
    )

    steps, stage = _build_steps(record, reports)
    generation_status = _aggregate_generation_status(record, reports)

    total_weight = sum(_STEP_WEIGHTS[s["state"]] for s in steps)
    progress = int(round(total_weight / len(steps) * 100))

    report_statuses = [r.status for r in reports]
    return {
        "session_id": str(sid),
        "generation_status": generation_status,
        "stage": stage,
        "progress": progress,
        "reason": _derive_reason(record, reports),
        "report_status": report_statuses[0] if len(set(report_statuses)) == 1 else None,
        "steps": steps,
        "updated_at": datetime.now(timezone.utc),
    }


def mark_reports_generation(
    session_id: str | UUID,
    generation_status: str,
    db: DBSession,
    *,
    commit: bool = True,
) -> int:
    """세션의 모든 리포트 생성 상태를 갱신한다(멱등). 갱신한 행 수를 반환한다."""
    if generation_status not in GENERATION_STATUSES:
        raise ValueError(f"알 수 없는 리포트 생성 상태: {generation_status}")

    sid = _sid(session_id)
    reports = db.query(Report).filter(Report.session_id == sid).all()
    changed = 0
    for report in reports:
        if report.generation_status != generation_status:
            report.generation_status = generation_status
            changed += 1
    if changed and commit:
        db.commit()
    return changed


def mark_report_generation(report: Report, generation_status: str, db: DBSession, *, commit: bool = True) -> None:
    """단일 리포트의 생성 상태를 갱신한다."""
    if generation_status not in GENERATION_STATUSES:
        raise ValueError(f"알 수 없는 리포트 생성 상태: {generation_status}")
    if report.generation_status == generation_status:
        return
    report.generation_status = generation_status
    if commit:
        db.commit()


def generation_status_for_content(content: dict, record: SessionRecord | None) -> str:
    """생성된 content 기준으로 최종 생성 상태(ready/partial)를 판정한다.

    - ai_record 미가용(mic_off·저신뢰·전사 없음) → partial
    - AI 요약 실패(summary_failed) → partial
    """
    ai_record = content.get("ai_record") if isinstance(content, dict) else None
    if not isinstance(ai_record, dict) or ai_record.get("status") != "available":
        return GENERATION_PARTIAL
    if _ai_summary(record).get("summary_failed"):
        return GENERATION_PARTIAL
    return GENERATION_READY


def sweep_stale_reports(db: DBSession, *, commit: bool = True) -> list[str]:
    """타임아웃 워치독 — 'processing'에 머문 리포트/세션 기록을 터미널 상태로 마감한다.

    Celery 파이프라인이 워커에서 중단(SIGKILL·크래시·브로커 장애)되면 상태가
    'processing'에 영구히 남는다. beat 스윕이 시작 시각 경과를 기준으로 먹통을
    감지하고, 영향을 받은 세션 id 목록을 반환한다(브로드캐스트용).
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=REPORT_GENERATION_TIMEOUT_SECONDS)

    affected: list[str] = []

    # 1) 리포트 생성 단계 — generation_status=processing + 시작 시각 초과
    stale_reports = (
        db.query(Report)
        .filter(
            Report.generation_status == GENERATION_PROCESSING,
            Report.generation_started_at.isnot(None),
            Report.generation_started_at < cutoff,
        )
        .all()
    )
    for report in stale_reports:
        report.generation_status = GENERATION_PARTIAL
        report.generation_error = REASON_TIMEOUT
        affected.append(str(report.session_id))

    # 2) STT/요약 단계(리포트 행 생성 전) — 녹음 종료 후에도 processing 에 머문 기록
    stale_records = (
        db.query(SessionRecord)
        .filter(
            SessionRecord.status == "processing",
            SessionRecord.recording_ended_at.isnot(None),
            SessionRecord.recording_ended_at < cutoff,
        )
        .all()
    )
    for record in stale_records:
        record.status = "failed"
        affected.append(str(record.session_id))

    if affected and commit:
        db.commit()
    # 세션 중복 제거(순서 보존)
    return list(dict.fromkeys(affected))


async def _broadcast(session_id: str, payload: dict) -> None:
    from app.ws.record_namespace import broadcast_report_progress

    await broadcast_report_progress(session_id, payload)


def emit_report_progress(session_id: str | UUID, db: DBSession) -> dict:
    """진행 상태를 계산해 `report:progress` 로 브로드캐스트하고 페이로드를 반환한다.

    Celery 태스크(동기)에서 호출되므로 asyncio.run 으로 1회성 emit 을 수행한다.
    이미 이벤트 루프가 돌고 있으면(비동기 컨텍스트) 브로드캐스트만 건너뛴다 —
    상태 파생·DB 반영은 호출부가 이미 마쳤다.
    """
    sid = _sid(session_id)
    payload = compute_report_progress(sid, db)
    try:
        asyncio.run(_broadcast(str(sid), payload))
    except RuntimeError:
        logger.debug("[report_progress] 이벤트 루프 내부 — 브로드캐스트 생략: %s", sid)
    except Exception:  # noqa: BLE001 — WS 실패가 파이프라인을 막지 않는다.
        logger.warning("[report_progress] 브로드캐스트 실패: %s", sid, exc_info=True)
    return payload
