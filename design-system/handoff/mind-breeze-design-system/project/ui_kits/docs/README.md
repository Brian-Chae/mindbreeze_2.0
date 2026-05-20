# Document Kit — MIND BREEZE

Print-ready document templates for product introduction brochures, sales decks, and operator handouts. Each page is fixed at **A4 portrait (794 × 1123 px @ 96 dpi)** and follows the same brand grid: 48 px outer margin, 64 px inner gutter on content pages, header + footer chrome on body pages, full-bleed on covers and chapter dividers.

## Pages

| File | Purpose |
| --- | --- |
| `DocPage.jsx` | Shell. Header (logo + chapter eyebrow), footer (copyright + page no.), `bleed` and `hideChrome` props for cover-style pages. |
| `CoverPage.jsx` | Full-bleed brand-purple cover. Title block bottom-aligned, doc-type label top-right. |
| `TOCPage.jsx` | Table of contents — numbered rows with page numbers, first item accented in brand purple. |
| `SectionDividerPage.jsx` | Cream chapter divider. Big numeral + chapter title + intro paragraph. Re-usable for every chapter. |
| `ContentPage.jsx` | Two-column body page (prose + figure). Default workhorse layout. |
| `FeatureGridPage.jsx` | 4-up feature grid in lavender-cream tiles. |
| `StatsPage.jsx` | Cream background, three large stat callouts in white cards. |
| `QuotePage.jsx` | White page with large pull quote and attribution. |
| `BackCoverPage.jsx` | Closing CTA + contact grid + purple footer band. |

## Usage

Open `index.html` — all pages stack vertically with a floating navigator on the right.

`SectionDividerPage` accepts props (`number`, `eyebrow`, `title`, `body`, `pageNo`) so the same component renders every chapter divider. The other pages are demonstrative — duplicate and edit content directly for additional pages.

## Print

To export as PDF, open `index.html`, press ⌘P / Ctrl+P, set paper size to A4, margins to "None". Each `DocPage` is sized to a full A4 sheet — the browser will paginate one page per sheet.

## Not yet covered

- Full-bleed photo page (hero image + caption strip)
- Spec / comparison table page
- Index / glossary page
- Two-page spread layout (left-right composition)

Ask if you need any of those, or any other document layout we should add.
