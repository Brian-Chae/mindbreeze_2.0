# MIND BREEZE — AI Report UI Kit

A click-through recreation of the post-session **두뇌건강 AI 분석 리포트** (Brain Health AI Analysis Report). Based on the `mind-breeze-report` Next.js viewer and the Figma `/Report` page.

Design canvas: **412 × variable** (mobile portrait, also rendered to PDF). Each section is its own scrolling block; white panels with lavender (`#9577D0`) 1.6px borders are the dominant motif.

## Sections (mirrors the codebase order)

1. **Cover** — cream card with purple display copy, participant name, date, brand symbol
2. **Introduction** — what the report measures
3. **Summary** — top-level score wheel + biomarker capsules
4. **Stress** — stress index gauge + interpretation
5. **Attention** — attention curve over time
6. **Balance** — α/β balance bars

## Files

- `index.html` — assembled report with section anchors + scroll
- `Cover.jsx` — top cover card
- `Section.jsx` — generic section header + body wrapper
- `Gauge.jsx` — semicircular gauge for scores 0–100
- `BarChart.jsx` — horizontal bar chart for biomarker comparison
- `LineChart.jsx` — line chart over time for attention/relaxation
