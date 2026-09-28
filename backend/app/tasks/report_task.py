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
from app.models.record import SessionRecord, Report
from app.models.eeg_feature import EEGFeatureWindow
from app.models.normalization_model import NormalizationModel
from app.services import eeg_metrics
from app.services import report_progress_service
from app.services.eeg_rollup_service import summarize_hrv_motion
from app.services.report_narrative import build_metrics_summary
from app.tasks.summary_task import _call_narrative_llm

logger = logging.getLogger(__name__)


def _emit_report_progress(session_id: str, db: DBSession) -> None:
    """SDD-095: 리포트 생성 진행 상태(`report:progress`) 브로드캐스트.

    완료(ready/partial) 시점에 프론트가 조용한 토스트 1회를 띄울 수 있게 push 한다.
    """
    try:
        report_progress_service.emit_report_progress(session_id, db)
    except Exception:  # noqa: BLE001 — WS 실패가 리포트 생성을 막지 않는다.
        logger.warning("[report_task] report:progress emit failed: %s", session_id)


def _ai_summary(record: SessionRecord | None) -> dict:
    """SessionRecord.ai_summary 안전 접근 (dict 아니면 빈 dict).

    ※ 이는 지표값의 null 치환이 아니라 dict 접근 가드다 — 산출 결과의
       None 은 여기서 절대 만들어지지 않는다."""
    if record is None:
        return {}
    summary = record.ai_summary
    return summary if isinstance(summary, dict) else {}


def _ai_record_block(record: SessionRecord | None) -> dict:
    """음성/AI 요약 가용성 계약 — EEG `not_measured` 패턴 준용 (SDD-085).

    마이크 오프(manual) 세션은 status="not_available" + reason="mic_off" 로
    프론트가 요약 섹션을 숨기고 사유를 표기한다.
    신뢰도 낮음(low_confidence)도 동일하게 not_available 로 내려 AI 요약을 숨기되,
    원본 전사문(transcript_segments)은 별도 필드로 유지된다.
    """
    if record is not None and record.status == "manual":
        return {"status": "not_available", "reason": "mic_off"}
    # SDD-085 G5 확장: 오디오 분석 신뢰도 낮음 — AI 요약 미제공(원본 전사문은 유지)
    if record is not None and _ai_summary(record).get("transcript_confidence") == "low":
        return {"status": "not_available", "reason": "low_confidence"}
    if record is None or not (record.transcript and record.transcript.strip()):
        return {"status": "not_available", "reason": "no_transcript"}
    return {"status": "available"}


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


