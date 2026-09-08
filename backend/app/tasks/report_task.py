"""AI 리포트 생성 Celery 태스크 — SDD-022 단일 content 계약 + EEG 병합

핵심 원칙(§ SDD-022)
  1. null 보존 — 산출 불가는 None. `or 0`/`or {}` 로 0/빈값 치환 금지.
  2. content 하위호환 — headline 유지 + summary 추가.
  3. EEG 는 opt-in 확장 레이어 — feature 윈도우가 있을 때만 지표 산출,
     없으면 status="not_measured" (프론트에서 EEG 섹션 미노출).
"""

import logging
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.session import Session
from app.models.record import SessionRecord, Report, EEGRecord
from app.models.eeg_feature import EEGFeatureWindow
from app.services import eeg_metrics

logger = logging.getLogger(__name__)


def _ai_summary(record: SessionRecord | None) -> dict:
    """SessionRecord.ai_summary 안전 접근 (dict 아니면 빈 dict).

    ※ 이는 지표값의 null 치환이 아니라 dict 접근 가드다 — 산출 결과의
       None 은 여기서 절대 만들어지지 않는다."""
    if record is None:
        return {}
    summary = record.ai_summary
    return summary if isinstance(summary, dict) else {}


def _summary_text(summary: dict) -> str | None:
    """ai_summary 에서 요약 문장을 추출. 없으면 None (0/빈문자 치환 금지)."""
    for key in ("summary", "overview", "headline"):
        v = summary.get(key)
        if isinstance(v, str) and v.strip():
            return v
    return None


def _markers(record: SessionRecord | None) -> list[dict]:
    """마커를 UI 계약 [{label, value}] 로 정규화한다."""
    if record is None or not record.markers:
        return []
    out: list[dict] = []
    for m in record.markers:
        if isinstance(m, dict):
            label = m.get("label") or m.get("title") or m.get("type")
            if label is None:
                continue
            out.append({"label": str(label), "value": m.get("value", "")})
        elif isinstance(m, str):
            out.append({"label": m, "value": ""})
    return out


def _longest_usable_run(windows: list[EEGFeatureWindow]) -> int:
    """quality 가 valid/degraded 인 연속 윈도우의 최장 길이 (§A4.4)."""
    longest = run = 0
    for w in windows:
        if w.quality in ("valid", "degraded"):
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    return longest


