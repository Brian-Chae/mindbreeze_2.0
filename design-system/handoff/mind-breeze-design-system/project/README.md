# MIND BREEZE Design System

A design system for **MIND BREEZE 2.0** — a brain-science meditation platform by **Looxid Labs**. The product gives meditation instructors and counsellors a communication channel with their students/clients, plus AI-driven tools for guiding and managing both in-person and online sessions. EEG biomarkers (via the Link Band headband) and AI analysis turn each session into a personalised brain-health report.

> 뇌과학 IT기업, 룩시드랩스가 만든 — 과학적인 명상 클래스
> _"Brain-science IT company Looxid Labs presents — a scientific meditation class."_

---

## Sources used to build this system

You may not have direct access to these — they are kept here so you can reach back to them when you need more fidelity than the cards provide.

**Live product**
- Existing service homepage: https://mindbreeze.kr/

**Figma file** (mounted to the workspace as a virtual filesystem)
- "MIND BREEZE.fig" — 18 pages, 1,142 frames covering Branding, Homepage, Brochure, Report, App_Pad, App_phone, App_Screenshots, Operation, Class, Manual, Ideation and more. The branding pages (`/Branding/Brand-Colors`, `/Branding/Logo-Asset`, `/Branding/Brand-Story`, `/Branding/logo_signature_light`, `/Branding/logo_mono_dark`) are the canonical brand source.

**GitHub repositories** (private — view in the LooxidLabs org)
- https://github.com/LooxidLabs/mind-breeze-app — React Native app for instructors/operators (the iPad and phone clients). Source of truth for `Color.ts`, type scale (`Texts.tsx`), buttons, SVG icons and product imagery.
- https://github.com/LooxidLabs/mind-breeze-admin — React + Emotion admin web app. Source of `GlobalStyle.tsx`, web type scale, layout wrappers.
- https://github.com/LooxidLabs/mind-breeze-report — Next.js + Tailwind report viewer. Source of the semantic colour palette (`tailwind.config.ts`) and the type scale used in printed reports.

> **For deeper work — clone or read these repos.** If you are building production code, lift directly from `Color.ts` and the styled components rather than re-implementing the values in this system. If you are mocking, use the tokens and components in this folder.

---

## Products in scope

1. **MIND BREEZE App (Operator)** — React Native, iPad-first. The instructor's runtime: register/connect Link Band devices, manage participants, run a session in real time (waiting → meditating → complete), and consent flows for guests.
2. **MIND BREEZE Admin** — Web dashboard for operators and Looxid staff. Sessions, users, session logs, organisation-specific dashboards (e.g. KAIST, Samsung partner views).
3. **MIND BREEZE Report** — Next.js read-only viewer for the post-session AI report (Cover → Introduction → Summary → Stress → Attention → Balance). Optimised for print/PDF.
4. **MIND BREEZE Homepage / Brochure** — Marketing surface (currently mindbreeze.kr) and a printed brochure / pitch deck that share the same visual language. Cream-warm background, large bold Korean type, white feature cards with lavender eyebrows.

---

## Index — what is in this folder

```
/
├── README.md                  · this file (high-level + content + visual foundations + iconography)
├── SKILL.md                   · Agent Skills wrapper — read first if you imported this folder as a Skill
├── colors_and_type.css        · all CSS variables (colors, type, radii, spacing, shadows) + drop-in element classes
├── assets/
│   ├── icons/                 · SVG icons lifted directly from mind-breeze-app
│   ├── images/                · product photography + sample report PNGs from the codebase
│   ├── logo_symbol_dark.svg   · the brain-wave "M" symbol (vector, copied from Figma /Branding/logo_signature_light)
│   ├── favicon_symbol.svg     · favicon variant of the symbol
│   └── brand_story_brainwaves.png · brainwave illustration from the brand story page
├── preview/                   · design-system cards rendered in the Design System tab (one HTML per concept)
├── ui_kits/
│   ├── app/                   · MIND BREEZE Operator app — iPad-shaped click-through
│   ├── homepage/              · marketing homepage UI kit
│   └── report/                · session report UI kit (mobile width, print-ready)
└── slides/                    · (none — no slide template was provided)
```

---

## CONTENT FUNDAMENTALS

MIND BREEZE writes in **Korean first**, with light English support for brand marks and section labels. The voice is **calm, professional, and gently scientific** — it sells expertise without sounding clinical or cold. The product is for grown-up practitioners (instructors, counsellors, corporate wellness contacts), not consumers, so copy avoids cuteness, exclamation marks, or emoji.

