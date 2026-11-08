---
name: layout-audit
description: Audit visual layout and usability across mobile, tablet and desktop viewports — horizontal overflow, broken reflow, tiny or crowded tap targets, overlapping or clipped content, unreadable text, distorted images, banners covering the screen — using Playwright measurements plus annotated screenshots you inspect visually, then fix the responsive CSS/markup. Use when the user says a page looks broken, misaligned or cramped, has responsive or mobile layout problems, asks for a UX/usability/visual review or heuristic evaluation, or wants layout issues found, fixed or reported.
---

# Layout & usability audit → fix → verify visually

Two complementary passes: **geometry** (the script measures every element at several
viewports) and **eyes** (you look at the screenshots). Both are required; the script cannot judge
hierarchy or clarity, and you cannot measure 24px gaps by eye.

Scripts: `${CLAUDE_SKILL_DIR}/scripts/`. References: `${CLAUDE_SKILL_DIR}/references/responsive-patterns.md`
(fixes) and `${CLAUDE_SKILL_DIR}/references/usability-heuristics.md` (visual review rubric).
If a script exits with "Missing dependency", run the `npm install --prefix …` command it prints, then retry.

## 1. Target

Static site/build output → `--dir <folder>` (+ `--pages`). Running app → start it in the
background and pass `--url` per page. Default viewports: 320×640 (reflow/zoom proxy), 390×844
(phone), 768×1024 (tablet), 1440×900 (desktop); widths < 768 are emulated as touch devices.

## 2. Baseline

```bash
node ${CLAUDE_SKILL_DIR}/scripts/layout-audit.mjs --dir <folder> --label baseline
```

Read `audit-reports/layout/baseline/summary.md`: per-viewport findings with selectors, sizes,
positions and annotation numbers; plus the type/spacing scale check.

Then **look at the screenshots** with the Read tool — at least the annotated phone and desktop
captures (`screenshots/*-annotated.png`; red = high, orange = medium, blue = low). The plain
captures show the real design. Evaluate them against the rubric in `usability-heuristics.md`
(hierarchy, alignment, spacing rhythm, typography, responsiveness, affordances, above-the-fold
content) and note concrete observations ("the pricing cards are cut off at 390px", "three
competing primary buttons in the hero").

## 3. Triage

Fix root causes, not symptoms. Usually:
- One wide element (fixed `width`, `white-space: nowrap`, unconstrained image/table/pre, long URL)
  causes all horizontal overflow — fix it and re-run before chasing anything else (an
  overflowing page also makes mobile browsers zoom out, which distorts the other findings).
- Overlaps are usually negative margins, absolute positioning, or fixed heights.
- Clipped text is usually a fixed `height` with `overflow: hidden`.
Map each finding to the CSS rule/component (grep the selector's classes) and pick the pattern
from `responsive-patterns.md`.

## 4. Fix (skip if the user asked for a review only)

- Mobile-first, intrinsic layouts: `max-width: 100%` on media, `flex-wrap`/grid
  `repeat(auto-fit, minmax(…))`, `clamp()` for type, `min-height` instead of `height` for text boxes.
- Touch targets ≥ 24×24 CSS px with spacing (WCAG 2.5.8 AA); aim for 44×44 on primary controls.
  Grow the hit area with padding/min-height — not by enlarging the font.
- Text ≥ 12px everywhere, 16px body on mobile; `line-height` ≥ 1.4 for paragraphs; measure ≤ ~75ch.
- Images: `height: auto` or `aspect-ratio` + `object-fit: cover` — never stretch.
- Fixed/sticky UI (headers, cookie and chat widgets) must leave the content usable on a phone:
  compact, dismissible, not covering more than ~25% of the viewport.
- Preserve the design intent (colors, brand, content). Do not delete content to make it fit.

## 5. Verify

```bash
node ${CLAUDE_SKILL_DIR}/scripts/layout-audit.mjs --dir <folder> --label after --compare baseline
```

No horizontal overflow at any viewport, no high/medium findings left unexplained. Look at the
new screenshots (especially 320 and 390 wide) and confirm the layout reads well, not just that the
numbers dropped. For pure CSS refactors that should not change appearance, the css-audit skill's
`visual-diff.mjs` gives a pixel diff.

## 6. Report

Write `audit-reports/layout/REPORT.md` (or where the user asked):

```markdown
# Layout & usability report — <page(s)>, <date>
## Summary
Findings by severity before → after; viewports tested; overall verdict.
## Fixed
| # | Issue | Viewport(s) | Cause (file:selector) | Fix |
## Visual review (from screenshots)
Heuristic observations with screenshot references, each with a recommendation; mark which were addressed.
## Remaining recommendations
| Priority | Recommendation | Rationale |
```

Reply with the key before/after numbers, the most important visual observations, and the
report path.
