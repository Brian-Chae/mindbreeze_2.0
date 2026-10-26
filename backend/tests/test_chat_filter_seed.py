"""[MB261026][FIX] 기본 금칙어 안(B1)·시드 스크립트 — 목록 규칙, 대표 오탐 문장, 멱등."""

import importlib.util
from pathlib import Path

import pytest

from app.models.chat import ChatFilterTerm
from app.models.credential import VerificationAudit
from app.services import chat_content_filter
from tests.test_chat import _close_db, _test_db

SCRIPT = Path(__file__).parents[1] / "scripts" / "seed_chat_filter_terms.py"


@pytest.fixture(scope="module")
def seed_module():
    spec = importlib.util.spec_from_file_location("seed_chat_filter_terms", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _blocked(text, terms):
    normalized = chat_content_filter.normalize(text)
    return [t for t in terms if chat_content_filter.normalize(t) in normalized]


def test_기본안은_30개_안팎이고_모두_규칙을_지킨다(seed_module):
    terms = seed_module.load_terms()
    assert 25 <= len(terms) <= 40
    normalized = [chat_content_filter.normalize(t) for t in terms]
    assert len(set(normalized)) == len(terms)
    assert all(chat_content_filter.MIN_TERM_LENGTH <= len(n) <= chat_content_filter.MAX_TERM_LENGTH for n in normalized)


# 띄어쓰기를 지우는 정규화 때문에 생길 수 있는 대표 오탐 — 기본안은 이 문장들을 막지 않아야 한다.
BENIGN = [
    "주말에 한강 간다",
    "폐렴 병원 다녀왔어요",
    "야 동생아 밥 먹었어?",
    "기록 보존 나중에 할게요",
    "아저씨 바로 오세요",
    "시발점에서 출발해요",
    "내 맘 충분히 알아",
    "회의시 팔로우업 부탁해요",
    "push it to the limit",
    "그거 보지 마세요",
    "지금 자지 마",
    "오늘 명상 정말 좋았어요",
    "호흡이 편안해졌어요",
]


@pytest.mark.parametrize("text", BENIGN)
def test_대표_오탐_문장은_막지_않는다(seed_module, text):
    assert _blocked(text, seed_module.load_terms()) == []


@pytest.mark.parametrize("text", ["씨 발", "ㅅㅂ 진짜", "이 미친놈아", "F*U*C*K you", "조건 만남 구해요"])
def test_대표_유해_표현은_막는다(seed_module, text):
    assert _blocked(text, seed_module.load_terms())


def test_시드는_멱등이고_감사를_남긴다(seed_module, client):
    terms = seed_module.load_terms()
    db_gen, db = _test_db()
    try:
        dry = seed_module.seed(db, terms, apply=False)
        assert dry == {"existing": 0, "to_add": len(terms), "added": 0}
        assert db.query(ChatFilterTerm).count() == 0
        first = seed_module.seed(db, terms, apply=True)
        assert first["added"] == len(terms)
        second = seed_module.seed(db, terms, apply=True)
        assert second == {"existing": len(terms), "to_add": 0, "added": 0}
        assert db.query(ChatFilterTerm).count() == len(terms)
        audits = db.query(VerificationAudit).filter(VerificationAudit.action == "chat_filter_term_add").all()
        assert len(audits) == len(terms) and all(a.extra["source"] == "seed" for a in audits)
    finally:
        _close_db(db_gen)


def test_apply는_confirm이_있어야_한다(seed_module, capsys):
    assert seed_module.main(["apply"]) == 2
    assert "--confirm" in capsys.readouterr().out