def _build_eeg_content(session_id: UUID, db: DBSession, participant_id: UUID | None = None) -> dict:
    """EEGFeatureWindow 시계열 → content.eeg 단일 계약 블록.

    윈도우가 없으면(미착용/미수집) status="not_measured" — 프론트에서 섹션 숨김.
    """
    windows = (
        db.query(EEGFeatureWindow)
        .filter(EEGFeatureWindow.session_id == session_id)
        .filter(EEGFeatureWindow.participant_id == participant_id if participant_id else True)
        .order_by(EEGFeatureWindow.window_index)
        .all()
    )
    if not windows:
        return {"status": "not_measured"}

    def series(attr: str) -> list:
        return [getattr(w, attr) for w in windows]

    total = len(windows)
    valid = sum(1 for w in windows if w.quality == "valid")
    degraded = sum(1 for w in windows if w.quality == "degraded")
    longest = _longest_usable_run(windows)

    try:
        m = eeg_metrics.compute_session_metrics(
            focus_index=series("focus_index"),
            cognitive_load=series("cognitive_load"),
            relaxation_index=series("relaxation_index"),
            stress_index=series("stress_index"),
            emotional_stability=series("emotional_stability"),
            total_neural_activity=series("total_neural_activity"),
            faa=series("faa"),
            hemispheric_balance=series("hemispheric_balance"),
            windows_total=total,
            windows_valid=valid,
            windows_degraded=degraded,
            longest_usable_run=longest,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("[report_task] EEG 지표 산출 실패: %s", exc)
        return {"status": "not_measured"}

    # 7지표 — null 보존 (0 치환 금지)
    metrics = {k: getattr(m, k) for k in eeg_metrics.DEFAULT_SCORE_WEIGHTS}
    # 3채널 타임라인 (t=초 인덱스, 원천 feature 그대로 — 스케일링은 프론트 담당)
    timeline = [
        {
            "t": w.window_index,
            "concentration": w.focus_index,
            "relaxation": w.relaxation_index,
            "stress": w.stress_index,
        }
        for w in windows
    ]
    return {
        "status": m.session_status,
        "reliability": m.eeg_reliability,
        "drowsiness_flag": bool(m.drowsiness_flag),
        "score": m.meditation_total_score,  # 종합점수 — null 보존
        "metrics": metrics,
        # 두뇌휴식도 = relaxation_score 단일 소스 (§ SDD-022)
        "summary_labels": {"relaxation_score": "두뇌휴식도"},
        "timeline": timeline,
        "normalization_version": (
            str(m.constants_version) if m.constants_version is not None else None
        ),
    }


def _counselor_content(session: Session, record: SessionRecord | None, eeg_block: dict) -> dict:
    summary = _ai_summary(record)
    return {
        "title": session.title or f"{session.type} 세션 리포트",
        "session_type": session.type,
        "scheduled_at": session.scheduled_at.isoformat() if session.scheduled_at else None,
        # 하위호환: headline 유지 + summary 추가
        "headline": summary.get("headline", "AI 리포트 (자동 생성)"),
        "summary": _summary_text(summary),
        "sections": summary.get("sections"),  # 없으면 None — {} 치환 금지
        "markers": _markers(record),
        "counselor_notes": (record.counselor_notes if record else None),
        "eeg": eeg_block,
        "approved": False,
    }


def _client_content(session: Session, record: SessionRecord | None, eeg_block: dict) -> dict:
    summary = _ai_summary(record)
    sections = summary.get("sections")
    insights: list[str] = []
    if isinstance(sections, dict):
        for v in list(sections.values())[:3]:
            insights.append(v if isinstance(v, str) else str(v))
    return {
        "title": session.title or "내 마음 리포트",
        "session_type": session.type,
        "scheduled_at": session.scheduled_at.isoformat() if session.scheduled_at else None,
        # 하위호환: headline 유지 + summary 추가
        "headline": "오늘의 인사이트",
        "summary": _summary_text(summary),
        "greeting": "오늘 세션을 함께해주셔서 감사합니다.",
        "insights": insights,
        "eeg": eeg_block,
        "approved": False,
    }


# SDD-027: EEG 품질 게이트(§A4.4) status → 데이터 신뢰도(data_credibility) 파생.
# not_measured(EEG 미측정)는 신뢰도 개념이 없으므로 None 유지(0/'low' 치환 금지).
_CREDIBILITY_BY_EEG_STATUS = {
    "valid": "high",
    "degraded": "medium",
    "invalid": "low",
    "insufficient": "low",
}


def _derive_data_credibility(eeg_block: dict) -> str | None:
    """content.eeg 품질 게이트에서 데이터 신뢰도를 파생한다(미측정이면 None)."""
    if not isinstance(eeg_block, dict):
        return None
    return _CREDIBILITY_BY_EEG_STATUS.get(eeg_block.get("status"))


def generate_report_inline(report_id: str, db: DBSession) -> Report | None:
    rid = UUID(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        logger.warning("[report_task] report not found: %s", report_id)
        return None
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not session:
        return report

    record = db.query(SessionRecord).filter(SessionRecord.session_id == session.id).first()

    try:
        eeg_block = _build_eeg_content(session.id, db, report.participant_id if report.type == "client" else None)
        if report.type == "client":
            # 그룹 세션의 공통 녹음 요약은 다른 참가자의 상담 내용을 포함할 수 있다.
            client_record = None if session.participant_mode == "group" else record
            content = _client_content(session, client_record, eeg_block)
        else:
            content = _counselor_content(session, record, eeg_block)
        # SDD-027: 분석 성공 → 승인 게이트(pending_review) 로 전이 + 신뢰도 파생
        report.data_credibility = _derive_data_credibility(eeg_block)
        report.status = "pending_review"
    except Exception as exc:  # noqa: BLE001
        logger.exception("[report_task] generate failed: %s", exc)
        content = {"headline": "리포트 생성 실패", "error": str(exc), "fallback": True}
        # SDD-027: 분석 실패 → error 상태(신뢰도 판정 불가 — None 유지)
        report.status = "error"
        report.data_credibility = None

    report.content = content
    db.commit()
    db.refresh(report)
    return report


try:
    from celery import shared_task

    @shared_task(name="tasks.report")
    def report_task(report_id: str) -> None:
        from app.core.database import SessionLocal

        db = SessionLocal()
        try:
            generate_report_inline(report_id, db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    pass
