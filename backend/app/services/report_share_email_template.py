"""SDD-327 T13 — 리포트 공유 메일 템플릿(HTML + 텍스트 대체본).

- 디자인 정본: report-share-email-1113/email.html (폭 600, 인라인 스타일).
- 보낸 사람·제목에는 앱 표시 이름만 쓴다(실명·이메일 노출 0, spec §10). 표시 이름 대체는 호출측(ShareActor)이 끝낸다.
- 회원 메시지는 호출측에서 이미 이스케이프된 문자열이다(중복 이스케이프 금지).
- 요약 카드는 `content.member_report.hero`가 있을 때만 그린다(없으면 카드 생략).
- 숫자는 전후 4쌍의 변화량만, 종합점수·등급 류 표현은 쓰지 않는다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Any, Mapping

KST = timezone(timedelta(hours=9))
EXPIRE_DAYS = 7
FALLBACK_SENDER_NAME = "MIND BREEZE 회원"

# spec §6/§9.5 금지어 (화면·PDF·메일 공통). 메일 정적 문구 검사에 쓴다.
FORBIDDEN_WORDS: tuple[str, ...] = (
    "B5", "건강 수준", "점수", "등급", "종합", "스트레스", "우울", "진단합니다", "위험",
)

_BRAND = "#5F0080"
_PAIR_ORDER = ("heart_rate", "relaxation", "motion", "focus")


@dataclass(frozen=True)
class ShareEmail:
    subject: str
    text: str
    html: str


def find_forbidden_words(text: str) -> list[str]:
    """텍스트에 포함된 금지어 목록(검사용)."""
    return [w for w in FORBIDDEN_WORDS if w in text]


def _plain(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _strip_tags(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


def _expire_label(expires_at: datetime) -> str:
    local = expires_at.astimezone(KST)
    return local.strftime("%Y.%m.%d %H:%M")


def compute_expires_at(issued_at: datetime | None, now: datetime | None = None) -> datetime:
    """링크 만료 시각 = 발급(이력 생성) 시각 + 7일. 발급 시각이 없으면 지금 기준."""
    base = issued_at or now or datetime.now(timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    return base + timedelta(days=EXPIRE_DAYS)


def _hero_pairs(hero: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    pairs = [p for p in (hero.get("pairs") or []) if isinstance(p, Mapping)]
    pairs.sort(key=lambda p: _PAIR_ORDER.index(p["key"]) if p.get("key") in _PAIR_ORDER else 99)
    return pairs


def _pair_cell(pair: Mapping[str, Any]) -> str:
    return (
        '<td width="50%" valign="top" style="padding:5px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#FFFFFF;border:1px solid #DFD4E5;border-radius:14px;"><tr>'
        '<td style="padding:14px;">'
        f'<div style="font-size:14px;line-height:20px;color:#282430;">{escape(_plain(pair.get("name")))} '
        f'<span style="font-size:11px;color:#625969;">{escape(_plain(pair.get("unit")))}</span></div>'
        f'<div style="margin:8px 0;font-size:21px;line-height:28px;color:#766C7C;">'
        f'{escape(_plain(pair.get("before")))} → '
        f'<strong style="font-size:25px;color:{_BRAND};">{escape(_plain(pair.get("after")))}</strong></div>'
        f'<div style="font-size:13px;line-height:18px;font-weight:700;color:{_BRAND};">'
        f'{escape(_plain(pair.get("change_text")))}</div>'
        '</td></tr></table></td>'
    )


def _summary_card(hero: Mapping[str, Any] | None) -> tuple[str, str]:
    """(HTML, 텍스트). hero 가 없거나 비면 ("", "") — 카드 생략."""
    if not hero:
        return "", ""
    headline = _plain(hero.get("headline"))
    pairs = _hero_pairs(hero)
    if not headline and not pairs:
        return "", ""
    lead = _plain(hero.get("lead"))
    kicker = _plain(hero.get("kicker"))
    before_cap = _plain(hero.get("pair_caption_before"))
    after_cap = _plain(hero.get("pair_caption_after"))
    caution = _plain(hero.get("caution"))

    head_html = escape(headline).replace("\n", "<br>")
    parts = ['<tr><td style="padding:4px 28px 0;">']
    if kicker:
        parts.append(f'<div style="font-size:12px;line-height:18px;color:{_BRAND};margin-bottom:10px;">{escape(kicker)}</div>')
    if head_html:
        parts.append(
            f'<div style="font-size:26px;line-height:36px;font-weight:700;letter-spacing:-0.5px;'
            f'color:#282430;margin-bottom:12px;">{head_html}</div>'
        )
    if lead:
        parts.append(f'<div style="font-size:15px;line-height:24px;color:#282430;margin-bottom:8px;">{escape(lead)}</div>')
    if before_cap or after_cap:
        cap = "전 · " + before_cap if before_cap else ""
        cap += ("　 /　 " if before_cap and after_cap else "") + ("후 · " + after_cap if after_cap else "")
        parts.append(f'<div style="font-size:12px;line-height:18px;color:#625969;margin-bottom:6px;">{escape(cap)}</div>')
    if pairs:
        parts.append('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px -5px 6px;">')
        for i in range(0, len(pairs), 2):
            row = pairs[i:i + 2]
            cells = "".join(_pair_cell(p) for p in row)
            if len(row) == 1:
                cells += '<td width="50%"></td>'
            parts.append(f"<tr>{cells}</tr>")
        parts.append("</table>")
    if caution:
        parts.append(f'<div style="font-size:12px;line-height:19px;color:#625969;">{escape(caution)}</div>')
    parts.append("</td></tr>")

    text_lines = [headline.replace("\n", " ")] if headline else []
    for p in pairs:
        text_lines.append(
            f'· {_plain(p.get("name"))}: {_plain(p.get("before"))} → {_plain(p.get("after"))} ({_plain(p.get("change_text"))})'
        )
    if caution:
        text_lines.append(caution)
    return "".join(parts), "\n".join(text_lines)


def build_share_email(
    *,
    sender_name: str,
    share_url: str,
    message: str | None,
    hero: Mapping[str, Any] | None,
    expires_at: datetime,
    attached: bool,
    attach_size_mb: float | None = None,
) -> ShareEmail:
    """공유 메일 제목·HTML·텍스트를 만든다.

    message 는 이미 이스케이프된 문자열(또는 None), sender_name 은 대체 처리된 표시 이름이다.
    """
    name = (sender_name or "").strip() or FALLBACK_SENDER_NAME
    name_html = escape(name)
    link_html = escape(share_url, quote=True)
    subject = f"{name}님이 명상 기록을 공유했어요"
    expires = _expire_label(expires_at)
    card_html, card_text = _summary_card(hero)

    message_block = ""
    if message:
        message_block = (
            '<tr><td style="padding:18px 28px 0;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            'style="background:#FAF6FC;border:1px solid #E4DCE8;border-left:3px solid #5F0080;border-radius:12px;">'
            '<tr><td style="padding:16px 18px;">'
            '<div style="font-size:12px;line-height:18px;color:#625969;">함께 온 메시지</div>'
            f'<div style="margin-top:8px;font-size:15px;line-height:24px;color:#282430;white-space:pre-wrap;">{message}</div>'
            '</td></tr></table></td></tr>'
        )

    attach_block = ""
    if attached:
        size = f" · {attach_size_mb:.1f}MB" if attach_size_mb else ""
        attach_block = (
            '<tr><td style="padding:18px 28px 0;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            'style="border:1px solid #E4DCE8;border-radius:12px;"><tr>'
            '<td style="padding:14px;font-size:14px;line-height:21px;color:#282430;">'
            f'▤ 명상 기록 책.pdf<br><span style="font-size:12px;color:#625969;">PDF 첨부{size}</span></td>'
            '<td align="right" style="padding:14px;"><span style="display:inline-block;padding:4px 9px;'
            f'background:#F5EDFC;border-radius:7px;color:{_BRAND};font-size:12px;">1개</span></td>'
            '</tr></table></td></tr>'
        )

    html = (
        '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{escape(subject)}</title></head>'
        "<body style=\"margin:0;padding:0;background:#F5F3F6;color:#282430;"
        "font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;\">"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F6;">'
        '<tr><td align="center" style="padding:24px 12px;">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        'style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E4DCE8;border-radius:18px;">'
        '<tr><td style="padding:22px 28px;background:#FAF6FC;border-radius:18px 18px 0 0;">'
        f'<div style="font-size:13px;letter-spacing:2px;font-weight:700;color:{_BRAND};">MIND BREEZE</div>'
        f'<div style="margin-top:6px;font-size:12px;color:#625969;">보낸 사람: {name_html}님이 공유</div>'
        '</td></tr>'
        '<tr><td style="padding:26px 28px 6px;">'
        f'<div style="font-size:12px;line-height:18px;color:{_BRAND};">{name_html}님이 명상 기록을 보냈어요</div>'
        '</td></tr>'
        f'{card_html}'
        f'{message_block}'
        '<tr><td align="center" style="padding:26px 28px 0;">'
        f'<a href="{link_html}" style="display:block;background:{_BRAND};color:#FFFFFF;text-decoration:none;'
        'font-size:16px;line-height:24px;font-weight:700;padding:14px 18px;border-radius:12px;">리포트 열기 ↗</a>'
        '<div style="margin-top:10px;font-size:12px;line-height:19px;color:#625969;">'
        f'이 메일을 받은 주소 전용 링크예요.<br>{escape(expires)}까지 · 발송 후 {EXPIRE_DAYS}일</div>'
        '</td></tr>'
        f'{attach_block}'
        '<tr><td style="padding:24px 28px 0;">'
        '<div style="font-size:12px;line-height:19px;color:#625969;">버튼이 열리지 않으면 아래 주소를 브라우저에 붙여넣어 주세요.</div>'
        f'<div style="font-size:12px;line-height:19px;color:{_BRAND};word-break:break-all;">{escape(share_url)}</div>'
        '</td></tr>'
        '<tr><td style="padding:24px 28px;border-top:1px solid #E4DCE8;margin-top:24px;'
        'font-size:12px;line-height:20px;color:#625969;">'
        f'보낸 사람: {name_html}님이 공유<br>'
        '심박·뇌파 등 개인 기록이 담겨 있어요.<br>'
        '의료 진단이 아닙니다<br>'
        '문의: 담당 클래스 코치'
        '</td></tr>'
        '</table></td></tr></table></body></html>'
    )

    text_parts = [f"{name}님이 명상 기록을 공유했어요", ""]
    if card_text:
        text_parts += [card_text, ""]
    if message:
        # 메시지는 이스케이프된 HTML 이므로 텍스트 본문에서는 태그·엔티티를 풀어 쓴다.
        from html import unescape

        text_parts += ["[함께 온 메시지]", unescape(message), ""]
    text_parts += [
        f"리포트 열기: {share_url}",
        f"이 메일을 받은 주소 전용 링크예요. {expires}까지(발송 후 {EXPIRE_DAYS}일)",
    ]
    if attached:
        text_parts.append("명상 기록 책 PDF가 첨부되어 있어요.")
    text_parts += ["", f"보낸 사람: {name}님이 공유", "심박·뇌파 등 개인 기록이 담겨 있어요.",
                   "의료 진단이 아닙니다", "문의: 담당 클래스 코치"]
    return ShareEmail(subject=subject, text="\n".join(text_parts), html=html)