### Voice

- **Calm authority.** Sentences are short and declarative. The product is the expert; the reader does not need to be persuaded twice. e.g. "AI기반 뇌파 분석 기술로 명상하는 동안 뇌의 휴식 상태를 분석하고 피드백을 제공합니다."
- **Evidence-led.** Numbers are spoken out loud as proof: "14건의 관련 특허", "CES 2회 수상", "27,000건의 표준 뇌파 인지기능 데이터", "10,000 시간 분량의 기능적 뇌파 데이터". Pair every claim with a number when there is one.
- **Reader as professional, not patient.** The copy never says "you" in a hand-holding way. Marketing addresses "마인드브리즈" or "지도사"; the report addresses the participant by name ("채이서님") plus a date.
- **No exclamations, no questions, no emoji.** Section openers are nouns or noun phrases: "뇌과학 전문 기업", "인정받은 기술력", "신뢰할 수 있는 서비스". Buttons are imperatives in noun form: "LINK BAND 등록", "자리번호 입력하기", "Sign in with Google".

### Casing and bilingual style

- **Korean copy stays Korean.** When English appears, it is a brand name (MIND BREEZE, LINK BAND, Looxid Labs, CES) or a UI provider (Google, Apple). Treat brand marks as `MIND BREEZE` (two words, all caps) in print and `mind breeze` (two words, lowercase) in the logo lockup.
- **Mixed-language headings keep Korean first**: `LINK BAND 등록`, `Sign in with Google`. Never translate brand or device names.
- **Numerals are Arabic, even in Korean copy.** Use the comma-separated form: `27,000`, `10,000`.
- **Dates use `YYYY.MM.DD`**, e.g. `2024.12.04`.
- **No emoji, ever.** The brand uses purple eyebrow pills + Pretendard Bold to do the work emoji would do elsewhere.

### Example pairings (lifted from the product)

| Surface | Eyebrow | Headline | Body |
| --- | --- | --- | --- |
| Homepage card | `뇌과학 전문 기업` | `뇌파 특허 다수 보유` | `14건의 관련 특허 다수 출품 및 취득` |
| Homepage card | `인정받은 기술력` | `CES 2회 수상` | `세계 최대 규모의 전자박람회 CES에서 2018 최고혁신상, 2022 혁신상 수상` |
| Homepage card | `신뢰할 수 있는 서비스` | `27,000 ⁄ 10,000 AI` | `27,000건의 표준 뇌파 인지기능 데이터 ⁄ 10,000 시간 분량의 기능적 뇌파 데이터` |
| Report cover | `2024.12.04` | `두뇌건강\nAI 분석 리포트` | `채이서님` |
| App button | — | `LINK BAND 등록` / `자리번호 입력하기` | — |
| Sign-in | — | `Sign in with Google` ⁄ `Sign in with Apple` | — |

### When in doubt

Write fewer words. Lead with the proof. Stay in the third register — never "여러분!", never "✨". When a section feels empty without copy, add an image, a number, or a single capsule eyebrow — not filler text.

---

## VISUAL FOUNDATIONS

A complete picture of the brand's surface language. All tokens live in `colors_and_type.css`.

### Colour vibe

The palette is a **warm cream + deep purple** duality. The brand purple `#5F0080` is unusually deep and saturated for a wellness brand — it reads as scientific and trustworthy, not soft. It is paired against either pure white, a cream-beige (`#EBE6E2`) on marketing, or a near-white purple cream (`#F5EDFC`) on product surfaces. A bright lavender `#B373EF` and a softer pale `#D2AEFC` act as the supporting purples — pale especially for eyebrow capsules.

A single high-energy accent — electric **mint** `#01F0C8` — is used sparingly, almost exclusively in brainwave/data viz contexts. There is also a secondary "report" palette (mint, deep mint, pink, orange, yellow, green, khaki) which only appears inside the AI report's data charts; it is **not** a general UI palette. Use those colours only when visualising biomarkers.

Greys lean cool (`#F2F3F8`, `#DDDEE7`, `#A2A3AD`). Pure black is reserved for highest-contrast type. The brand's "black" is actually `#191A1E`.

### Type

