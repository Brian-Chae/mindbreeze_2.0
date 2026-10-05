"""AI 리포트 서비스"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.session import Session, SessionParticipant
from app.models.client_profile import ClientProfile
from app.models.record import Report, SessionRecord
from app.models.user import User
from app.services import notification_service, record_service
from app.schemas.eeg import HRVMotionSummary


def generate_report_inline(report_id: str, db: DBSession):
    """Celery가 태스크부터 로드해도 순환 import 없이 기존 생성 함수를 호출한다."""
    from app.tasks.report_task import generate_report_inline as generate

    return generate(report_id, db)


def _to_uuid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# 하루밴드 7지표 키 (프론트 report.ts EEG_METRIC_KEYS 와 순서·이름 동일)
_EEG_METRIC_KEYS = (
    "focus_index_stability_score",
    "total_neural_activity_score",
    "cognitive_load_stability_score",
    "stress_score",
    "hemispheric_balance_score",
    "emotional_stability_score",
    "relaxation_score",
)


def _normalize_eeg(eeg) -> dict | None:
    """content.eeg 를 단일 계약으로 정규화한다.

    - 레거시 {available: bool} → status 매핑
    - not_measured 는 최소 형태로 축약 (프론트 섹션 숨김)
    - 두뇌휴식도 = relaxation_score 단일 소스를 summary_labels 로 보장
    - 7지표는 null 보존 (없는 키는 None, 0 치환 금지)
    """
    if not isinstance(eeg, dict):
        return None

    status = eeg.get("status")
    if status is None:
        avail = eeg.get("available")
        status = "valid" if avail is True else "not_measured"
    if status == "not_measured":
        return {"status": "not_measured"}

    metrics_in = eeg.get("metrics") if isinstance(eeg.get("metrics"), dict) else {}
    metrics = {k: metrics_in.get(k) for k in _EEG_METRIC_KEYS}

    labels = dict(eeg.get("summary_labels") or {})
    labels.setdefault("relaxation_score", "두뇌휴식도")

    return {
        **HRVMotionSummary.model_validate(eeg).model_dump(),
        "status": status,
        "reliability": eeg.get("reliability"),
        "drowsiness_flag": bool(eeg.get("drowsiness_flag")),
        "score": eeg.get("score"),
        "metrics": metrics,
        "summary_labels": labels,
        "timeline": eeg.get("timeline") if isinstance(eeg.get("timeline"), list) else [],
        "normalization_source": eeg.get("normalization_source", "cohort"),
        "normalization_version": eeg.get("normalization_version"),
        # SDD-045: LLM 서사(또는 규칙 폴백) 보존 — 없으면 None
        "narrative": eeg.get("narrative"),
    }


def normalize_report_content(content, report_type: str = "counselor") -> dict:
    """리포트 content 를 UI 단일 계약으로 정규화한다.

    additive·idempotent — 기존 키(headline/approved/sections 등)를 보존하면서
    summary/insights/markers/eeg 계약 필드를 보강한다. null 보존이 원칙이다.
    """
    if not isinstance(content, dict):
        return {}

    out = dict(content)  # 기존 키 보존
    # summary 는 없으면 None (하위호환: headline 은 그대로 둔다)
    out["summary"] = content.get("summary")
    # SDD-087: 상담사 코멘트 패스스루 — 문자열만 인정, 없으면 None (빈 문자열 치환 금지)
    comment = content.get("counselor_comment")
    out["counselor_comment"] = comment if isinstance(comment, str) and comment.strip() else None
    out["insights"] = out["insights"] if isinstance(out.get("insights"), list) else []
    out["markers"] = out["markers"] if isinstance(out.get("markers"), list) else []

    eeg_norm = _normalize_eeg(content.get("eeg"))
    if eeg_norm is None:
        out.pop("eeg", None)
    else:
        out["eeg"] = eeg_norm
    return out


def _counselor_name(
    session: Session | None, counselor_names: dict[UUID, str] | None = None,
) -> str | None:
    if session is None:
        return None
    # 목록은 빈 맵이어도 관계를 지연 로딩하지 않는다.
    if counselor_names is not None:
        return counselor_names.get(session.host_id)
    host = session.host
    return host.name if host else None


def _serialize(
    report: Report,
    session: Session | None = None,
    report_email: str | None = None,
    participant_info: dict | None = None,
    subjective: dict | None = None,
    counselor_names: dict[UUID, str] | None = None,
) -> dict:
    content = normalize_report_content(report.content, report.type)
    eeg = content.get("eeg")
    summary = HRVMotionSummary.model_validate(eeg if isinstance(eeg, dict) else {})
    return {
        **summary.model_dump(),
        "id": str(report.id),
        "session_id": str(report.session_id),
        # SDD-027: 게스트 리포트는 user_id 가 없다(participant_id 로 소유).
        "user_id": str(report.user_id) if report.user_id else None,
        "participant_id": str(report.participant_id) if report.participant_id else None,
        "report_email": report_email,
        "type": report.type,
        # SDD-027: 리포트 상태머신 + 데이터 신뢰도(null 보존)
        "status": report.status,
        # SDD-095: 생성 진행 상태(승인 상태와 독립 축) — 목록/홈 배지가 '생성 중'을 표시한다.
        "generation_status": report.generation_status or "pending",
        # SDD-101: 생성 실패 사유·시작 시각 — /reports 목록에서 로그로 노출
        "generation_error": report.generation_error,
        "generation_started_at": report.generation_started_at,
        "data_credibility": report.data_credibility,
        "content": content,
        # SDD-096: 셀프 체크인(주관 상태) 연계 — 내담자 리포트는 본인 슬롯(scope=participant),
        # 상담사 리포트는 세션 전체(scope=session). 미입력이면 None(치환 금지).
        "subjective_state": subjective,
        "pdf_url": report.pdf_url,
        "sent_at": report.sent_at,
        "is_read": bool(report.is_read),
        "created_at": report.created_at,
        "session_title": session.title if session else None,
        "counselor_name": _counselor_name(session, counselor_names),
        "session_type": session.type if session else None,
        "scheduled_at": session.scheduled_at if session else None,
        "participant_name": (
            participant_info.get("participant_name") if participant_info else None
        ),
        "gender": participant_info.get("gender") if participant_info else None,
        "birth_date": participant_info.get("birth_date") if participant_info else None,
        "is_guest": participant_info.get("is_guest") if participant_info else None,
    }


def _subjective_for_report(report: Report, db: DBSession) -> dict | None:
    """SDD-096: 리포트에 연계할 주관 상태 — client 리포트는 본인 슬롯, 그 외는 세션 전체."""
    if report.type == "client" and report.participant_id:
        return record_service.resolve_subjective_state(report.session_id, report.participant_id, db)
    record = (
        db.query(SessionRecord).filter(SessionRecord.session_id == report.session_id).first()
    )
    return record_service.session_subjective_state(record)


def _subjective_from_map(report: Report, records_map: dict) -> dict | None:
    """목록 직렬화용 — 배치 조회한 레코드 맵에서 파생한다(N+1 방지)."""
    record = records_map.get(report.session_id)
    if report.type == "client" and report.participant_id:
        return record_service.participant_subjective_state(record, report.participant_id)
    return record_service.session_subjective_state(record)


def _get_session_as_host(session_id: str, host_id: str, db: DBSession) -> Session:
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if s.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="host 상담사만 가능합니다")
    return s


def _get_or_create_report(db: DBSession, *, filters: dict, defaults: dict) -> Report:
    """DATA-01: 리포트 조회 후 없으면 생성하는 멱등 헬퍼.

    동시 생성 경합으로 Report 부분 유일 인덱스(uq_report_session_participant_type /
    uq_report_session_type)를 위반하면 IntegrityError 를 흡수하고 먼저 커밋된 기존
    행을 재사용한다. 생성 flush 는 SAVEPOINT(begin_nested)로 격리해 바깥 트랜잭션을
    오염시키지 않는다.
    """
    def _find() -> Report | None:
        query = db.query(Report)
        for column, value in filters.items():
            query = query.filter(getattr(Report, column) == value)
        return query.first()

    report = _find()
    if report is not None:
        return report

    report = Report(**defaults)
    try:
        with db.begin_nested():
            db.add(report)
            db.flush()
        return report
    except IntegrityError:
        # 다른 트랜잭션이 먼저 생성/커밋한 경우 — 기존 행을 재사용한다.
        existing = _find()
        if existing is None:
            raise
        return existing


def generate_report(session_id: str, host_id: str, report_type: str, db: DBSession) -> dict:
    if report_type not in ("counselor", "client"):
        raise HTTPException(status_code=400, detail="잘못된 리포트 유형")
    s = _get_session_as_host(session_id, host_id, db)

    owner_participant_id = None
    first_participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.session_id == s.id)
        .first()
    )
    if report_type == "counselor":
        owner_uuid = s.host_id
        # SDD-065: counselor 리포트도 참여자 정보(이름/성별/생년월일/회원·비회원) 표시를 위해 participant_id 설정
        if first_participant:
            owner_participant_id = first_participant.id
    else:
        if first_participant:
            # SDD-027: 게스트 내담자는 user_id 가 없다(None) — participant_id 로 소유를 보완한다.
            owner_uuid = first_participant.user_id
            owner_participant_id = first_participant.id
        else:
            owner_uuid = s.host_id

    report = _get_or_create_report(
        db,
        filters={"session_id": s.id, "type": report_type},
        defaults={
            "session_id": s.id,
            "user_id": owner_uuid,
            "participant_id": owner_participant_id,
            "type": report_type,
            # SDD-027: 상태머신 시작점 — 분석 대기(pending_analysis)
            "status": "pending_analysis",
            "content": {"status": "generating"},
        },
    )

    report = generate_report_inline(str(report.id), db) or report
    host = db.query(User).filter(User.id == s.host_id).first()
    if (
        report.status == "pending_review"
        and host is not None
        and host.role == "counselor"
        and host.auto_approve_report
    ):
        # SDD-087: 자동 승인 상담사는 초안 단계 없이 AI 코멘트를 생성해 담아 발송한다
        from app.services.report_comment_service import ensure_auto_comment

        ensure_auto_comment(report, db)
        return approve_report(str(report.id), host_id, db)
    return _serialize(report, s, subjective=_subjective_for_report(report, db))


def generate_client_reports_for_session(session_id: str, db: DBSession) -> list[dict]:
    """SDD-086: 세션의 active participant(대기열 제외)별 client 리포트를 생성한다.

    - existing 체크는 report_email_service.request_report_email 과 동일한
      (session_id, participant_id, type="client") 기준 — 멱등, 중복 생성 방지.
    - 게스트는 user_id 가 없으므로(None) participant_id 로 소유를 보완한다 (SDD-027).
    - auto_approve_report 가 켜진 상담사는 생성 직후 자동 승인한다 (기존 정책 유지).
    """
    sid = _to_uuid(session_id)
    s = db.query(Session).filter(Session.id == sid).first()
    if not s:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

    participants = (
        db.query(SessionParticipant)
        .filter(
            SessionParticipant.session_id == s.id,
            SessionParticipant.is_waitlisted.is_(False),
        )
        .all()
    )
    host = db.query(User).filter(User.id == s.host_id).first()
    auto_approve = bool(host and host.role == "counselor" and host.auto_approve_report)

    results: list[dict] = []
    for participant in participants:
        report = _get_or_create_report(
            db,
            filters={
                "session_id": s.id,
                "participant_id": participant.id,
                "type": "client",
            },
            defaults={
                "session_id": s.id,
                "user_id": participant.user_id,
                "participant_id": participant.id,
                "type": "client",
                "status": "pending_analysis",
                "content": {"status": "generating"},
            },
        )
        # 이미 승인 게이트를 지난 리포트(pending_review/completed)는 재생성하지 않는다 — 멱등.
        # 단, STT 복구 등으로 생성 상태가 partial(ai_record 미가용)인 경우엔 전사·요약을 반영해 갱신한다.
        # (그룹 세션 client 리포트는 다른 참가자 노출 방지를 위해 ai_record 를 의도적으로 제외하므로 예외.)
        needs_refresh = report.status in ("pending_analysis", "error") or (
            report.generation_status == "partial" and s.participant_mode != "group"
        )
        if needs_refresh:
            report = generate_report_inline(str(report.id), db) or report
        if report.status == "pending_review" and auto_approve:
            # SDD-087: 자동 승인 시 코멘트가 없으면 AI 초안을 생성해 저장 후 승인한다
            from app.services.report_comment_service import ensure_auto_comment

            ensure_auto_comment(report, db)
            results.append(approve_report(str(report.id), str(s.host_id), db))
        else:
            results.append(
                _serialize(report, s, subjective=_subjective_for_report(report, db))
            )
    return results


def get_auto_approve_setting(user_id: str, db: DBSession) -> dict:
    user = db.query(User).filter(User.id == _to_uuid(user_id)).first()
    return {"enabled": bool(user and user.auto_approve_report)}


def update_auto_approve_setting(user_id: str, enabled: bool, db: DBSession) -> dict:
    user = db.query(User).filter(User.id == _to_uuid(user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    user.auto_approve_report = enabled
    db.commit()
    db.refresh(user)
    return {"enabled": user.auto_approve_report}


# 리포트가 생성되어야 하는 세션 상태 — 이 상태면 리포트가 기대된다(미생성 시 목록에 '생성 실패'로 노출).
_REPORT_RELEVANT_STATUSES = ("in_progress", "completed")

# 리포트 생성 파이프라인이 아직 진행 중인지 판단할 녹음 상태(STT·요약이 이 상태면 생성 중).
_IN_FLIGHT_RECORD_STATUSES = ("recording", "processing")


def _report_generation_in_flight(record, outbox) -> bool:
    """리포트 행이 없는 세션이 아직 생성 진행 중인지 판별한다.

    - 녹음·STT·요약이 진행 중(record.status=recording/processing)이면 생성 중.
    - 발행 의도가 pending(미발행·재시도 대기)이면 생성 대기 중.
    published 는 체인 완료 후에도 남으므로 '진행 중' 신호로 쓰지 않는다
    (파이프라인 먹통 시 영구히 '생성 중'으로 오표기되는 것을 방지).
    """
    if record is not None and record.status in _IN_FLIGHT_RECORD_STATUSES:
        return True
    if outbox is not None and outbox.needs_report and outbox.status == "pending":
        return True
    return False


def _synthesize_missing_report(
    session: Session,
    report_type: str,
    *,
    user_id: UUID | None = None,
    counselor_names: dict[UUID, str] | None = None,
    generating: bool = False,
) -> dict:
    """리포트 행이 없는 세션을 목록에 노출하기 위한 합성 항목(읽기 전용, id=None).

    종료됐는데도 리포트가 없으면 '생성 실패'로 표시하되, 생성 파이프라인이 아직
    진행 중(generating=True)이면 '생성 중'으로 표시한다(비동기 STT·요약 지연을
    실패로 오인하지 않도록). 진행 중이면 '준비 중'.
    """
    completed = session.status == "completed"
    failed = completed and not generating
    return {
        "id": None,
        "session_id": str(session.id),
        "user_id": str(user_id) if user_id else None,
        "participant_id": None,
        "report_email": None,
        "type": report_type,
        # 종료됐는데 리포트가 없으면 실패, 생성 파이프라인 진행 중이면 '생성 중', 그 외 준비 중.
        "status": "error" if failed else None,
        "generation_status": "processing" if (completed and generating) else "pending",
        "generation_error": (
            "세션이 종료됐지만 리포트가 생성되지 않았습니다" if failed else None
        ),
        "generation_started_at": None,
        "data_credibility": None,
        "content": {},
        "subjective_state": None,
        "pdf_url": None,
        "sent_at": None,
        "is_read": False,
        "created_at": session.created_at,
        "session_title": session.title,
        "counselor_name": _counselor_name(session, counselor_names),
        "session_type": session.type,
        "scheduled_at": session.scheduled_at,
        "participant_name": None,
        "gender": None,
        "birth_date": None,
        "is_guest": None,
    }


def list_reports(
    user_id: str,
    db: DBSession,
    page: int | None = None,
    limit: int | None = None,
) -> dict:
    uid = _to_uuid(user_id)
    user = db.query(User).filter(User.id == uid).first()
    is_staff = bool(user and user.role in ("counselor", "org_admin"))

    # 정렬 키(활동 시각) — 세션 일정이 있으면 그 시각, 없으면 생성 시각.
    # 프론트 '최신순'(reportDateIso = scheduled_at ?? created_at)과 정합.
    activity = func.coalesce(Session.scheduled_at, Session.created_at)

    # page·limit 이 모두 주어졌을 때만 DB 레벨 창을 적용한다.
    window = page is not None and limit is not None
    offset = 0
    if page is not None and limit is not None:
        offset = (page - 1) * limit

    if is_staff:
        assert user is not None  # is_staff 가 참이면 user 는 반드시 존재
        host_ids = [uid] if user.role == "counselor" else [
            row[0] for row in db.query(User.id).filter(User.org_id == user.org_id).all()
        ]
        # 세션 LEFT JOIN 리포트 — 리포트가 있으면 리포트 행, 없지만 리포트 대상 상태면
        # 합성(미생성) 행 1개. 템플릿·비대상 상태의 무리포트 세션은 제외한다.
        # ORDER BY/LIMIT/OFFSET 을 DB 로 내려 무제한 로드·메모리 슬라이스를 제거한다.
        base = (
            db.query(
                Report.id.label("report_id"),
                Session.id.label("session_id"),
                activity.label("activity_ts"),
            )
            .select_from(Session)
            .outerjoin(Report, Report.session_id == Session.id)
            .filter(Session.host_id.in_(host_ids))
            .filter(
                or_(
                    Report.id.isnot(None),
                    and_(
                        Session.is_template.is_(False),
                        Session.status.in_(_REPORT_RELEVANT_STATUSES),
                    ),
                )
            )
        )
    else:
        # 내담자 = 본인 리포트만. 합성 노출 없음.
        base = (
            db.query(
                Report.id.label("report_id"),
                Report.session_id.label("session_id"),
                activity.label("activity_ts"),
            )
            .select_from(Report)
            .join(Session, Session.id == Report.session_id)
            .filter(Report.user_id == uid)
        )

    # 페이지네이션 total 은 별도 count 쿼리로 산출한다(창과 무관한 전체 건수).
    total = base.count()

    rows = base.order_by(activity.desc(), Report.created_at.desc())
    if window:
        rows = rows.offset(offset).limit(limit)
    rows = rows.all()

    page_report_ids = [row.report_id for row in rows if row.report_id is not None]
    page_missing_sids = [row.session_id for row in rows if row.report_id is None]

    # 한 페이지 분량의 리포트·세션을 일괄(in_) 조회해 N+1 을 제거한다.
    report_rows = (
        db.query(Report).filter(Report.id.in_(page_report_ids)).all()
        if page_report_ids else []
    )
    reports_by_id = {r.id: r for r in report_rows}
    missing_sessions = (
        db.query(Session).filter(Session.id.in_(page_missing_sids)).all()
        if page_missing_sids else []
    )
    missing_by_id = {s.id: s for s in missing_sessions}

    session_ids = {r.session_id for r in report_rows} | set(page_missing_sids)
    sessions = (
        db.query(Session).filter(Session.id.in_(session_ids)).all() if session_ids else []
    )
    sessions_map = {s.id: s for s in sessions}

    # SDD-119: 실제·합성 리포트 모두 상담사 이름을 한 번에 조회한다.
    counselor_ids = {session.host_id for session in sessions}
    counselor_names = dict(
        db.query(User.id, User.name).filter(User.id.in_(counselor_ids)).all()
    ) if counselor_ids else {}

    # 참여자 정보(이름/성별/생년월일/회원·비회원) 배치 조회
    participant_ids = {r.participant_id for r in report_rows if r.participant_id}
    participants_map = {
        participant.id: participant
        for participant in db.query(SessionParticipant)
        .filter(SessionParticipant.id.in_(participant_ids))
        .all()
    } if participant_ids else {}

    participant_user_ids = {
        participant.user_id
        for participant in participants_map.values()
        if participant.user_id
    }
    member_info_map = {
        member.id: (member, profile)
        for member, profile in db.query(User, ClientProfile)
        .outerjoin(ClientProfile, ClientProfile.user_id == User.id)
        .filter(User.id.in_(participant_user_ids))
        .all()
    } if participant_user_ids else {}

    participant_info_map = {}
    for participant_id, participant in participants_map.items():
        is_guest = participant.user_id is None
        member, profile = member_info_map.get(participant.user_id, (None, None))
        participant_info_map[participant_id] = {
            "participant_name": participant.guest_name if is_guest else (member.name if member else None),
            "gender": participant.gender if is_guest else (profile.gender if profile else None),
            "birth_date": (
                participant.birth_date if is_guest else (profile.birth_date if profile else None)
            ),
            "is_guest": is_guest,
        }

    # SDD-096: 주관 상태(셀프 체크인) — 배치 조회로 N+1 없이 파생한다.
    records_map = record_service.subjective_state_map(
        {report.session_id for report in report_rows}, db
    )

    # 합성 대상(미생성) 세션의 기록·아웃박스도 배치로 조회한다(생성 진행 판정용).
    missing_records_map: dict = {}
    outboxes_map: dict = {}
    if page_missing_sids:
        from app.models.pipeline_outbox import PipelineOutbox

        missing_records_map = {
            r.session_id: r
            for r in db.query(SessionRecord)
            .filter(SessionRecord.session_id.in_(page_missing_sids))
            .all()
        }
        outboxes_map = {
            o.session_id: o
            for o in db.query(PipelineOutbox)
            .filter(PipelineOutbox.session_id.in_(page_missing_sids))
            .all()
        }

    # DB 정렬 순서를 그대로 보존해 직렬화한다(추가 메모리 정렬 불필요).
    result: list[dict] = []
    for row in rows:
        if row.report_id is not None:
            report = reports_by_id.get(row.report_id)
            if report is None:
                continue
            result.append(
                _serialize(
                    report,
                    sessions_map.get(report.session_id),
                    participant_info=participant_info_map.get(report.participant_id),
                    subjective=_subjective_from_map(report, records_map),
                    counselor_names=counselor_names,
                )
            )
        else:
            session = missing_by_id.get(row.session_id)
            if session is None:
                continue
            generating = _report_generation_in_flight(
                missing_records_map.get(session.id), outboxes_map.get(session.id)
            )
            result.append(
                _synthesize_missing_report(
                    session, "counselor", user_id=session.host_id,
                    counselor_names=counselor_names, generating=generating,
                )
            )

    response = {"reports": result, "total": total}
    if window:
        response.update({"page": page, "limit": limit})
    return response


def get_report(report_id: str, user_id: str, db: DBSession) -> dict:
    rid = _to_uuid(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not _can_access_report(user_id, session, db):
        raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    # counselor 리포트(상담사 내부 메모 포함)는 내담자(client) 접근 차단 — defense in depth
    if report.type == "counselor":
        viewer = db.query(User).filter(User.id == _to_uuid(user_id)).first()
        if viewer and viewer.role == "client":
            raise HTTPException(status_code=403, detail="접근 권한이 없습니다")
    participant = (
        db.query(SessionParticipant)
        .filter(SessionParticipant.id == report.participant_id)
        .first()
        if report.participant_id
        else None
    )
    result = _serialize(
        report,
        session,
        participant.report_email if participant else None,
        subjective=_subjective_for_report(report, db),
    )
    # SDD-087: counselor 리포트 상세에는 같은 세션 client 리포트들의 코멘트를 파생 표시한다
    # (원본은 client 리포트에만 저장 — 저장하지 않고 조회 시 주입).
    if report.type == "counselor":
        result["content"]["client_comments"] = _collect_client_comments(report.session_id, db)
    return result


def _collect_client_comments(session_id, db: DBSession) -> list[dict]:
    """세션의 client 리포트별 상담사 코멘트 목록 — [{participant_id, participant_name, comment}]."""
    client_reports = (
        db.query(Report)
        .filter(Report.session_id == session_id, Report.type == "client")
        .all()
    )
    comments: list[dict] = []
    for cr in client_reports:
        content = cr.content if isinstance(cr.content, dict) else {}
        comment = content.get("counselor_comment")
        if not (isinstance(comment, str) and comment.strip()):
            continue
        name = None
        if cr.participant_id:
            participant = (
                db.query(SessionParticipant)
                .filter(SessionParticipant.id == cr.participant_id)
                .first()
            )
            if participant:
                if participant.user_id:
                    user = db.query(User).filter(User.id == participant.user_id).first()
                    name = user.name if user else None
                else:
                    name = participant.guest_name
        comments.append(
            {
                "participant_id": str(cr.participant_id) if cr.participant_id else None,
                "participant_name": name,
                "comment": comment,
            }
        )
    return comments


def _can_access_report(user_id: str, session, db: DBSession) -> bool:
    """사용자가 리포트 세션에 접근 가능한지 (본인 세션 host / 기관 관리자 / 참여 내담자)."""
    uid = _to_uuid(user_id)
    if session and session.host_id == uid:
        return True
    user = db.query(User).filter(User.id == uid).first()
    if user and user.role == "org_admin" and user.org_id and session:
        host = db.query(User).filter(User.id == session.host_id).first()
        return bool(host and host.org_id == user.org_id)
    # 내담자(client): 자신이 참여한 세션의 리포트는 열람 가능
    if session:
        is_participant = (
            db.query(SessionParticipant)
            .filter(
                SessionParticipant.session_id == session.id,
                SessionParticipant.user_id == uid,
            )
            .first()
        )
        if is_participant is not None:
            return True
    return False


def require_report_host(report_id: str, host_id: str, db: DBSession) -> None:
    """리포트가 현재 상담사의 세션에 속하는지 확인한다. (org_admin은 소속 기관 세션 허용)"""
    rid = _to_uuid(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not _can_access_report(host_id, session, db):
        raise HTTPException(status_code=403, detail="host 상담사만 가능합니다")


def update_report(report_id: str, host_id: str, payload, db: DBSession) -> dict:
    rid = _to_uuid(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not _can_access_report(host_id, session, db):
        raise HTTPException(status_code=403, detail="host 상담사만 수정 가능합니다")

    if payload.content is not None:
        report.content = payload.content
    db.commit()
    db.refresh(report)
    return _serialize(report, session, subjective=_subjective_for_report(report, db))


def approve_report(report_id: str, host_id: str, db: DBSession) -> dict:
    rid = _to_uuid(report_id)
    report = db.query(Report).filter(Report.id == rid).first()
    if not report:
        raise HTTPException(status_code=404, detail="리포트를 찾을 수 없습니다")
    session = db.query(Session).filter(Session.id == report.session_id).first()
    if not session or session.host_id != _to_uuid(host_id):
        raise HTTPException(status_code=403, detail="host 상담사만 승인 가능합니다")

    # SDD-027: 승인 게이트 = pending_review → completed. 이미 completed 면 멱등 처리.
    # 분석 미완/실패(pending_analysis/error) 상태는 승인할 수 없다.
    if report.status not in ("pending_review", "completed"):
        raise HTTPException(status_code=400, detail="검토 대기 상태의 리포트만 승인할 수 있습니다")

    already_completed = report.status == "completed"
    report.status = "completed"
    report.sent_at = report.sent_at or _now()
    content = dict(report.content or {})
    content["approved"] = True
    report.content = content

    # F10 알림 이벤트 — 게스트(user_id 없음)는 알림 대상이 아니며, 중복 승인 시 재발송하지 않는다.
    if report.user_id is not None and not already_completed:
        try:
            notification_service.notify_event(
                "report_ready",
                report.user_id,
                {
                    "title": "리포트가 도착했습니다",
                    "body": "세션 리포트가 승인되었습니다",
                    "extra": notification_service.build_standard_extra(
                        "report_ready",
                        "report",
                        str(report.id),
                        params={"session_id": str(report.session_id)},
                        legacy={"report_id": str(report.id), "session_id": str(report.session_id)},
                    ),
                },
                db,
            )
        except Exception:  # noqa: BLE001
            pass

    db.commit()
    db.refresh(report)
    # SDD-066: 수동/자동 승인 모두 메일을 예약하지 않는다. 발송은 별도 요청으로 처리한다.
    return _serialize(report, session, subjective=_subjective_for_report(report, db))
