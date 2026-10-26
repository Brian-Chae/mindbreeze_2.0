"""[MB261026][FIX] 채팅 게시 필터 기본 금칙어 시드 (pytest 대상 아님).

목록은 `scripts/data/chat_filter_terms_default.txt` 에만 있다(코드·마이그레이션에 단어를 넣지 않는다).
Brian 이 목록을 확인한 뒤 운영자가 실행한다. 관리자 화면(/admin/chat-reports → 금칙어)에서 하나씩 등록해도 같다.
- 멱등: 이미 있는 단어(정규화 기준)는 건너뛴다. 기존 단어를 지우지 않는다.
- 감사: 추가한 단어마다 verification_audits(chat_filter_term_add, extra.source=seed) 1행.
- 메일 발송 없음.

실행(backend/.env 가 로드된 환경):
  python scripts/seed_chat_filter_terms.py status            # 현재 등록 수
  python scripts/seed_chat_filter_terms.py dry-run           # 추가될 단어 수만 출력(DB 변경 없음)
  python scripts/seed_chat_filter_terms.py apply --confirm   # 실제 등록
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy.orm import Session  # noqa: E402

from app.models.chat import ChatFilterTerm  # noqa: E402
from app.models.credential import VerificationAudit  # noqa: E402
from app.services import chat_content_filter  # noqa: E402

DEFAULT_TERMS_FILE = Path(__file__).parent / "data" / "chat_filter_terms_default.txt"


def load_terms(path: Path = DEFAULT_TERMS_FILE) -> list[str]:
    """주석·빈 줄을 뺀 단어 목록(파일 순서, 정규화 중복 제거)."""
    terms: list[str] = []
    seen: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        term = line.split("#", 1)[0].strip()
        normalized = chat_content_filter.normalize(term)
        if not term or normalized in seen:
            continue
        seen.add(normalized)
        terms.append(term)
    return terms


def seed(db: Session, terms: list[str], *, apply: bool) -> dict[str, int]:
    existing = {n for (n,) in db.query(ChatFilterTerm.normalized_term).all()}
    to_add = [t for t in terms if chat_content_filter.normalize(t) not in existing]
    invalid = [
        t for t in to_add
        if not (chat_content_filter.MIN_TERM_LENGTH <= len(chat_content_filter.normalize(t)) <= chat_content_filter.MAX_TERM_LENGTH)
    ]
    if invalid:
        raise ValueError(f"길이 규칙을 벗어난 단어가 {len(invalid)}개 있습니다")
    if len(existing) + len(to_add) > chat_content_filter.MAX_TERMS:
        raise ValueError(f"금칙어 상한({chat_content_filter.MAX_TERMS}개)을 넘습니다")
    if apply:
        now = datetime.now(timezone.utc)
        for term in to_add:
            row = ChatFilterTerm(term=term, normalized_term=chat_content_filter.normalize(term), created_by=None)
            db.add(row)
            db.flush()
            db.add(
                VerificationAudit(
                    created_at=now,
                    target_type="chat_filter_term",
                    target_id=row.id,
                    admin_id=None,
                    action="chat_filter_term_add",
                    extra={"term": term, "source": "seed"},
                )
            )
        db.commit()
    return {"existing": len(existing), "to_add": len(to_add), "added": len(to_add) if apply else 0}


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in {"status", "dry-run", "apply"}:
        print(__doc__)
        return 2
    if argv[0] == "apply" and "--confirm" not in argv:
        print("apply 는 --confirm 이 있어야 실행합니다(목록을 Brian 이 확인한 뒤).")
        return 2
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        if argv[0] == "status":
            print(f"등록된 금칙어: {db.query(ChatFilterTerm).count()}개")
            return 0
        result = seed(db, load_terms(), apply=argv[0] == "apply")
        print(f"기존 {result['existing']}개 · 추가 대상 {result['to_add']}개 · 실제 추가 {result['added']}개")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