- **Pretendard** is the brand and product face. Weights in active use: Medium (500), SemiBold (600), Bold (700), ExtraBold (800). Almost all UI uses 500 or 600.
- **Noto Sans KR** is the fallback / long-copy face — used in body paragraphs on the brochure and select figma callouts. Use Pretendard for headings and Noto Sans KR for long-form Korean body if needed.
- **Roboto / SF Pro** show up on system chrome inside iPad mockups — treat them as device defaults, not brand fonts.
- Type scale follows the codebase: **8/12/14/16/18/20/24/28/36/38/48/70/130** for the app, and a tighter semantic ramp for the report: **title 40 · sub-title 28 · heading 20 · label 16 · body 14 · caption 12** with negative letter-spacing on display sizes (`-0.0336em` at title) and slightly positive on body (`+0.0145em`).
- Line heights are generous: 22/14, 24/16, 26/18, 28/20, 32/24, 38/28, 44/36, 54/40.

### Spacing

App radii follow a clear scale: `12` for buttons, `16` for badges/wrappers, `22` for marketing cards, `24` for report cards, `42` for big branding panels, `48` for hero panels, `9999` for capsules. Padding is generous: hero cards use `38px` interior padding; marketing surfaces use 60–80px gutters on a 1920px stage.

### Backgrounds

- **Marketing**: warm cream `#EBE6E2` is the hero background. Cards float on top in pure white with `border-radius: 22px`.
- **App (operator)**: full-bleed photography (canyon, ocean, forest — see `assets/images/thumbnail*.jpg`) used as background during a meditation session, with white text and `rgba(255,255,255,0.2)` capsule buttons sitting on top. Otherwise white or `#F5EDFC` (purple cream) surface.
- **Brand**: purple `#5F0080` slabs with the symbol punched out in white, paired with cream or lavender.
- **Report**: pure white with thin lavender `1.6px` borders (`#9577D0`) around each major panel. Charts use the data palette.
- **Hand-drawn illustrations / repeating textures**: none. The brand is photographic + geometric, never illustrative.
- **Gradients**: none. The brand explicitly avoids gradients — solids only. (No bluish-purple gradients, no glassy gradients.)

### Imagery

- **Warm, painterly photography.** Landscape macros — slot canyons, ocean swells, soft sunlight. Always sits behind dark or coloured text, often with a `rgba(0,0,0,0.4)` scrim.
- **Brand visualisation**: long, sinuous purple brain-wave strokes (the symbol motif extracted and re-tiled). Lives on dark purple cards as a white-on-purple decorative.
- **AI Report Cover**: a 436×782 card with `#ECE6E2` cream background, large purple display copy `두뇌건강\nAI 분석 리포트`, the participant's name + date in mauve, and the wordmark at the bottom.

### Animation

- Sparingly used. Page-load fades (`opacity` + `translateY(8px)`) for marketing screens, `220ms` duration, `cubic-bezier(0.2,0.8,0.2,1)` easing.
- Button presses use a `scale(0.98)` shrink + a `120ms` colour darken. No bounce, no overshoot.
- Connection states (Link Band BLE) animate a small pulse on the icon when scanning.
- Avoid: long parallax, scroll-jacking, sliding carousels, particles.

### Hover / press states

- **Hover** on primary buttons darkens the purple from `#5F0080` to `#4C0066`. On soft purple buttons, deepen by ~1 step (`#D2AEFC` → `#D2BEFF`).
- **Hover** on ghost / outlined buttons fills with `#F5EDFC` (purple cream).
- **Press** shrinks to `scale(0.98)` and snaps to `#3A004F`.
- **Focus** uses a 2px lavender ring (`#B373EF`) with 2px offset. Never blue, never the system default.
- **Disabled** is `background:#DDDEE7; color:#A2A3AD;`.

### Borders + shadows

- **Borders** are 1px (occasionally 1.577px in branding) and either `#DDDEE7` (neutral) or `#9577D0` (lavender, for report panels and "framed" content).
- **Shadows** are subtle and warm-purple-tinted: `0 4px 24px rgba(0,0,0,0.05)` for cards, `0 8px 24px rgba(95,0,128,0.08)` for elevated brand surfaces, `0 24px 60px rgba(95,0,128,0.18)` for floating modal/dialog. Never use neutral grey shadows.
- The product prefers **capsule pill** treatment over translucent protection gradients. Inside hero photography, key actions sit inside a `rgba(255,255,255,0.2)` 12px-radius pill. There is no fade-to-black gradient overlay.

### Corner radii (in use)

| Element | Radius |
| --- | --- |
| Inputs / dense list items | 8 |
| Buttons (primary) | 12 |
| Badges / text radius wrapper | 16 |
| Marketing 4×3 / 16×9 cards | 22 |
| Report panels | 24 |
| Branding showcase panels | 42 |
| Hero panels (full-width) | 48 |
| Capsule pills / eyebrows | 9999 |

