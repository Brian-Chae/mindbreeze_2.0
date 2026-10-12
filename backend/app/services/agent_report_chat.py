"""SDD-188: 리포트 승인 → AI 비서 리포트 대화 시작.

트리거는 "상담사 승인·발송 완료"다(`Report.status == "completed"`). 승인 전
(`pending_review`)에는 아무것도 만들지 않는다 — 내담자에게 아직 발송되지 않은 본문이기 때문.

제외 대상 (기획 §3.3)
- 그룹 세션 리포트: 타 참가자 정보 노출 위험
- 게스트 리포트(`user_id` 없음): 계정이 없어 대화방이 없다
- `type != "client"` 리포트: 상담사용 리포트는 내담자 채널 대상이 아니다

리포트 본문 인용은 `agent_policy.report_facts` 만 거친다. 본문이 비어 있으면 인용 없이
링크만 보낸다(빈 본문을 인용하지 않는다).
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session as DBSession

from app.models.record import Report
from app.models.session import Session
from app.models.user import User
from app.services import agent_llm, agent_policy, agent_service

logger = logging.getLogger(__name__)

# 발송 로그 kind — ref_id = report_id, offset_min = 0 (리포트당 1회)
DELIVERY_KIND = "report_ready"

# 인용할 본문이 없을 때 쓰는 열린 질문
DEFAULT_OPEN_QUESTION = "리포트를 읽어 보시고, 가장 마음에 남는 부분을 들려주실 수 있을까요?"


def on_report_approved(report: Report, db: DBSession) -> bool:
    """리포트 승인 직후 호출 — 내담자 대화에 리포트 링크 메시지를 1회 만든다.

    승인 트랜잭션을 깨지 않도록 이 함수는 예외를 밖으로 던지지 않는다.
    반환 True = 메시지를 새로 만들었음.
    """
    try:
        return _create_report_message(report, db)
    except Exception:  # noqa: BLE001 — 승인 흐름 보호
        logger.exception(
            "[agent_report_chat] 리포트 대화 시작 실패: report_id=%s", getattr(report, "id", None)
        )
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return False


def _create_report_message(report: Report, db: DBSession) -> bool:
    if report is None:
        return False
    if report.type != "client":
        return False
    if report.user_id is None:
        return False
    if report.status != "completed":
        return False

    session = db.get(Session, report.session_id)
    if session is None:
        return False
    # 그룹 세션 리포트는 제외한다.
    if session.participant_mode == "group":
        return False

    user = db.get(User, report.user_id)
    if user is None or user.role != "client" or user.status != "active":
        return False

    # 리포트 재생성·재승인에도 메시지는 1건만 (report_id 기준 로그).
    claimed = agent_service.claim_delivery(
        db,
        kind=DELIVERY_KIND,
        ref_id=report.id,
        offset_min=0,
        user_id=report.user_id,
        payload={"session_id": str(report.session_id)},
    )
    if not claimed:
        return False

    facts = agent_policy.report_facts(report, db)
    content = build_report_ready_content(facts)
    agent_service.post_agent_message(
        db,
        report.user_id,
        kind="report_ready",
        content=content,
        cta=agent_service.build_report_ctas(str(report.id)),
        ref_type="report",
        ref_id=report.id,
        commit=True,
    )
    logger.info(
        "[agent_report_chat] 리포트 대화 시작 (report_id=%s, user_id=%s)", report.id, report.user_id
    )
    return True


def build_report_ready_content(facts: dict) -> str:
    """리포트 도착 안내 본문 — 사실 문장 + 본문 인용(있을 때) + 열린 질문.

    사실(일시·상담사)은 DB 값이고, 열린 질문만 LLM(실패 시 템플릿)이 만든다.
    """
    lines = [
        f"{facts['scheduled_text']} {facts['type_label']} 리포트가 도착했어요. "
        f"{facts['counselor_name']} 선생님이 확인해 주신 내용이에요.",
    ]

    quotes = agent_policy.report_quotes(facts)
    if quotes:
        lines.append("")
        for quote in quotes:
            lines.append(f"“{quote}”")

    lines.append("")
    lines.append(_open_question(facts, quotes))
    lines.append("")
    lines.append("읽어 보신 소감도 아래에서 가볍게 알려 주세요.")
    return "\n".join(lines)


def _open_question(facts: dict, quotes: list[str]) -> str:
    """리포트 본문을 근거로 한 열린 질문. 인용이 없으면 템플릿 질문을 쓴다."""
    if not quotes:
        return DEFAULT_OPEN_QUESTION

    context_text = agent_policy.context_to_text({"sessions": [], "reports": [facts]})
    task = (
        "위 리포트 본문을 근거로, 내담자가 자기 경험을 떠올려 이야기하도록 돕는 "
        "열린 질문을 **한 문장만** 만드세요. 새로운 해석·평가·조언을 넣지 않습니다."
    )
    prompt = agent_llm.build_prompt(context_text, task=task)
    return agent_llm.generate(prompt, DEFAULT_OPEN_QUESTION)
