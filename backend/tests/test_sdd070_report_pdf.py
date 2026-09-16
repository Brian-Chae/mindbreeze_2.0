"""SDD-070: 서버 PDF의 권한, 토큰, 페이지와 한글 보존."""
from io import BytesIO
from uuid import uuid4

import pytest
from pypdf import PdfReader

from app.api.deps import get_current_user
from app.main import app
from app.services import report_email_service
from tests.test_sdd052_report_view import _view_report


def _pdf_available() -> bool:
    """WeasyPrint 시스템 라이브러리(Cairo/Pango/GLib)가 없는 로컬 환경에서는 skip한다.

    EC2(리눅스) 배포 환경에는 deploy-dev.yml이 의존성을 설치하므로 실제 PDF 생성이 검증된다.
    """
    try:
        from weasyprint import HTML  # noqa: F401
        return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _pdf_available(),
    reason="WeasyPrint 시스템 라이브러리(Cairo/Pango/GLib) 미설치 환경",
)


def test_pdf_requires_login(client):
    assert client.get(f"/api/v1/reports/{uuid4()}/pdf").status_code == 401


def test_token_pdf_auth_and_attachment(client):
    db, provider, session, participant, report = _view_report(client)
    try:
        path = "/api/v1/reports/view/pdf"
        assert client.get(path, params={"token": "invalid"}).status_code == 401
        token = report_email_service._token("report_view", str(report.id), str(session.id), email=participant.report_email)
        response = client.get(path, params={"token": token})
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["content-disposition"].startswith("attachment;")
        assert response.headers["cache-control"] == "no-store"
        assert response.content.startswith(b"%PDF-")
        assert len(PdfReader(BytesIO(response.content)).pages) == 4
        participant.report_email = "changed@example.com"
        db.commit()
        assert client.get(path, params={"token": token}).status_code == 403
    finally:
        provider.close()


def test_pdf_requires_host_counselor_and_approval(client):
    db, provider, session, participant, report = _view_report(client)
    try:
        path = f"/api/v1/reports/{report.id}/pdf"
        app.dependency_overrides[get_current_user] = lambda: {"id": str(session.host_id), "role": "counselor"}
        assert client.get(path).status_code == 200
        report.status = "pending_review"
        db.commit()
        assert client.get(path).status_code == 409
        app.dependency_overrides[get_current_user] = lambda: {"id": str(uuid4()), "role": "counselor"}
        assert client.get(path).status_code == 403
        app.dependency_overrides[get_current_user] = lambda: {"id": str(session.host_id), "role": "client"}
        assert client.get(path).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        provider.close()


@pytest.mark.parametrize("length", [0, 1, 30])
def test_real_pdf_four_pages_korean_and_embedded_font(length):
    from app.services.report_pdf_service import generate_report_pdf
    narrative = {key: "몸과 마음의 변화를 함께 살펴보세요. " * length for key in ("journey", "body", "mind", "closing")}
    pdf = generate_report_pdf({"session_title": "한글 명상", "content": {"eeg": {"narrative": narrative, "metrics": {"secret_metric": 99}}}})
    reader = PdfReader(BytesIO(pdf))
    assert len(reader.pages) == 4
    texts = [page.extract_text() for page in reader.pages]
    assert "한글 명상" in texts[0]
    assert "몸의 변화" in texts[1]
    assert "마음의 변화" in texts[2]
    assert "마무리" in texts[3]
    assert "secret_metric" not in "".join(texts)
    for index, page in enumerate(reader.pages):
        assert "MIND BREEZE" in texts[index]
        assert f"{index + 1} / 4" in texts[index]
        fonts = page["/Resources"]["/Font"].get_object()
        assert any("Noto" in str(font.get_object()["/BaseFont"]) for font in fonts.values())
        for font in fonts.values():
            obj = font.get_object()
            if "/DescendantFonts" in obj:
                descriptor = obj["/DescendantFonts"][0].get_object()["/FontDescriptor"]
                assert "/FontFile2" in descriptor or "/FontFile3" in descriptor


def test_html_escapes_untrusted_text_and_blocks_resources():
    from app.services.report_pdf_service import render_report_html, _font_fetcher
    html = render_report_html({"session_title": '<img src="file:///etc/passwd">', "content": {}}, 1)
    assert '<img src="file:' not in html
    assert '&lt;img' in html
    for url in ("file:///etc/passwd", "https://example.com/image.png", "http://169.254.169.254/latest/meta-data/"):
        with pytest.raises(ValueError):
            _font_fetcher(url)


def test_token_pdf_rejects_expiry_wrong_kind_session_and_unapproved(client):
    from datetime import datetime, timedelta, timezone
    from jose import jwt
    from app.config import settings

    db, provider, session, participant, report = _view_report(client)
    try:
        claims = {"type": "report_view", "sub": str(report.id), "session_id": str(session.id),
                  "email": participant.report_email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
        for overrides, expected in (({"exp": datetime.now(timezone.utc) - timedelta(seconds=1)}, 401),
                                    ({"type": "access"}, 401), ({"session_id": str(uuid4())}, 403)):
            token = jwt.encode({**claims, **overrides}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
            assert client.get('/api/v1/reports/view/pdf', params={"token": token}).status_code == expected
        report.status = "pending_review"
        db.commit()
        token = jwt.encode(claims, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
        assert client.get('/api/v1/reports/view/pdf', params={"token": token}).status_code == 403
    finally:
        provider.close()


def test_pdf_rejects_unreadable_overflow_instead_of_truncating():
    from fastapi import HTTPException
    from app.services.report_pdf_service import generate_report_pdf
    with pytest.raises(HTTPException) as exc:
        generate_report_pdf({"content": {"eeg": {"narrative": {"journey": "긴 본문 " * 1200 + "끝표식"}}}})
    assert exc.value.status_code == 422


def test_pdf_missing_font_fails_explicitly(monkeypatch, tmp_path):
    from fastapi import HTTPException
    from app.services import report_pdf_service
    monkeypatch.setattr(report_pdf_service, "FONT_PATH", tmp_path / "missing.ttf")
    with pytest.raises(HTTPException) as exc:
        report_pdf_service.generate_report_pdf({"content": {}})
    assert exc.value.status_code == 503
