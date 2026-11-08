---
name: a11y-audit
description: Audit and fix web accessibility with automated open-source tools (axe-core plus a real keyboard walk), mapped to WCAG 2.2 A/AA. Use when the user asks for an accessibility / a11y / WCAG / ADA / Section 508 audit, says screen reader or keyboard users have problems, mentions contrast, alt text, labels, focus, ARIA or landmarks, or wants accessibility issues found, fixed or reported in a front-end project.
---

# Accessibility audit → fix → verify

You run axe-core and a keyboard walk, fix issues at their source with semantic HTML first,
re-run to prove the fixes, and report — including what automation cannot check.

Scripts: `${CLAUDE_SKILL_DIR}/scripts/`. Fix patterns by rule id: `${CLAUDE_SKILL_DIR}/references/wcag-fix-playbook.md`.
If a script exits with "Missing dependency", run the `npm install --prefix …` command it prints, then retry.

## 1. Target

Static site or built output → `--dir <folder>` (add `--pages` for more pages). Running app →
start it (dev server is fine for a11y) in the background and pass `--url` for each key page/state.
Audit the states that matter too: open menus/dialogs, form error states (use `--url` with a
route or query that renders them, or describe them as manual checks).

## 2. Baseline

```bash
node ${CLAUDE_SKILL_DIR}/scripts/a11y-audit.mjs --dir <folder> --label baseline
node ${CLAUDE_SKILL_DIR}/scripts/a11y-audit.mjs --dir <folder> --label baseline-mobile --viewport 390x844
```

Read `audit-reports/a11y/<label>/summary.md`: axe violations by impact with selectors, HTML
snippets and WCAG criteria; keyboard walk (tab order, missing focus indicators, focus traps,
obscured focus, focusable elements without a role); mouse-only "clickable" elements; items
axe could not decide.

## 3. Triage

For each finding: find the source (grep the snippet's ids/classes/text; in components, the
component that renders it), name the WCAG criterion, and decide the fix with the playbook.
Then check the things axe **passes but are still wrong** — the summary will not show them:
- Placeholder-only form fields: axe accepts a placeholder as a name, WCAG 3.3.2 still needs a
  visible, persistent `<label>`.
- Alt text that exists but is meaningless (`alt="image"`, file names) or decorative images with
  descriptive alt (should be `alt=""`).
- Generic link text ("click here", "read more") without context.
- Visible label text that differs from the accessible name (2.5.3).
- Status/error messages that are not announced (need `role="status"`/`aria-live` or focus management).

## 4. Fix (skip if the user asked for a report only)

Order: critical → serious → keyboard/focus → moderate → minor. Principles:
1. **Native HTML before ARIA.** `<button>` not `<div onclick>`; `<a href>` for navigation;
   `<label for>`; `<nav>/<main>/<header>/<footer>` for landmarks; real headings in order.
   Only add ARIA when no native element fits, and then follow the WAI-ARIA APG pattern.
2. **Never silence the tool.** No `aria-hidden` on content people need, no `role="presentation"`
   on meaningful elements, no `tabindex="-1"` to dodge focus checks, no `outline: none` without a
   visible `:focus-visible` replacement.
3. **Contrast:** keep the design's hue, change lightness until it passes (4.5:1 text, 3:1 large
   text/UI components/focus indicators). Check both text-on-background and states (hover, disabled is exempt).
4. **Keep behaviour identical** for mouse users; add keyboard parity (Enter/Space on buttons
   comes free with `<button>`).
5. Don't remove zoom (`user-scalable=no`, `maximum-scale=1`), don't use positive `tabindex`.

## 5. Verify

```bash
node ${CLAUDE_SKILL_DIR}/scripts/a11y-audit.mjs --dir <folder> --label after --compare baseline
```

Target: zero critical/serious violations, no keyboard issues, no mouse-only clickables. Read the
"Resolved/New rules" lines; a fix must not introduce new violations. Re-check the
"passes-but-wrong" list from step 3 by reading the changed markup.

## 6. Report

Write `audit-reports/a11y/REPORT.md` (or where the user asked):

```markdown
# Accessibility report — <page(s)>, <date>
## Summary
axe: <critical/serious/moderate/minor before → after>. Keyboard issues <before → after>. Standard: WCAG 2.2 AA.
## Fixed
| # | Issue | WCAG | Element / file | Fix |
## Remaining / needs a decision
| Issue | WCAG | Why not fixed | Suggested fix |
## Manual testing still required
Screen reader pass (NVDA/VoiceOver), 200%/400% zoom and 320px reflow, reduced motion, custom
widget keyboard patterns, content quality of alt text and labels.
```

Automated checks cover roughly a third of WCAG. Never call a page "accessible" or "compliant"
based on this audit alone; say "no automatically detectable violations remain".