def _build_eeg_content(
    session_id: UUID,
    db: DBSession,
    participant_id: UUID | None = None,
    *,
    started_at=None,
    ended_at=None,
) -> dict:
    """EEGFeatureWindow 시계열 → content.eeg 단일 계약 블록.

    윈도우가 없으면(미착용/미수집) status="not_measured" — 프론트에서 섹션 숨김.
    SDD-088: 오픈(대기실) 중 수집된 EEG는 표시용일 뿐 분석 대상이 아니므로,
    started_at ~ ended_at 구간의 윈도우만 집계한다(경계 미전달 시 전체 유지 — 하위 호환).
    """
    q = (
        db.query(EEGFeatureWindow)
        .filter(EEGFeatureWindow.session_id == session_id)
        .filter(EEGFeatureWindow.participant_id == participant_id if participant_id else True)
    )
    if started_at is not None:
        q = q.filter(EEGFeatureWindow.created_at >= started_at)
    if ended_at is not None:
        q = q.filter(EEGFeatureWindow.created_at <= ended_at)
    windows = q.order_by(EEGFeatureWindow.window_index).all()
    if not windows:
        return {"status": "not_measured"}

    def series(attr: str) -> list:
        return [getattr(w, attr) for w in windows]

    total = len(windows)
    valid = sum(1 for w in windows if w.quality == "valid")
    degraded = sum(1 for w in windows if w.quality == "degraded")
    longest = _longest_usable_run(windows)

    # 활성 표준 모델 조회 — 있으면 sigmoid 정규화, 없으면 코호트 상수 fallback (SDD-041)
    # SDD-069: 활성 모델이 없으면 가장 최근 계산된 모델을 기본으로 적용
    active_model = (
        db.query(NormalizationModel)
        .filter(NormalizationModel.is_active.is_(True))
        .first()
    )
    if active_model is None:
        active_model = (
            db.query(NormalizationModel)
            .order_by(NormalizationModel.version.desc(), NormalizationModel.id.desc())
            .first()
        )
    normalization_params = active_model.params if active_model else None
    normalization_version = active_model.version if active_model else None

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
            normalization_params=normalization_params,
            normalization_version=normalization_version,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("[report_task] EEG 지표 산출 실패: %s", exc)
        return {"status": "not_measured"}

    # 7지표 — null 보존 (0 치환 금지)
    metrics = {k: getattr(m, k) for k in eeg_metrics.DEFAULT_SCORE_WEIGHTS}
    # 마음·몸 지표 타임라인 (t=초 인덱스, 원천 feature 그대로 — 스케일링은 프론트 담당)
    timeline = [
        {
            "t": w.window_index,
            "concentration": w.focus_index,
            "relaxation": w.relaxation_index,
            "stress": w.stress_index,
            "heart_rate": w.heart_rate,
            "respiratory_rate": w.respiratory_rate,
            "sdnn": w.sdnn,
            "rmssd": w.rmssd,
            "lf_power": w.lf_power,
            "hf_power": w.hf_power,
            "lf_hf_ratio": w.lf_hf_ratio,
            "motion": w.motion,
        }
        for w in windows
    ]
    return {
        **summarize_hrv_motion(windows),
        "status": m.session_status,
        "reliability": m.eeg_reliability,
        "drowsiness_flag": bool(m.drowsiness_flag),
        "score": m.meditation_total_score,  # 종합점수 — null 보존
        "metrics": metrics,
        # 두뇌휴식도 = relaxation_score 단일 소스 (§ SDD-022)
        "summary_labels": {"relaxation_score": "두뇌휴식도"},
        "timeline": timeline,
        "narrative": _call_narrative_llm(build_metrics_summary(windows, m.session_status), db),
        "normalization_source": m.normalization_source,
        "normalization_version": m.normalization_version,
    }


def _counselor_content(session: Session, record: SessionRecord | None, eeg_block: dict) -> dict:
    # STT 발화자 구분 segments — Gemini diarization 결과(ai_summary.segments)
    segments = _ai_summary(record).get("segments") if record else None
    return {
        "title": session.title or f"{session.type} 세션 리포트",
        "session_type": session.type,
        "scheduled_at": session.scheduled_at.isoformat() if session.scheduled_at else None,
        # AI 리뷰(summary/sections) 제거 — 1차는 원본 데이터(영상+STT) 기반으로 재구성
        "markers": _markers(record),
        "counselor_notes": (record.counselor_notes if record else None),
        "eeg": eeg_block,
        # SDD-085: 음성/AI 요약 가용성 — 마이크 오프 시 not_available + 사유
        "ai_record": _ai_record_block(record),
        # 신규: STT 발화자 구분 기록지 + 영상 리플레이 소스
        "transcript_segments": segments,
        "video": (
            {
                "s3_key": record.video_s3_key,
                "status": record.video_status,
            }
            if record
            else None
        ),
        "approved": False,
    }


