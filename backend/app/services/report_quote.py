"""SDD-318 F-C: 리포트 content.quote — 회원 본인 경험을 담은 인용 한 줄.

- 계약: content["quote"] 는 문자열(1인칭 해요체 한 문장, 40자 내외) 또는 None. DB 컬럼 없이 content JSON 에만 둔다.
- 근거: 녹음 전사(STT)가 있으면 회원 발화에서 가장 가까운 한 문장, 없으면 코치 코멘트에 근거한 한 문장.
  근거가 부족하면 LLM 을 부르지 않고 None.
- 가드: 마이크 오프(manual)·저신뢰·STT 비활성·그룹 세션·리포트 제외 참가자는 전사를 쓰지 않는다.
- 후처리 필터: 점수·종합점수·좋음·나쁨·완료(단정)·보증·100% 및 의료 단정 표현이 있으면 버린다.
- 실패 내성: LLM 오류·AI off 는 None 으로 흡수하며 리포트 생성을 막지 않는다.
"""

import json
import logging
import re

logger = logging.getLogger(__name__)

QUOTE_MAX_LENGTH = 60  # 목표 40자 내외, 초과 허용 상한
TRANSCRIPT_MAX_CHARS = 6000

QUOTE_FORBIDDEN_TERMS = (
    "점수", "종합점수", "스코어", "좋음", "나쁨", "완료", "보증", "100%", "100％",
    "진단", "치료", "완치", "처방", "우울증", "불안장애", "공황", "질환", "장애",
)

_QUOTE_CHARS = "\"'“”‘’「」『』`"
_SENTENCE_END = re.compile(r"[.!?。！？]")


def sanitize_quote(raw: object) -> str | None:
    """LLM/입력 값을 계약에 맞는 quote 로 정규화한다. 부적합하면 None (빈 문자열 치환 금지)."""
    if not isinstance(raw, str):
        return None
    text = raw.strip().strip(_QUOTE_CHARS).strip()
    if not text or len(text) > QUOTE_MAX_LENGTH:
        return None
    # 한 문장만 허용 — 문장 부호가 끝 이외에 있으면(여러 문장) 거부
    body = text.rstrip(".!?。！？ ").strip()
    if not body or _SENTENCE_END.search(body):
        return None
    if "\n" in body:
        return None
    # 해요체 종결(…요)만 허용
    if not body.endswith("요"):
        return None
    if any(term in body for term in QUOTE_FORBIDDEN_TERMS):
        return None
    return body + "."


def parse_quote(raw_json: object) -> str | None:
    """LLM 응답(JSON 문자열 또는 dict)에서 quote 를 읽는다. 키 없음·null·형식 오류는 None."""
    data = raw_json
    if isinstance(raw_json, str):
        try:
            data = json.loads(raw_json)
        except (ValueError, TypeError):
            return None
    if not isinstance(data, dict):
        return None
    return sanitize_quote(data.get("quote"))


def _usable_transcript(record) -> str | None:
    """STT 전사 사용 가능 여부 가드. 마이크 오프·저신뢰·STT off·빈 전사는 None."""
    from app.core.ai_features import is_stt_enabled

    if record is None or record.status == "manual":
        return None
    summary = record.ai_summary if isinstance(record.ai_summary, dict) else {}
    if summary.get("transcript_confidence") == "low":
        return None
    if not is_stt_enabled():
        return None
    transcript = record.transcript
    if not isinstance(transcript, str) or not transcript.strip():
        return None
    return transcript.strip()[:TRANSCRIPT_MAX_CHARS]


def build_prompt(transcript: str | None, counselor_comment: str | None) -> str:
    sources: list[str] = []
    if transcript:
        sources.append(f"[녹음 전사]\n{transcript}")
    if counselor_comment:
        sources.append(f"[코치 코멘트]\n{counselor_comment}")
    body = "\n\n".join(sources)
    return (
        "다음 자료에서 회원 본인의 경험을 1인칭 해요체 한 문장(40자 내외)으로 뽑아 주세요.\n"
        "규칙:\n"
        "- 녹음 전사가 있으면 회원 발화에서 가장 가까운 한 문장을 다듬어 쓰고, 원문을 왜곡하거나 없는 사실을 지어내지 마세요.\n"
        "- 자료에 없는 감정·사건·측정 결과를 만들지 마세요. 코치의 말을 회원의 말처럼 옮기지 마세요.\n"
        "- 점수·종합점수·좋음·나쁨·완료·보증·100% 같은 표현과 진단·치료 등 의료 단정 표현은 쓰지 마세요.\n"
        "- 근거가 부족하면 quote 를 null 로 하세요.\n"
        '- 반드시 {"quote": "문장"} 또는 {"quote": null} JSON 으로만 응답하세요.\n\n'
        f"{body}"
    )


def generate_quote(record, counselor_comment: str | None) -> str | None:
    """근거 수집 → LLM 호출 → 검수. 근거 없음·AI off·오류는 모두 None."""
    transcript = _usable_transcript(record)
    comment = counselor_comment.strip() if isinstance(counselor_comment, str) and counselor_comment.strip() else None
    if not transcript and not comment:
        return None  # 근거 부족 — LLM 호출 0건
    try:
        from app.tasks.summary_task import _call_gemini_text

        raw = _call_gemini_text(build_prompt(transcript, comment), json_mode=True, timeout=30)
        return parse_quote(raw)
    except Exception:  # noqa: BLE001 — 인용 생성 실패가 리포트 생성을 막지 않는다.
        logger.warning("[report_quote] 인용 생성 실패 — quote=None")
        return None


def attach_quote(content: dict, session, record, previous_content: object, *, excluded: bool = False) -> None:
    """content["quote"] 를 항상 채운다(문자열 또는 None). 제외·그룹·실패 스텁은 None."""
    group = getattr(session, "participant_mode", None) == "group"
    stub = bool(content.get("fallback")) or bool(content.get("error"))
    if excluded or group or stub:
        content["quote"] = None
        return
    prev = previous_content if isinstance(previous_content, dict) else {}
    comment = content.get("counselor_comment") or prev.get("counselor_comment")
    content["quote"] = generate_quote(record, comment)
