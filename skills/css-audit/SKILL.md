---
name: css-audit
description: Audit CSS/SCSS for correctness, maintainability and modern best practices (stylelint, Project Wallace analyzer, pattern checks, unused-CSS coverage), then refactor safely with screenshot-based visual regression checks. Use when the user asks to review, clean up, refactor, modernize or lint stylesheets, complains about specificity wars, !important, messy or duplicated CSS, inconsistent colors/spacing/fonts, wants design tokens or CSS custom properties, or asks for CSS best practices or a CSS quality report.
---

# CSS audit → refactor → prove nothing broke

You measure the stylesheet health, refactor in a safe order, and prove with pixel diffs that
the UI did not change unintentionally. CSS refactors are judged by two things: the metrics
improve **and** the screenshots match (except for intended fixes).

Scripts: `${CLAUDE_SKILL_DIR}/scripts/`. Patterns and rationale: `${CLAUDE_SKILL_DIR}/references/css-patterns.md`.
If a script exits with "Missing dependency", run the `npm install --prefix …` command it prints, then retry.

## 1. Understand the project's CSS setup first

Look before you lint: plain CSS, SCSS/Sass, CSS Modules, Tailwind, CSS-in-JS
(styled-components/emotion), a design system or tokens file, PostCSS/autoprefixer and
`browserslist`, naming convention (BEM, utility-first). Fixes must follow the conventions the
project already uses. The audit analyzes `.css`/`.scss` files; for CSS-in-JS or Tailwind,
audit the generated CSS (build output) with `--src dist` and fix the source that produced it.

## 2. Baseline: screenshots + metrics

```bash
# Visual baseline (before ANY change). --dir <site root or build output> or --url <running app>
node ${CLAUDE_SKILL_DIR}/scripts/visual-diff.mjs --dir <site> --label baseline
# Static analysis of sources (+ optional runtime unused-CSS coverage with --dir/--url)
node ${CLAUDE_SKILL_DIR}/scripts/css-audit.mjs --src <css-dir> --dir <site> --label baseline
```

Read `audit-reports/css/baseline/summary.md`: stylelint **errors** (invalid/ignored CSS — real
bugs), **warnings** (maintainability: IDs, specificity, `!important`, prefixes, qualifying
selectors), pattern checks (`@import` chains, removed focus outlines, `transition: all`,
animating layout properties, float layouts, px font sizes, z-index escalation, missing
`prefers-reduced-motion`), design-token health (unique/near-duplicate colors, font sizes,
z-index values) and unused CSS on the audited pages.

## 3. Plan

Group findings into the order below and note, for each, whether the visual result should stay
identical or intentionally change (a typo'd property that never applied will change the UI
once fixed — that is a bug fix; call it out).

## 4. Refactor (skip if the user asked for a review only) — in this order

1. **Correctness errors:** typos (`colr`), invalid values (`#ggg`), duplicate properties,
   shorthand overriding longhand, missing generic font family, empty rules.
2. **Accessibility in CSS:** replace `outline: none` with a visible `:focus-visible` style; add
   `@media (prefers-reduced-motion: reduce)`; font sizes in `rem`.
3. **Tokens:** introduce custom properties (in the project's tokens file or `:root`) for
   colors, radii, shadows, z-index, font sizes, spacing; merge near-duplicate colors into one
   token; replace literals with `var(--…)`.
4. **Specificity:** replace ID and over-qualified selectors with single classes (update the
   HTML/components — grep every usage, including JS/tests that query them); flatten deep
   descendant chains; remove `!important` by fixing specificity/order. Keep `!important` only
   in utilities and reduced-motion overrides.
5. **Modern layout:** floats/clearfix → flexbox/grid; margin hacks → `gap`; fixed widths →
   intrinsic sizing (`minmax`, `clamp`, `max-width`).
6. **Cleanup:** vendor prefixes (if autoprefixer/browserslist exists or targets are modern),
   `transition: all` → explicit properties, layout-property animations → `transform`/`opacity`,
   dead rules confirmed unused across all pages/templates (grep before deleting), `@import` →
   `<link>`/bundler imports.

Keep diffs reviewable: one category at a time, no unrelated reformatting.

## 5. Verify

```bash
node ${CLAUDE_SKILL_DIR}/scripts/css-audit.mjs --src <css-dir> --dir <site> --label after --compare baseline
node ${CLAUDE_SKILL_DIR}/scripts/visual-diff.mjs --dir <site> --label after --compare baseline
```

- stylelint errors must be 0; warnings, IDs, specificity, `!important`, colors should drop.
- Open every `*.diff.png` that reports changes (red = changed pixels) and the matching
  screenshots. Each visible change must be intended (e.g. a fixed typo) and explained; otherwise
  fix the regression and re-run. Small sub-pixel/antialiasing noise is fine.

## 6. Report

Write `audit-reports/css/REPORT.md` (or where the user asked):

```markdown
# CSS report — <scope>, <date>
## Summary
Key metrics before → after (errors, warnings, !important, ID selectors, max specificity, unique colors, tokens).
## Changes
| # | Category | Finding | Change | Files |
## Visual regression check
Screenshots compared (viewports), result, and every intentional visual change with its reason.
## Recommendations not applied
| Recommendation | Why not (needs design decision / risky / out of scope) |
```

Reply with the headline numbers, the visual-diff verdict, and the report path.