### Layout rules

- Marketing canvas is **1920 × variable** with a 60–80px outer gutter and a 30–40px gap between cards.
- Operator app canvas is **1366 × 1024** (iPad Pro 11 landscape) or 414×896 (phone). Action bar (BAND + 자리번호) is bottom-right, pill-shaped.
- Report canvas is **412 × variable** (mobile width) — designed to be paginated for PDF. Each section is its own page.
- Fixed elements: the operator app keeps the Link Band status pill always visible top-right or bottom-right. The session screen never hides it.

### Transparency / blur

- Used only on photographic backgrounds. The pill chrome is `rgba(255,255,255,0.2)` over the photo with no blur. The brand explicitly avoids backdrop-blur effects.

### Cards

- **Marketing card**: white background, 22px radius, no border, 38px padding, no shadow on the resting state. Inside: lavender pill eyebrow on top, 26/31 Pretendard Bold headline, 18/36 medium body.
- **Report card**: white background, 24px radius, 1.6px `#9577D0` border, no shadow.
- **Brand callout**: purple background, 48px radius, 40px padding, white symbol motif as decoration.

---

## ICONOGRAPHY

MIND BREEZE uses a **small, hand-curated SVG set** lifted straight from the React Native app. There is no icon font and no full Material/Heroicons import. Icons are **outline, 24×24, ~2px stroke** with rounded line caps; colour is inherited via `color` / `fill="currentColor"`.

### What lives in `assets/icons/`

Direct from `mind-breeze-app/src/assets/svg`:

| Asset | Purpose |
| --- | --- |
| `logo.svg` | full wordmark + symbol lockup (raster pattern — use sparingly; prefer `logo_symbol_dark.svg`) |
| `arrow_back.svg` / `arrow_forward.svg` | nav chevrons |
| `ble_connected.svg` / `ble_disconnected.svg` | Link Band BLE state |
| `circle_checked.svg` / `circle_unchecked.svg` | consent and selection |
| `close.svg` | modal dismiss |
| `icon_apple.svg` / `icon_google.svg` | SSO providers |
| `thumbs_up.svg` / `thumbs_down.svg` (+ selected) | post-session feedback |

Brand-level symbols from Figma:

| Asset | Purpose |
| --- | --- |
| `assets/logo_symbol_dark.svg` | the brain-wave "M" symbol, vector (the heart of the brand) |
| `assets/favicon_symbol.svg` | favicon variant of the same symbol |
| `assets/brand_story_brainwaves.png` | brainwave illustration used on the branding page |

### Rules

- **Prefer the codebase SVG**. When you need a new icon (e.g. settings, calendar, user), substitute the **Lucide** equivalent at `stroke-width: 2`, rounded caps and joins — it matches the existing set's visual weight. Document the substitution where you used it.
- **Never use emoji or unicode pictographs** as icons. Not in marketing, not in app, not in the report.
- **Never invent SVG by hand**. If the codebase does not have it and Lucide does not have a near match, copy a real source icon and credit it; otherwise leave a placeholder square.
- Logo: the wordmark is two words `mind` + `breeze`, lowercase. The symbol can stand alone (favicon, app icon, decorative). The signature lockup is the symbol + wordmark — see Figma `/Branding/logo_signature_light` and `/Branding/logo_mono_dark`.
- Logo colour: brand purple `#5F0080` on light, white on dark, mauve `#A775D6` for the optional "ko-tagline" sub-line.

### CDN fallback

If you need to load Lucide from CDN inside a prototype:

```html
<script src="https://unpkg.com/lucide@latest"></script>
<i data-lucide="settings"></i>
<script>lucide.createIcons();</script>
```

**Font substitution note.** Pretendard is loaded from jsDelivr (`orioncactus/pretendard` v1.3.9 — the official CDN). Noto Sans KR is loaded from Google Fonts. If you need the brand's exact `.ttf` / `.woff2` files for offline use, ask for them — the project ships from CDN by default. Roboto / SF Pro show up in some Figma mocks as system chrome — treat them as the platform default, not brand fonts.

---

## How to use this system

If you are **mocking**, drop `colors_and_type.css` into your HTML's `<head>` and use the CSS variables + element classes directly. Pull components from `ui_kits/<product>/` for product-shaped surfaces; pull patterns from `preview/` cards for tokens.

If you are **shipping production code**, lift from the source repos linked above rather than reinventing here — but use this folder to onboard, audit and review.

See **SKILL.md** for how to use this as an Agent Skill.
