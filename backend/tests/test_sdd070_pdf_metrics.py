"""웹 표시 계약과 서버 PDF 지표의 동등성 회귀 검증."""
import pytest

from app.services.report_pdf_service import render_report_html


def measured_content():
    return {"eeg": {"status": "valid", "timeline": [
        {"t": i * 60, "respiratory_rate": 18 if i < 2 else 15,
         "heart_rate": 75 if i < 2 else 69, "sdnn": 40 if i < 2 else 48,
         "concentration": .5 if i < 2 else .65,
         "relaxation": .4 if i < 2 else .6, "stress": .5 if i < 2 else .3}
        for i in range(4)]}}


def test_pdf_contains_web_cards_and_chips():
    html = render_report_html({"content": measured_content()})
    for text in ("3회/분", "6회/분", "8밀리초", "30%", "50%", "40%",
                 "명상 시작(전반) 평균 대비 마무리(후반) 평균", "1분 동안 숨을 쉬는 횟수예요.",
                 "journey-summary", "metric-card", "polyline", "1.5분", "3분"):
        assert text in html


def test_missing_metric_does_not_invent_stability():
    content = measured_content()
    for point in content["eeg"]["timeline"]:
        point["sdnn"] = None
    html = render_report_html({"content": content})
    assert '<article class="metric-card"' not in html
    assert "신호 변화량이 아직 없어요" in html


@pytest.mark.parametrize("metric,early,late,direction,label", [
    ("respiratory_rate", 18, 17, "down", "1회/분"),
    ("heart_rate", 70, 72.9, "stable", "2.9회/분"),
    ("hrv", 40, 45, "up", "5밀리초"),
    ("focus", 100, 95, "down", "5%"),
    ("focus", 200, 195, "stable", "2%"),
    ("focus", 0, 1, "up", "100%"),
])
def test_web_direction_and_js_rounding(metric, early, late, direction, label):
    from app.services.report_pdf_narrative import build_metric_narrative
    actual = build_metric_narrative(metric, early, late)
    assert (actual["direction"], actual["deltaLabel"]) == (direction, label)


def test_saved_changes_priority_and_partial_contract():
    from app.services.report_pdf_narrative import resolve_pdf_narrative, IDS
    content = measured_content()
    content['eeg']['changes'] = [{'id': key, 'early': 10, 'late': 20} for key in IDS]
    content['eeg']['narrative'] = {'changes': [{'id': key, 'early': 10, 'late': 10} for key in IDS]}
    _, body, mind, _ = resolve_pdf_narrative(content)
    assert all(m['direction'] == 'stable' for m in body + mind)
    content['eeg']['narrative']['changes'] = [{'id': 'focus', 'early': 10, 'late': 20}]
    _, body, mind, _ = resolve_pdf_narrative(content)
    assert body == mind == []


def test_timeline_gaps_hrv_alias_and_no_score_fabrication():
    from app.services.report_pdf_narrative import resolve_pdf_narrative, trend_svg
    content = measured_content()
    for point in content['eeg']['timeline']:
        point['hrv'] = point.pop('sdnn')
    _, body, _, timeline = resolve_pdf_narrative(content)
    assert body[2]['deltaLabel'] == '8밀리초'
    timeline[1]['hrv'] = None
    svg = trend_svg('hrv', timeline)
    assert svg.count('<polyline') == 1
    assert '16.0,' not in svg.split('<polyline')[1].split('/>')[0]
    content['eeg']['timeline'] = []
    content['eeg']['metrics'] = {'focus': 99, 'relaxation': 99, 'stress': 0}
    _, body, mind, _ = resolve_pdf_narrative(content)
    assert body == mind == []


def test_real_pdf_metric_pages():
    from io import BytesIO
    from pypdf import PdfReader
    from app.services.report_pdf_service import generate_report_pdf
    from tests.test_sdd070_report_pdf import _pdf_available
    if not _pdf_available():
        pytest.skip('WeasyPrint 시스템 라이브러리 경로 필요')
    reader = PdfReader(BytesIO(generate_report_pdf({'content': measured_content()})))
    assert len(reader.pages) == 4
    texts = [p.extract_text() for p in reader.pages]
    for expected in ('3회/분', '6회/분', '8밀리초', '1분 동안 숨을 쉬는 횟수예요.'):
        assert expected in texts[1]
    for expected in ('30%', '50%', '40%', '실제 감정을 직접 측정하지 않아요.'):
        assert expected in texts[2]
    assert '1.5분' in texts[0] and '3분' in texts[0]
