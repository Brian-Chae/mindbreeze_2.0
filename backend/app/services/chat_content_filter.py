"""채팅 게시 필터 — [MB261026][FIX] Apple 1.2 "부적절 콘텐츠 필터 방법".

- 운영자가 관리하는 금칙어(chat_filter_terms)가 메시지에 들어 있으면 전송을 막는다(422).
- 메시지와 금칙어를 같은 방식으로 정규화한다: NFKC → 소문자 → 공백·흔한 구분 기호 제거.
  "테 스 트", "테.스.트", 전각 영문 같은 단순 우회도 같은 값이 된다.
- 어떤 단어에 걸렸는지는 응답에 넣지 않는다. 로그에도 메시지 내용·단어를 남기지 않는다(term id 만).
- 자동 삭제·자동 정지·자동 차단·경고 누적은 하지 않는다. 막는 것은 이번 전송 한 건뿐이다.
- 매 전송마다 DB 를 조회한다(목록이 작다). 관리자가 단어를 지우면 다음 전송부터 바로 통과한다.
"""

import logging
import re
import unicodedata

from fastapi import HTTPException
from sqlalchemy.orm import Session as DBSession

from app.models.chat import ChatFilterTerm

logger = logging.getLogger(__name__)

MIN_TERM_LENGTH = 2
MAX_TERM_LENGTH = 50
MAX_TERMS = 500

# 공백 + 흔한 구분 기호. 한글·영문·숫자는 남긴다.
_SEPARATORS = re.compile(r"[\s.\-_*~!@#$%^&()+=/\\|,;:'\"`?<>\[\]{}·•ㆍ…]+")

BLOCKED_DETAIL = {
    "code": "CHAT_CONTENT_BLOCKED",
    "message": "운영정책에 맞지 않는 표현이 있어 보낼 수 없어요. 내용을 고쳐 다시 보내 주세요.",
}


def normalize(text: str | None) -> str:
    folded = unicodedata.normalize("NFKC", text or "").lower()
    return _SEPARATORS.sub("", folded)


def find_blocked_term_id(content: str | None, db: DBSession) -> str | None:
    """걸린 금칙어 id(문자열) 또는 None."""
    normalized = normalize(content)
    if not normalized:
        return None
    for term_id, term in db.query(ChatFilterTerm.id, ChatFilterTerm.normalized_term).all():
        if term and term in normalized:
            return str(term_id)
    return None


def ensure_allowed(content: str | None, user_id, db: DBSession) -> None:
    term_id = find_blocked_term_id(content, db)
    if term_id is None:
        return
    logger.info("chat message blocked by filter (user=%s, term_id=%s)", user_id, term_id)
    raise HTTPException(status_code=422, detail=BLOCKED_DETAIL)