def _client_content(session: Session, record: SessionRecord | None, eeg_block: dict) -> dict:
    return {
        "title": session.title or "내 마음 리포트",
        "session_type": session.type,
        "scheduled_at": session.scheduled_at.isoformat() if session.scheduled_at else None,
        # AI 리뷰(summary/insights) 제거 — 1차는 뇌파(EEG) 기반 분석 리포트로 재구성
        "greeting": "오늘 세션을 함께해주셔서 감사합니다.",
        "eeg": eeg_block,
        # SDD-085: 음성/AI 요약 가용성 — 마이크 오프 시 not_available + 사유
        "ai_record": _ai_record_block(record),
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
        logger.warning("[report_task] report not found: report_id=%s", report_id)
        return None
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not session:
        logger.warning(
            "[report_task] session not found: report_id=%s session_id=%s",
            report.id,
            report.session_id,
        )
        return report

    record = db.query(SessionRecord).filter(SessionRecord.session_id == session.id).first()

    # SDD-095: 리포트 생성 시작 — 진행 상태를 '처리 중'으로 반영한다.
    # (프론트 종료 화면 스텝퍼의 '리포트 완료' 스텝이 active 로 표시된다)
    report.generation_status = report_progress_service.GENERATION_PROCESSING
    db.commit()

    try:
        # SDD-088: 대기실(open) 중 수집 EEG 제외 — started_at~ended_at 구간만 집계
        eeg_block = _build_eeg_content(
            session.id,
            db,
            report.participant_id if report.type == "client" else None,
            started_at=session.started_at,
            ended_at=session.ended_at,
        )
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
        logger.exception(
            "[report_task] generate failed: report_id=%s session_id=%s participant_id=%s error=%s",
            report.id,
            session.id,
            report.participant_id,
            exc,
        )
        error_message = str(exc)
        content = {
            "headline": "리포트 생성 실패",
            "error": error_message,
            "error_message": error_message,
            "fallback": True,
        }
        # SDD-027: 분석 실패 → error 상태(신뢰도 판정 불가 — None 유지)
        report.status = "error"
        report.data_credibility = None
        # SDD-093: 리포트 생성 실패 알림 발화 — 소유자(상담사/내담자)에게 통지
        try:
            from app.services import notification_service

            if report.user_id:
                notification_service.notify_event(
                    "report_generation_failed",
                    report.user_id,
                    {
                        "title": "리포트 생성에 실패했습니다",
                        "body": f"'{session.title or '세션'}' 리포트 생성 중 오류가 발생했습니다.",
                        "extra": notification_service.build_standard_extra(
                            "report_generation_failed", "report", str(report.id),
                        ),
                    },
                    db,
                )
        except Exception:  # noqa: BLE001 — 알림 실패가 리포트 상태 반영을 막지 않도록
            pass

    # SDD-087: content 통째 교체로 기존 상담사 코멘트가 유실되지 않게 이월한다 (방어 가드)
    prev = report.content if isinstance(report.content, dict) else {}
    prev_comment = prev.get("counselor_comment")
    if isinstance(prev_comment, str) and prev_comment.strip() and "counselor_comment" not in content:
        content["counselor_comment"] = prev_comment

    report.content = content
    # SDD-095: 최종 생성 상태 — ai_record 가용(전사+요약)이면 ready, 아니면 partial.
    # 승인 게이트(report.status)와는 독립 축이다.
    report.generation_status = report_progress_service.generation_status_for_content(content, record)
    db.commit()
    db.refresh(report)
    _emit_report_progress(str(report.session_id), db)
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

    @shared_task(name="tasks.generate_reports_for_session")
    def generate_reports_for_session(session_id: str) -> None:
        """세션 종료 후 counselor+client 리포트를 생성한다 (STT/요약 완료 후 chain에서 호출)."""
        from app.core.database import SessionLocal
        from app.models.session import Session
        from app.services import report_service

        db = SessionLocal()
        try:
            s = db.query(Session).filter(Session.id == UUID(session_id)).first()
            if not s:
                return
            report_service.generate_report(str(s.id), str(s.host_id), "counselor", db)
            report_service.generate_client_reports_for_session(str(s.id), db)
            # SDD-095: 세션의 모든 리포트 생성이 끝난 뒤 최종 진행 상태를 1회 push 한다.
            # (개별 리포트 생성 중 발생한 이벤트를 최종 집계값으로 확정)
            _emit_report_progress(str(s.id), db)
        finally:
            db.close()
except Exception:  # noqa: BLE001
    pass
