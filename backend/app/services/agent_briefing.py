"""SDD-189: 상담사 브리핑 빌더 + 스윕 — 아침 일정 브리핑 · 저녁 상담 정리.

원칙(기획 §3.5)은 내담자 채널과 같다: **사실은 DB 값 템플릿**이고 LLM 은 건별 서술
보조만 한다. 키가 없거나 호출이 실패하면 템플릿만으로 완결된 브리핑이 나온다.

상담사 브리핑에 담지 않는 것 (기획 §1.2-6 · SDD-189 Acceptance)
- 장소·주소·길찾기: 상담사는 자기 상담실을 안내받을 필요가 없다.
- 내담자 연락처: 알림 본문으로 연락처를 흘리지 않는다.
- 진단·점수 표현: `agent_guard` 로 저장 직전 한 번 더 걸러낸다.

담는 것
- 내담자 **실명**(D12) · 회차 · 온라인/오프라인 · 리포트 상태 · 내담자 확인 여부
- 내담자 피드백은 **원문 그대로**(D10 — 요약·순화 금지)

발송 시각 규칙: 상담사가 지정한 KST 시각이 도래하면 그 시점부터 **30분까지** 보정
발송을 시도한다(서버 중단 복구). 멱등은 `agent_briefing_logs` UNIQUE 가 보장한다.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.models.agent import AgentBriefingLog
from app.models.user import User
from app.services import agent_counselor_service, agent_guard, agent_llm, agent_policy, agent_service

logger = logging.getLogger(__name__)

KST = agent_policy.KST

# 지정 시각 이후 보정 발송을 허용하는 폭(분). 이 창을 넘기면 그날은 보내지 않는다(TS3).
CATCHUP_WINDOW_MIN = 30

# 한 번의 스윕에서 검사할 상담사 수 상한.
SWEEP_LIMIT = 500

# 메시지 kind — Contract(AgentMessageKind) 확장분.
KIND_MORNING = "briefing_morning"
KIND_EVENING = "briefing_evening"
BRIEFING_KINDS: dict[str, str] = {"morning": KIND_MORNING, "evening": KIND_EVENING}

NO_SESSION_MORNING = "오늘 일정이 없어요. 여유 있게 보내세요."
NO_SESSION_EVENING = "오늘은 진행한 상담이 없어요. 내일 일정도 비어 있어요."

RELAY_KIND_LABELS = agent_policy.RELAY_KIND_LABELS

FEEDBACK_CHOICE_LABELS = agent_service.FEEDBACK_CHOICE_LABELS


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# 공통 본문 조각
# ---------------------------------------------------------------------------


def _session_headline(item: dict) -> str:
    """세션 한 줄 — 시각 / 내담자 실명(회차) / 유형 / 온라인·오프라인. 장소·연락처 없음."""
    clients = item.get("clients") or []
    names = ", ".join(f"{c['name']} {c['ordinal']}회차" for c in clients) or "참여자 미지정"
    line = f"{item['time_text']} {names} / {item['type_label']} / {item['location_label']}"
    if item.get("linkband_mode") == "required":
        line += " / LINK BAND 필수"
    return line


def _report_note(item: dict) -> str | None:
    """세션에 걸린 내담자 리포트 상태 한 줄 — 상태 라벨만(본문은 담지 않는다)."""
    labels = [
        f"{c['name']} {c['report']['status_label']}"
        for c in (item.get("clients") or [])
        if c.get("report")
    ]
    return f"리포트: {', '.join(labels)}" if labels else None


def _remaining_topic_candidates(record: dict) -> list[str]:
    """남은 주제 후보 — 요약 키워드 중 섹션 본문에 등장하지 않은 것.

    LLM 추론이 아니라 상담사 본인 기록에서 뽑은 **DB 파생값**이다. 다룬 내용(섹션)에
    언급이 없는 키워드만 남기므로 "아직 못 다룬 이야기" 후보로 쓸 수 있다.
    """
    sections_text = " ".join((record.get("sections") or {}).values())
    return [kw for kw in (record.get("keywords") or []) if kw not in sections_text]


# ---------------------------------------------------------------------------
# 아침 일정 브리핑
# ---------------------------------------------------------------------------


def build_morning_content(context: dict, db: DBSession) -> str:
    """아침 브리핑 본문 — 오늘 일정·건별 한 줄·승인 대기 리포트·미확인 예약·변경 문의."""
    sessions = context.get("today") or []
    active = [s for s in sessions if not s.get("is_cancelled")]
    cancelled = [s for s in sessions if s.get("is_cancelled")]

    if not sessions:
        lines = [NO_SESSION_MORNING]
    else:
        lines = [f"오늘 상담 {len(active)}건이 있어요."]
        for item in active:
            lines.append("")
            lines.append(f"· {_session_headline(item)}")
            # 건별 한 줄 — 직전 회차에서 다룬 이야기(상담사 본인 기록 기반).
            for client in item.get("clients") or []:
                previous = client.get("previous_summary")
                if previous and previous.get("headline"):
                    lines.append(f"  지난 회차: {previous['headline']}")
            note = _report_note(item)
            if note:
                lines.append(f"  {note}")
        for item in cancelled:
            lines.append("")
            lines.append(f"· {_session_headline(item)} — 취소됨")

    # 아직 "확인했어요" 를 누르지 않은 내담자 — 사전 연락 판단에 쓰인다.
    unacked = [
        f"{c['name']}({item['time_text']})"
        for item in active
        for c in item.get("clients") or []
        if not c.get("acked")
    ]
    if unacked:
        lines.append("")
        lines.append(f"· 예약 안내를 아직 확인하지 않은 내담자: {', '.join(unacked)}")

    pending = context.get("pending_reports") or []
    if pending:
        lines.append("")
        lines.append(f"· 승인 대기 리포트 {len(pending)}건")
        for item in pending:
            lines.append(f"  - {item['client_name']} / {item['scheduled_text']} {item['type_label']}")

    changes = [
        event
        for event in (context.get("relay_events") or [])
        if event["kind"] == "schedule_change_request"
    ]
    if changes:
        lines.append("")
        lines.append(f"· 일정 변경 문의 {len(changes)}건")
        for event in changes:
            reason = (event.get("payload") or {}).get("reason")
            # 사유는 상담사가 판단해야 하므로 원문 그대로 옮긴다.
            lines.append(
                f"  - {event['client_name']}: {reason}" if reason else f"  - {event['client_name']}"
            )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 저녁 상담 정리
# ---------------------------------------------------------------------------


def build_evening_content(context: dict, db: DBSession) -> str:
    """저녁 정리 본문 — 오늘 진행 상담별 정리·불참/취소·리포트 상태·피드백·내일 일정."""
    sessions = context.get("today") or []
    conducted = [
        s
        for s in sessions
        if not s.get("is_cancelled") and s.get("status") in agent_policy.CONDUCTED_STATUSES
    ]
    cancelled = [s for s in sessions if s.get("is_cancelled")]
    tomorrow = context.get("tomorrow") or []

    if not conducted and not cancelled and not tomorrow:
        lines = [NO_SESSION_EVENING]
    elif not conducted:
        lines = ["오늘 진행한 상담은 없어요."]
    else:
        lines = [f"오늘 진행한 상담 {len(conducted)}건을 정리했어요."]
        for item in conducted:
            lines.append("")
            lines.append(f"· {_session_headline(item)}")
            record = item.get("record") or {}
            if record.get("has_summary"):
                if record.get("headline"):
                    lines.append(f"  다룬 이야기: {record['headline']}")
                for key, value in (record.get("sections") or {}).items():
                    lines.append(f"  {key}: {value}")
                candidates = _remaining_topic_candidates(record)
                if candidates:
                    lines.append(f"  남은 주제 후보: {', '.join(candidates)}")
            else:
                # 마이크 오프·미진행 등으로 요약이 없으면 비워 두지 않고 사실만 적는다.
                lines.append("  기록 없음")
            note = _report_note(item)
            if note:
                lines.append(f"  {note}")

    # 불참 — 별도 no-show 필드가 없어 참여 행의 joined_at 유무로 판단한다.
    absent = [
        f"{c['name']}({item['time_text']})"
        for item in conducted
        for c in item.get("clients") or []
        if not c.get("attended")
    ]
    if absent:
        lines.append("")
        lines.append(f"· 참석 기록이 없는 내담자: {', '.join(absent)}")

    if cancelled:
        lines.append("")
        lines.append(f"· 취소된 상담 {len(cancelled)}건")
        for item in cancelled:
            lines.append(f"  - {_session_headline(item)}")

    pending = context.get("pending_reports") or []
    if pending:
        lines.append("")
        lines.append(f"· 승인 대기 리포트 {len(pending)}건")
        for item in pending:
            lines.append(f"  - {item['client_name']} / {item['scheduled_text']} {item['type_label']}")

    feedbacks = [
        event for event in (context.get("relay_events") or []) if event["kind"] == "feedback"
    ]
    if feedbacks:
        lines.append("")
        lines.append(f"· 내담자 피드백 {len(feedbacks)}건")
        for event in feedbacks:
            payload = event.get("payload") or {}
            choice = FEEDBACK_CHOICE_LABELS.get(payload.get("choice"), "응답")
            lines.append(f"  - {event['client_name']}: {choice}")
            # D10: 자유 서술은 원문 그대로 보여준다(요약·순화 금지).
            for text in payload.get("texts") or []:
                lines.append(f"    “{text}”")

    if tomorrow:
        active_tomorrow = [s for s in tomorrow if not s.get("is_cancelled")]
        lines.append("")
        lines.append(f"· 내일 일정 {len(active_tomorrow)}건")
        for item in active_tomorrow:
            lines.append(f"  - {_session_headline(item)}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# LLM 보조 — 사실 템플릿 뒤에 서술 한 줄만 덧붙인다
# ---------------------------------------------------------------------------


def _with_llm_note(context: dict, template: str, kind: str) -> str:
    """템플릿 브리핑에 LLM 서술 한 줄을 덧붙인다 — 키 없음·실패 시 템플릿 그대로.

    LLM 이 사실을 만들지 못하도록 **덧붙이는 문장만** 생성하게 하고, 템플릿 본문은
    절대 바꾸지 않는다. 생성 결과도 `agent_guard` 를 통과해야 붙는다.
    """
    if not agent_llm.is_enabled():
        return template

    task = (
        "아래 [허용 자료] 기준으로 상담사에게 오늘 흐름을 1문장으로만 짚어 주세요. "
        "숫자 점수·진단·병명은 쓰지 마세요. 장소·주소·연락처는 언급하지 마세요. "
        "새로운 사실을 만들지 말고 자료에 있는 것만 쓰세요."
        if kind == "morning"
        else
        "아래 [허용 자료] 기준으로 오늘 상담 흐름에서 눈여겨볼 점을 1문장으로만 짚어 주세요. "
        "숫자 점수·진단·병명은 쓰지 마세요. 새로운 사실을 만들지 말고 자료에 있는 것만 쓰세요."
    )
    prompt = agent_llm.build_prompt(
        agent_policy.counselor_context_to_text(context), task=task
    )
    # 실패하면 빈 문자열이 돌아오도록 fallback 을 비워 둔다 — 덧붙일 문장이 없을 뿐이다.
    try:
        note = agent_llm.generate(prompt, "").strip()
    except Exception:  # noqa: BLE001 — 서술 보조 실패가 브리핑 생성을 막지 않는다
        logger.warning("[agent_briefing] LLM 서술 보조 실패 — 템플릿만 사용")
        return template
    if not note:
        return template
    return f"{template}\n\n{note}"


def build_content(context: dict, kind: str, db: DBSession) -> str:
    """브리핑 본문 — 템플릿 + (가능하면) LLM 서술 한 줄, 마지막에 가드 적용."""
    template = (
        build_morning_content(context, db)
        if kind == "morning"
        else build_evening_content(context, db)
    )
    text = _with_llm_note(context, template, kind)
    # 진단·점수 표현이 섞이면 그 문장만 버린다. 전부 걸러지면 템플릿으로 되돌린다.
    return agent_guard.sanitize(text, fallback=template)


def build_ctas(context: dict, kind: str) -> list[dict]:
    """브리핑 CTA — 모두 화면 이동용(서버 상태 변경 없음)."""
    ctas: list[dict] = [
        {
            "id": "open_schedule",
            "action": "open_schedule",
            "label": "일정 보기",
            "payload": {"url": "/sessions"},
        }
    ]

    sessions = context.get("today") or []
    first_record = next(
        (
            s
            for s in sessions
            if (s.get("record") or {}).get("has_summary") and kind == "evening"
        ),
        None,
    )
    if first_record is not None:
        ctas.append({
            "id": "open_record",
            "action": "open_record",
            "label": "세션 기록 보기",
            "payload": {
                "session_id": first_record["session_id"],
                "record_id": first_record["session_id"],
                "url": f"/sessions/{first_record['session_id']}",
            },
        })

    pending = context.get("pending_reports") or []
    if pending:
        ctas.append({
            "id": "open_report",
            "action": "open_report",
            "label": f"승인 대기 리포트 {len(pending)}건",
            "payload": {
                "report_id": pending[0]["report_id"],
                "url": f"/reports/{pending[0]['report_id']}",
            },
        })

    changes = [
        event
        for event in (context.get("relay_events") or [])
        if event["kind"] == "schedule_change_request"
    ]
    if changes:
        ctas.append({
            "id": "open_change_requests",
            "action": "open_change_requests",
            "label": f"일정 변경 문의 {len(changes)}건",
            "payload": {"url": "/agent?tab=relay"},
        })

    first_client = next(
        (
            (c["client_id"], c["name"])
            for s in sessions
            for c in (s.get("clients") or [])
        ),
        None,
    )
    if first_client is not None:
        ctas.append({
            "id": "open_client",
            "action": "open_client",
            "label": "내담자 상세",
            "payload": {
                "client_id": first_client[0],
                "url": f"/clients/{first_client[0]}",
            },
        })
    return ctas


# ---------------------------------------------------------------------------
# 발송 시각 판정 · 멱등 로그
# ---------------------------------------------------------------------------


def is_due(now: datetime, time_str: str) -> bool:
    """지정 시각(KST)이 도래했고 보정 창(30분) 안인지 — 그 외는 False(TS3)."""
    if not agent_counselor_service.is_valid_time(time_str):
        return False
    kst_now = now.astimezone(KST)
    hour, minute = agent_counselor_service.parse_time(time_str)
    target = kst_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    elapsed_min = (kst_now - target).total_seconds() / 60.0
    return 0 <= elapsed_min <= CATCHUP_WINDOW_MIN


def claim_briefing(
    db: DBSession, user_id: UUID, kind: str, briefing_date: date
) -> AgentBriefingLog | None:
    """브리핑 로그를 원자적으로 선점한다 — None 이면 이미 보냈다(멱등, TS2)."""
    log = AgentBriefingLog(user_id=user_id, kind=kind, briefing_date=briefing_date)
    try:
        with db.begin_nested():
            db.add(log)
        db.flush()
        return log
    except IntegrityError:
        logger.info(
            "[agent_briefing] 이미 발송됨 (user=%s, kind=%s, date=%s)", user_id, kind, briefing_date
        )
        return None


def should_skip(context: dict, kind: str, settings) -> bool:
    """일정 없는 날 건너뛰기 판정 — 설정이 꺼져 있으면 "일정 없음" 메시지를 보낸다(TS4)."""
    if not settings.skip_no_session_days:
        return False
    if kind == "morning":
        return not (context.get("today") or [])
    # 저녁은 오늘 진행 세션이 없고 내일도 비어 있을 때만 건너뛴다.
    conducted = [
        s
        for s in (context.get("today") or [])
        if not s.get("is_cancelled") and s.get("status") in agent_policy.CONDUCTED_STATUSES
    ]
    return not conducted and not (context.get("tomorrow") or [])


def send_briefing(
    db: DBSession, counselor_id: UUID, kind: str, briefing_date: date
) -> bool:
    """브리핑 1건 생성 — 선점에 성공한 실행만 메시지를 만든다."""
    context = agent_policy.counselor_context(counselor_id, db, briefing_date)
    settings = agent_counselor_service.get_settings(db, counselor_id)
    if should_skip(context, kind, settings):
        return False

    log = claim_briefing(db, counselor_id, kind, briefing_date)
    if log is None:
        return False

    message = agent_service.post_agent_message(
        db,
        counselor_id,
        kind=BRIEFING_KINDS[kind],
        content=build_content(context, kind, db),
        cta=build_ctas(context, kind),
        channel=agent_service.CHANNEL_COUNSELOR,
        push_body=agent_service.PUSH_BODY_BRIEFING,
        commit=False,
    )
    log.message_id = message.id
    db.commit()
    return True


# ---------------------------------------------------------------------------
# 스윕 (매 1분 cron 진입점이 호출)
# ---------------------------------------------------------------------------


def sweep(db: DBSession, *, now: datetime | None = None, limit: int = SWEEP_LIMIT) -> dict:
    """상담사 브리핑 스윕 1회 — 설정 시각이 도래한 상담사에게 아침/저녁 브리핑을 만든다.

    설정 행이 없는 상담사는 기본값(08:00/21:00)으로 동작하며 조회 시 행이 생성된다.
    """
    now = now or _now()
    briefing_date = now.astimezone(KST).date()

    counselors = (
        db.query(User)
        .filter(User.role == "counselor", User.status == "active")
        .order_by(User.created_at.asc())
        .limit(limit)
        .all()
    )

    scanned = sent = skipped = 0
    for counselor in counselors:
        settings = agent_counselor_service.get_settings(db, counselor.id)
        for kind in ("morning", "evening"):
            enabled = settings.morning_enabled if kind == "morning" else settings.evening_enabled
            time_str = settings.morning_time if kind == "morning" else settings.evening_time
            if not enabled or not is_due(now, time_str):
                continue
            scanned += 1
            try:
                if send_briefing(db, counselor.id, kind, briefing_date):
                    sent += 1
                else:
                    skipped += 1
            except Exception:  # noqa: BLE001 — 한 건 실패가 스윕 전체를 멈추지 않는다
                db.rollback()
                logger.exception(
                    "[agent_briefing] 브리핑 생성 실패 (user=%s, kind=%s)", counselor.id, kind
                )

    summary = {"scanned": scanned, "sent": sent, "skipped": skipped}
    if sent:
        logger.info("[agent_briefing] %s", summary)
    return summary
