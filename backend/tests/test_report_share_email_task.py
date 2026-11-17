"""SDD-327 T13 — 리포트 공유 메일 태스크·템플릿 테스트 (발송은 모두 mock)."""
import sys
import types
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest

from app.core.database import get_db
from app.main import app
from app.models.record import Report
from app.models.report_share_event import ReportShareEvent
from app.models.session import Session, SessionParticipant
from app.services import report_share_email_template as tpl
from app.tasks import report_share_email_task as task_mod

REAL_NAME = "김진짜"
REAL_EMAIL = "real.person@example.com"
HERO = {
    "kicker": "몸돌봄 2회차 · 나의 변화",
    "headline": "심박은 내려가고,\n이완도는 올라갔어요.",
    "lead": "명상 후반, 몸이 차분해지는 방향의 변화가 관찰됐어요.",
    "pair_caption_before": "준비·호흡 2–12분",
    "pair_caption_after": "명상 후반 48–63분",
    "caution": "수업 안의 구간 중앙값 비교예요. 명상만의 영향인지는 이 기록으로 확인할 수 없어요.",
    "pairs": [
        {"key": "heart_rate", "name": "심박", "unit": "회/분", "before": "75.0", "after": "58.0", "change_text": "↓ 17.0 감소"},
        {"key": "relaxation", "name": "이완도", "unit": "지표", "before": "64.5", "after": "78.8", "change_text": "↑ 14.3 상승"},
        {"key": "motion", "name": "움직임", "unit": "가속도 크기", "before": "0.020", "after": "0.000", "change_text": "↓ 0.020 감소"},
        {"key": "focus", "name": "집중도", "unit": "지표", "before": "7.5", "after": "38.2", "change_text": "↑ 30.7 상승"},
    ],
}
URL = "https://dev.example.com/report-view?token=abc.def.ghi"


@pytest.fixture
def env(client, monkeypatch):
    db = next(app.dependency_overrides[get_db]())
    session = Session(host_id=uuid.uuid4(), type="meditation", status="completed", duration_min=10)
    db.add(session)
    db.flush()
    participant = SessionParticipant(report_included=True, session_id=session.id, guest_name=REAL_NAME)
    db.add(participant)
    db.flush()
    report = Report(session_id=session.id, participant_id=participant.id, type="client", status="completed",
                    content={"member_report": {"hero": HERO}})
    db.add(report)
    db.flush()
    event = ReportShareEvent(report_id=report.id, sender_role="member", recipient_masked="a***@d***.com",
                             recipient_hash="h" * 64, jti="j1", attached=False, status="queued")
    db.add(event)
    db.commit()
    send = Mock(return_value=True)
    monkeypatch.setattr("app.tasks.email._send_email", send)
    yield db, report, event, send


def _fake_book(monkeypatch, data=b"%PDF-1.4 fake", raises=False):
    mod = types.ModuleType("app.services.member_report_book")

    def render_book_pdf(content):
        if raises:
            raise RuntimeError("렌더 실패")
        return data

    mod.render_book_pdf = render_book_pdf
    monkeypatch.setitem(sys.modules, "app.services.member_report_book", mod)
    import app.services as services_pkg
    monkeypatch.setattr(services_pkg, "member_report_book", mod, raising=False)


def _no_book(monkeypatch):
    monkeypatch.setitem(sys.modules, "app.services.member_report_book", None)  # import 실패 유도


def _run(db, event, attach=True, message=None, name="마음숲"):
    return task_mod.deliver_share_email(str(event.id), REAL_EMAIL, URL, attach, message, name, db)


def test_링크만_발송_sent_갱신(env, monkeypatch):
    db, _, event, send = env
    _no_book(monkeypatch)
    assert _run(db, event) == "sent"
    db.refresh(event)
    assert event.status == "sent" and event.sent_at is not None and event.error_code is None
    assert event.attached is False
    send.assert_called_once()
    args = send.call_args.args
    assert args[0] == REAL_EMAIL and args[1] == "마음숲님이 명상 기록을 공유했어요"


def test_발송_실패는_failed와_error_code(env, monkeypatch):
    db, _, event, send = env
    _no_book(monkeypatch)
    send.return_value = False
    assert _run(db, event) == "failed"
    db.refresh(event)
    assert event.status == "failed" and event.error_code == "send_failed" and event.sent_at is None


