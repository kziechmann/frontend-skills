---
name: perf-audit
description: Measure and improve web page performance with Lighthouse, then fix the code that causes it. Use when the user says a page or site is slow, asks for a Lighthouse / PageSpeed / Core Web Vitals audit, wants to improve LCP, CLS, INP, TBT, FCP, load time, bundle size, image weight or render-blocking resources, or asks for a performance report or optimization suggestions for a front-end project.
---

# Performance audit → fix → verify

You measure with Lighthouse, map every finding to the code that causes it, fix what is
safely fixable, re-measure, and write a report. Numbers drive decisions; never guess.

Scripts: `${CLAUDE_SKILL_DIR}/scripts/`. Fix patterns: `${CLAUDE_SKILL_DIR}/references/optimization-playbook.md`.
If a script exits with "Missing dependency", run the `npm install --prefix …` command it prints, then retry.

## 1. Pick what to measure

| Project shape | Target |
| --- | --- |
| Plain HTML/CSS/JS, or a built output folder (`dist/`, `build/`, `out/`) | `--dir <folder>` (served locally, gzip on) |
| App with a build step (Vite, Next, Nuxt, Angular, SvelteKit, Astro…) | Build for production first, then `--dir <output>` or start the preview/production server in the background and use `--url` |
| A deployed URL the user gave you | `--url <url>` |

Never measure a dev server (unminified code, HMR, source maps): the numbers mean nothing.
Audit the pages the user cares about; add `--pages a.html,b.html` or repeat `--url`.

## 2. Baseline

```bash
node ${CLAUDE_SKILL_DIR}/scripts/lighthouse-audit.mjs --dir <folder> --label baseline
```

Options: `--preset desktop`, `--runs 3` (median; use it when deltas matter), `--categories performance,best-practices`.
Read `audit-reports/perf/baseline/summary.md`. It lists scores, Core Web Vitals, the LCP
element, and failing audits ranked by estimated impact, each with offending URLs/elements
and the `source:` file they map to. Do not read the raw `*.lighthouse.json` unless you need
a detail the summary omits (it is several MB).

## 3. Triage before touching code

For each failing audit, highest impact first:
1. **Locate the cause.** Use the `source:` path, or grep the repo for the URL path, selector,
   class names or snippet. In frameworks, find the component/route/config that emits it.
2. **Classify it:** code (markup, JS, CSS, component) · asset (image/font/video weight) ·
   build config (bundling, minification, code-splitting) · infrastructure (caching headers,
   compression, HTTP/2, CDN, TTFB) · third-party script.
   Findings under "Environment-dependent" come from the local audit server: report them as
   checks to do in production, do not "fix" them in code.
3. **Pick the fix** from the playbook (indexed by audit id, with framework notes).

Write a short plan (finding → cause → file → fix → expected metric) before editing.

## 4. Fix (skip if the user asked for a report or suggestions only)

- Work highest-impact first; keep each change small and behavior-preserving. Same content,
  same visuals, same functionality.
- Typical wins, in rough order: un-block rendering (`defer`/`async`/`type=module`, remove
  `@import` chains, inline only truly critical CSS); make the LCP element discoverable and
  prioritized (no `loading="lazy"` on it, `fetchpriority="high"`, preload when injected late);
  reserve space for anything that loads late (`width`/`height` on media, `aspect-ratio`,
  min-height for injected banners) to kill CLS; lazy-load below-the-fold media; cut main-thread
  work (defer non-critical init to idle time, break up long tasks, avoid layout thrashing);
  remove unused JS/CSS (drop dead dependencies, code-split routes, tree-shake imports).
- Images: if an encoder is available (`sharp`, `cwebp`, `avifenc`, ImageMagick, Pillow), you
  may re-encode/resize and add `srcset`/`sizes`; keep the originals. If none is available,
  recommend the exact change instead of faking it.
- Never game the metric: no hiding content from first render, no user-agent sniffing for
  Lighthouse, no removing features or content, no artificially delaying everything until
  after the measurement window.
- Do not add dependencies or change infrastructure without asking.

## 5. Verify

```bash
node ${CLAUDE_SKILL_DIR}/scripts/lighthouse-audit.mjs --dir <folder> --label after --compare baseline
```

The summary shows before/after deltas plus resolved and new audits. Confirm the targeted
metrics moved and nothing regressed. Lab scores vary by ±5 points between runs; use
`--runs 3` on both labels before claiming a small win. If something did not improve, find
out why (wrong cause? masked by a bigger bottleneck?) rather than declaring success.

## 6. Report

Write `audit-reports/perf/REPORT.md` (or wherever the user asked) with:

```markdown
# Performance report — <page(s)>, <date>
## Summary
Performance <before> → <after> (mobile, Lighthouse <version>, <runs> runs). LCP …, CLS …, TBT …, FCP …
One-paragraph diagnosis: what was slow and why.
## Changes made
| # | Finding (audit id) | Root cause (file:line) | Change | Measured effect |
## Recommended next steps (not applied)
| Priority | Recommendation | Why not applied (infra / needs assets / product decision) | Expected effect |
## How to verify
Exact commands; note lab vs field (CrUX/RUM) differences and environment-dependent findings.
```

Then give the user a short summary: before/after numbers, the top changes, what is left, and
the report path. If you only produced suggestions, say so explicitly.
