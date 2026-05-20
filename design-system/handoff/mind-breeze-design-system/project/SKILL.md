---
name: mind-breeze-design
description: Use this skill to generate well-branded interfaces and assets for MIND BREEZE (Looxid Labs' brain-science meditation platform — operator app, admin web, AI report and marketing surfaces), either for production or throwaway prototypes / mocks / decks. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# MIND BREEZE Design Skill

Read **README.md** in this skill first — it covers the full brand: content fundamentals, visual foundations and iconography. Then explore the other files:

- `colors_and_type.css` — drop into any HTML `<head>`; all CSS variables, type scale and base element classes ready to use.
- `assets/icons/` — outline SVG icon set lifted from the production app. Always prefer these over re-drawing.
- `assets/images/` — photography, sample report images, device renders from the codebase.
- `assets/logo_symbol_dark.svg` — the brain-wave "M" symbol (vector). Use this, not a raster wordmark.
- `preview/` — design-system cards (one HTML per token cluster) — quick visual reference.
- `ui_kits/app/`, `ui_kits/homepage/`, `ui_kits/report/` — high-fidelity product recreations with JSX components and `index.html` demos.

## How to use this skill

If creating **visual artifacts** (slides, mocks, throwaway prototypes), copy `colors_and_type.css` and any needed assets out into your output, and build static HTML referencing them. Use the components in `ui_kits/<product>/` as starting points — they are intentionally simple and cosmetic, easy to remix.

If working on **production code**, the source of truth is not this folder — it is the repos in `LooxidLabs/` (mind-breeze-app, mind-breeze-admin, mind-breeze-report). Use this folder to align on tokens, then lift the real component implementations from those repos.

If the user invokes this skill without any other guidance, ask them what they want to build or design — surface (app screen, marketing page, report, slide deck), audience (instructor, participant, partner), and tone (product vs marketing). Then act as an expert MIND BREEZE designer outputting either HTML artifacts or production code, depending on the need.

## Hard rules — do not violate

- **No emoji, anywhere.** Use the lavender eyebrow pill pattern (`<span class="mb-eyebrow">…</span>`) instead.
- **No gradients.** The brand is solids-only — flat purple, flat cream, flat white. Never bluish-purple gradients.
- **No hand-drawn SVG.** Use `assets/icons/` first; substitute Lucide (`stroke-width: 2`) for what is missing. Document substitutions.
- **Korean copy stays Korean** — only translate brand marks (MIND BREEZE, LINK BAND, Looxid Labs).
- **Numbers are proof**: when you make a claim, attach a number. The brand does this consistently (14건의 특허, CES 2회, 27,000건, 10,000시간).
- **Dates are `YYYY.MM.DD`** — never `MM/DD/YYYY` or `Dec 4, 2024`.
- **Pretendard for everything UI**, Noto Sans KR for long-form Korean body when present. No Inter, no Roboto-for-brand.