def test_PDF_첨부_성공(env, monkeypatch):
    db, _, event, send = env
    _fake_book(monkeypatch)
    att = Mock(return_value=True)
    monkeypatch.setattr(task_mod, "_send_with_attachment", att)
    assert _run(db, event) == "sent"
    db.refresh(event)
    assert event.attached is True
    att.assert_called_once()
    send.assert_not_called()
    assert "PDF 첨부" in att.call_args.args[3]


def test_8MB_초과는_링크만(env, monkeypatch):
    db, _, event, send = env
    _fake_book(monkeypatch, data=b"0" * (task_mod.MAX_ATTACH_BYTES + 1))
    att = Mock(return_value=True)
    monkeypatch.setattr(task_mod, "_send_with_attachment", att)
    assert _run(db, event) == "sent"
    db.refresh(event)
    assert event.attached is False
    att.assert_not_called()
    send.assert_called_once()
    assert "PDF 첨부" not in send.call_args.args[3]


def test_책_생성_실패는_링크만(env, monkeypatch):
    db, _, event, send = env
    _fake_book(monkeypatch, raises=True)
    att = Mock(return_value=True)
    monkeypatch.setattr(task_mod, "_send_with_attachment", att)
    assert _run(db, event) == "sent"
    db.refresh(event)
    assert event.attached is False and event.status == "sent"
    att.assert_not_called()


def test_attach_pdf_false면_책_호출_안함(env, monkeypatch):
    db, _, event, send = env
    _fake_book(monkeypatch)
    att = Mock(return_value=True)
    monkeypatch.setattr(task_mod, "_send_with_attachment", att)
    assert _run(db, event, attach=False) == "sent"
    att.assert_not_called()


def test_이미_sent이면_재발송_안함(env, monkeypatch):
    db, _, event, send = env
    _no_book(monkeypatch)
    event.status = "sent"
    db.commit()
    assert _run(db, event) == "skipped"
    send.assert_not_called()


def test_hero_없으면_카드_생략(env, monkeypatch):
    db, report, event, send = env
    _no_book(monkeypatch)
    report.content = {}
    db.commit()
    assert _run(db, event) == "sent"
    html = send.call_args.args[3]
    assert "이완도" not in html and "리포트 열기" in html


def test_템플릿_금지어_실명_0_표시이름_대체():
    exp = tpl.compute_expires_at(datetime(2026, 11, 13, 4, 20, tzinfo=timezone.utc))
    mail = tpl.build_share_email(sender_name="", share_url=URL, message="오늘 기록 나눠요 &lt;b&gt;",
                                 hero=HERO, expires_at=exp, attached=True, attach_size_mb=4.2)
    assert mail.subject == "MIND BREEZE 회원님이 명상 기록을 공유했어요"
    for blob in (mail.subject, mail.html, mail.text):
        assert tpl.find_forbidden_words(blob) == []
        assert REAL_NAME not in blob and REAL_EMAIL not in blob
    assert "보낸 사람: MIND BREEZE 회원님이 공유" in mail.html
    for must in ("의료 진단이 아닙니다", "문의: 담당 클래스 코치", "리포트 열기", "2026.11.20 13:20", "PDF 첨부 · 4.2MB",
                 "함께 온 메시지", "↓ 17.0 감소", "↑ 30.7 상승"):
        assert must in mail.html, must
    assert "&lt;b&gt;" in mail.html and "&amp;lt;" not in mail.html  # 이중 이스케이프 없음


def test_표시이름_HTML_이스케이프():
    mail = tpl.build_share_email(sender_name="<script>x</script>", share_url=URL, message=None, hero=None,
                                 expires_at=tpl.compute_expires_at(None), attached=False)
    assert "<script>" not in mail.html
    assert "함께 온 메시지" not in mail.html


def test_샘플_HTML_저장():
    exp = tpl.compute_expires_at(datetime(2026, 11, 13, 4, 20, tzinfo=timezone.utc))
    mail = tpl.build_share_email(sender_name="마음숲", share_url=URL, message="오늘의 명상 기록을 함께 나누고 싶어요.",
                                 hero=HERO, expires_at=exp, attached=True, attach_size_mb=4.2)
    out = Path.home() / ".hermes/share/sdd327-shots/email/sample.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(mail.html, encoding="utf-8")
    assert out.stat().st_size > 1000


def test_태스크가_email_app에_등록():
    from app.tasks.report_email_task import email_app
    assert "tasks.report_share_email" in email_app.tasks
