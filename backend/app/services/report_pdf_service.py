"""SDD-070: 승인된 리포트의 안전한 4페이지 서사형 PDF 렌더링."""
from html import escape
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import Response

FONT_PATH = Path(__file__).resolve().parents[1] / "assets/fonts/NotoSansKR.ttf"
FONT_URL = "https://report.invalid/fonts/NotoSansKR.ttf"


def _font_fetcher(url: str) -> dict:
    """번들 한글 폰트만 제공한다. 네트워크와 임의 파일 접근은 금지한다."""
    if url != FONT_URL:
        raise ValueError("PDF 외부 리소스는 허용하지 않습니다")
    return {"string": FONT_PATH.read_bytes(), "mime_type": "font/ttf"}


def _record(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _text(value: object, fallback: str = "") -> str:
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def render_report_html(report: dict, scale: float = 1) -> str:
    """서사만 허용 목록으로 투영한다. 상담 메모와 EEG 상세지표는 포함하지 않는다."""
    content = _record(report.get("content"))
    narrative = _record(_record(content.get("eeg")).get("narrative"))
    fields = {
        "journey": _text(narrative.get("journey"), _text(content.get("summary"), "오늘의 기록을 돌아보며 몸과 마음의 감각을 살펴보세요.")),
        "body": _text(narrative.get("body"), _text(narrative.get("body_text"), "측정 자료가 부족해 몸의 전후 변화를 확인하기 어려워요.")),
        "mind": _text(narrative.get("mind"), _text(narrative.get("mind_text"), "측정 자료가 부족해 마음의 전후 변화를 확인하기 어려워요.")),
        "closing": _text(narrative.get("closing"), _text(narrative.get("closing_text"), "오늘의 경험을 있는 그대로 돌아보며, 잠시 자신의 몸과 마음에 귀 기울여 보세요.")),
    }
    # 지나치게 큰 콘텐츠로 렌더러의 메모리를 소모하지 않도록 사전 제한한다.
    if any(len(value) > 12000 for value in fields.values()):
        raise HTTPException(422, "리포트 본문이 너무 길어 4페이지 PDF로 만들 수 없습니다.")
    fields = {key: escape(value) for key, value in fields.items()}
    title = escape(_text(report.get("session_title"), "나를 위한 명상 기록")[:300])
    name = escape(_text(report.get("participant_name"), "나를 위한 기록")[:100])
    date = report.get("scheduled_at")
    if hasattr(date, "strftime"):
        from zoneinfo import ZoneInfo
        date = date.astimezone(ZoneInfo("Asia/Seoul")).strftime("%Y.%m.%d %H:%M") if date.tzinfo else date.strftime("%Y.%m.%d %H:%M")
    date_label = escape(str(date)[:40]) if date else "날짜 정보 없음"
    return f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>MIND BREEZE 몸·마음 리포트</title>
<style>
@font-face {{ font-family: NotoSansKR; src: url("{FONT_URL}"); font-weight: 100 900; }}
@page {{ size: A4; margin: 22mm 19mm 22mm; background: #FFFEFA;
 @top-center {{ content: "MIND BREEZE  /  몸·마음 리포트"; font-family: NotoSansKR; font-size: 8pt; color: #5F0080; }}
 @bottom-center {{ content: "mind breeze    ·    " counter(page) " / " counter(pages); font-family: NotoSansKR; font-size: 8pt; color: #63566B; }}
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; color: #302537; font-family: NotoSansKR; font-size: {11 * scale}pt; line-height: 1.85; overflow-wrap: anywhere; }}
section {{ break-before: page; }} section:first-child {{ break-before: auto; }}
h1,h2,h3,p {{ margin: 0; }} h1 {{ font-size: {31 * scale}pt; line-height: 1.45; letter-spacing: -1pt; }}
h2 {{ font-size: {27 * scale}pt; line-height: 1.5; letter-spacing: -.7pt; margin: 3mm 0 7mm; }}
h3 {{ font-size: {13 * scale}pt; margin-bottom: 3mm; }}
.eyebrow {{ font-size: 8pt; font-weight: 700; letter-spacing: 1.7pt; color: #5F0080; margin-bottom: 4mm; }}
.lead {{ color: #63566B; margin: 6mm 0; }}
.cover {{ position: relative; padding: 8mm 0; border-bottom: 1px solid #E8D9EF; }}
.art {{ position: absolute; right: 0; top: 0; width: 37mm; height: 37mm; }}
.meta {{ border-left: 3px solid #59CE90; padding: 2mm 0 2mm 5mm; margin: 8mm 0 3mm; color: #63566B; font-size: 9pt; }}
.journey {{ margin-top: 10mm; }} .journey h2 {{ font-size: {20 * scale}pt; }}
.copy {{ white-space: pre-wrap; }}
.panel {{ background: #F1FAF5; border: 1px solid #D1EADB; border-radius: 5mm; padding: {9 * scale}mm; margin: 8mm 0; }}
.mind .panel {{ background: #F5EFF9; border-color: #E8D9EF; }}
.rule {{ width: 18mm; height: 1.2mm; background: #59CE90; margin: 8mm 0; }}
.note {{ font-size: 9pt; color: #63566B; margin-top: 7mm; line-height: 1.8; }}
.steps {{ width: 100%; border-collapse: collapse; margin-top: 8mm; font-size: 9pt; }}
.steps td {{ width: 33.3%; border-top: 2px solid #59CE90; padding: 5mm 2mm; vertical-align: top; }}
.practice {{ margin: 7mm 0; padding: 6mm; background: #F1FAF5; border-radius: 4mm; }}
.practice.mind {{ background: #F5EFF9; }}
.closing-message {{ padding-top: 8mm; border-top: 1px solid #E8D9EF; margin-top: 9mm; color: #5F0080; }}
</style></head><body>
<section><div class="cover"><p class="eyebrow">01 · 나의 명상 여정</p>
<svg class="art" viewBox="0 0 240 240" aria-hidden="true"><g fill="none" stroke="#5F0080" opacity=".24"><ellipse cx="120" cy="120" rx="95" ry="44" transform="rotate(-32 120 120)"/><ellipse cx="120" cy="120" rx="84" ry="57" transform="rotate(-32 120 120)"/><circle cx="120" cy="120" r="70"/></g><circle cx="187" cy="76" r="9" fill="#59CE90"/></svg>
<h1>나에게 돌아온 시간,<br>몸과 마음의 이야기</h1><p class="lead">분주했던 하루에서 한 걸음 물러나,<br>오늘 나에게 일어난 작은 변화를 만나보세요.</p>
<div class="meta"><strong>{title}</strong><br>{name} · {date_label}</div></div>
<div class="journey"><p class="eyebrow">02 · 종합 여정</p><h2>오늘의 몸과 마음을 돌아보며</h2><p class="copy">{fields['journey']}</p></div>
<table class="steps"><tr><td>처음<br><strong>잠시 멈추기</strong><br>자리에 몸을 맡기고</td><td>중간<br><strong>호흡에 머물기</strong><br>지금의 감각을 따라</td><td>마지막<br><strong>나에게 돌아오기</strong><br>몸과 마음을 살피며</td></tr></table>
<p class="note">이 기록은 이번 세션에서 관찰한 흐름을 담습니다. 측정 자료가 없는 경우에는 변화를 단정하지 않습니다.</p></section>
<section class="body"><p class="eyebrow">03 · 몸의 변화</p><h2>몸이 들려주는<br>오늘의 리듬</h2><p class="lead">호흡과 심장의 움직임에서 오늘의 변화를 살펴보세요.</p><div class="rule"></div>
<div class="panel"><h3>몸의 이야기를 읽어요</h3><p class="copy">{fields['body']}</p></div>
<div class="practice"><h3>몸의 감각도 함께 떠올려 보세요</h3><p>시작할 때와 마무리할 때, 호흡과 어깨의 감각은 어땠나요?<br>측정된 신호와 내가 느낀 경험을 나란히 살펴보세요.</p></div>
<p class="note">몸의 신호가 오르거나 내렸다는 사실만으로 건강 상태나 명상의 효과를 판단하지 않아요. 측정 자료가 부족한 항목은 비교할 수 없어요.</p></section>
<section class="mind"><p class="eyebrow">04 · 마음의 변화</p><h2>지금 이 순간에<br>조금 더 가까이</h2><p class="lead">마음의 신호가 어떻게 흘렀는지, 나의 느낌과 함께 읽어보세요.</p><div class="rule"></div>
<div class="panel"><h3>마음의 이야기를 읽어요</h3><p class="copy">{fields['mind']}</p></div>
<div class="practice mind"><h3>내가 느낀 마음을 살펴보세요</h3><p>오늘 나의 주의는 어디에 머물렀나요?<br>생각이 오갔던 순간과 다시 호흡으로 돌아온 순간을 떠올려 보세요.</p></div>
<p class="note">마음의 신호는 실제로 느낀 감정을 직접 측정한 값이 아닙니다. 측정 결과보다 나의 경험을 우선하여 읽어 주세요.</p></section>
<section><p class="eyebrow">05 · 마무리</p><h2>오늘의 작은 쉼을,<br>내일의 나에게도</h2><p class="lead">명상마다 흐름은 달라질 수 있어요.<br>오늘 느꼈던 나의 감각 하나를 기억해 두면 어떨까요?</p>
<div class="practice"><p class="eyebrow">몸을 위한 다음 제안</p><h3>시작할 때, 몸이 머무를 시간을 주세요</h3><p>다음에는 처음 1분을 편안히 자리 잡는 시간으로 가져보세요. 어깨의 힘을 내려놓고, 평소의 호흡이 오가는 감각을 느껴봐요.</p></div>
<div class="practice mind"><p class="eyebrow">마음을 위한 다음 제안</p><h3>알아차린 순간, 다시 호흡으로 돌아와요</h3><p>5분만 나에게 머물러보세요. 생각이 다른 곳으로 향해도 괜찮아요. 알아차렸다면, 지금의 호흡에 부드럽게 주의를 돌려봐요.</p></div>
<p class="closing-message copy">{fields['closing']}</p><p class="note">이 기록은 자기 이해를 돕기 위한 참고 자료이며,<br>의학적 진단이나 치료를 대신하지 않습니다.</p></section>
</body></html>'''


def generate_report_pdf(report: dict) -> bytes:
    # 시스템 라이브러리 누락이 일반 리포트 API의 시작까지 막지 않도록 지연 import한다.
    try:
        from weasyprint import HTML
        from weasyprint.text.fonts import FontConfiguration
    except (ImportError, OSError) as exc:
        raise HTTPException(503, "PDF 생성 환경을 준비하지 못했습니다. 관리자에게 문의해 주세요.") from exc
    if not FONT_PATH.is_file():
        raise HTTPException(503, "PDF 한글 글꼴을 찾을 수 없습니다.")
    fonts = FontConfiguration()
    # 원문을 자르거나 숨기지 않는다. 긴 서사는 읽을 수 있는 범위에서만 축소한다.
    for scale in (1, .9, .8):
        document = HTML(string=render_report_html(report, scale), url_fetcher=_font_fetcher).render(font_config=fonts)
        if len(document.pages) == 4:
            return document.write_pdf()
    raise HTTPException(422, "리포트 본문이 너무 길어 4페이지 PDF로 만들 수 없습니다. 본문 길이를 확인해 주세요.")


def pdf_response(report: dict) -> Response:
    return Response(generate_report_pdf(report), media_type="application/pdf", headers={
        "Content-Disposition": 'attachment; filename="mind-breeze-report.pdf"',
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
    })
