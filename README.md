# frontend-skills

Claude Code skills and evals for common front-end engineering tasks. Each skill runs
established open-source tooling, condenses the output into something an LLM can act on, maps
findings to the code that causes them, applies (or suggests) fixes, **re-measures**, and writes a
report.

| Skill | Tooling | Finds | Verifies with |
| --- | --- | --- | --- |
| [`perf-audit`](skills/perf-audit/SKILL.md) | Lighthouse 13 | Core Web Vitals, render-blocking resources, LCP discovery, CLS culprits, long tasks, unused JS/CSS, image delivery | Before/after Lighthouse deltas (median of N runs) |
| [`a11y-audit`](skills/a11y-audit/SKILL.md) | axe-core 4 + Playwright keyboard walk | WCAG 2.2 A/AA violations, missing focus indicators, focus traps, obscured focus, mouse-only controls | Before/after violation counts; resolved/new rules |
| [`css-audit`](skills/css-audit/SKILL.md) | stylelint (curated config), Project Wallace analyzer, pattern checks, Chromium CSS coverage | Invalid CSS, specificity/ID selectors, `!important`, prefixes, float layouts, motion/focus issues, color & type sprawl, unused CSS | Metric deltas **plus pixel diffs** (`visual-diff.mjs`) so refactors don't change the UI |
| [`layout-audit`](skills/layout-audit/SKILL.md) | Playwright geometry checks at 4 viewports + annotated screenshots | Horizontal overflow/reflow, tap-target size & spacing, overlaps, clipped text, tiny text, distorted images, banners covering the screen, line length | Before/after finding counts; agent reviews the screenshots against a heuristics rubric |

Every skill follows the same loop:

```
measure (baseline) ─► triage: finding → root cause → file ─► fix (unless "report only")
        ▲                                                         │
        └──────────── re-measure with --compare baseline ◄────────┘ ─► REPORT.md
```

## Install

**As a plugin (recommended).** Once this lives in its own GitHub repo:

```text
/plugin marketplace add <owner>/frontend-skills
/plugin install frontend-skills@frontend-skills
```

or load it from a checkout: `claude --plugin-dir /path/to/frontend-skills`.

**Dependencies.** The audit scripts need Node ≥ 20 and Chrome/Chromium:

```bash
cd /path/to/frontend-skills
npm install
npx playwright install chromium   # installs Chromium + chrome-headless-shell
```

The scripts prefer Playwright's `chrome-headless-shell` when it is installed (it also runs inside
sandboxes that block Unix sockets, such as the `claude plugin eval` sandbox on Linux), then fall back
to Playwright's Chromium, `CHROME_PATH`, or a system Chrome. Override with `FRONTEND_AUDIT_CHROME`
or `--chrome <path>`.

If dependencies are missing, the scripts print the exact `npm install --prefix …` command and the
skills tell Claude to run it.

## Use

Just ask; the skill descriptions trigger on natural requests:

- "Our landing page is slow on phones — figure out why and fix it."
- "Audit the signup page for accessibility and fix what you can."
- "Clean up `src/styles` — it's full of `!important` and IDs. Don't change how anything looks."
- "The pricing page looks broken on mobile."
- "Give me performance recommendations for `dist/`, but don't change anything."

Results land in the project you are working on:

```
audit-reports/
  perf/   baseline/ after/  summary.md  summary.json  *.lighthouse.{json,html}   REPORT.md
  a11y/   baseline/ after/  summary.md  summary.json                            REPORT.md
  css/    baseline/ after/  summary.md  summary.json  visual/{baseline,after}/*.png|*.diff.png  REPORT.md
  layout/ baseline/ after/  summary.md  summary.json  screenshots/*-annotated.png  REPORT.md
```

`summary.md` is the compact, LLM-friendly digest (read first); `summary.json` is machine-readable;
`REPORT.md` is the human-facing write-up the agent produces. Add `audit-reports/` to `.gitignore`
if you don't want to commit them.

### Running the scripts yourself

```bash
node skills/perf-audit/scripts/lighthouse-audit.mjs --dir dist --label baseline --runs 3
node skills/perf-audit/scripts/lighthouse-audit.mjs --url https://example.com --preset desktop
node skills/a11y-audit/scripts/a11y-audit.mjs --dir . --pages index.html,signup.html --viewport 390x844
node skills/css-audit/scripts/css-audit.mjs --src src/styles --dir dist --label baseline
node skills/css-audit/scripts/visual-diff.mjs --dir dist --label after --compare baseline
node skills/layout-audit/scripts/layout-audit.mjs --url http://localhost:4173 --viewports 320x640,390x844,1440x900
```

All scripts share `--url` (repeatable) / `--dir` + `--pages`, `--out`, `--label`, `--compare <label>`,
`--chrome`, and `--help`.

## Evals

The suite under [`evals/`](evals) uses the native `claude plugin eval` format (`case.yaml` per case).
It measures whether the skills make Claude better at these tasks, not just whether they run.

| Case | What it checks |
| --- | --- |
| `perf-fix`, `a11y-fix`, `css-refactor`, `layout-fix` | Full loop on a fixture site seeded with realistic defects: deterministic regex graders on the fixed source (e.g. "no blocking `<script>` in `<head>`", "every `<img>` has `alt`", "no ID selectors", "pricing table is not fixed-width"), guard graders that content wasn't deleted, LLM-judged graders for root-cause fixes, re-measurement and report quality |
| `perf-report-only` | Respects "don't change anything": no edits, files unchanged, report is evidence-based and prioritized |
| `trigger-*` | A natural request loads the right skill without naming it |
| `no-trigger-copy-edit` | A trivial edit does **not** load an audit skill (over-triggering guard) |

By default the harness runs a **with/without ablation**: each case also runs without the plugin,
and the score delta is the skill's measurable value. Graders that only make sense with the plugin
(e.g. "ran `lighthouse-audit.mjs`") are marked `arm: with-only` and reported as indicators, not
scored.

```bash
npm run eval          # full suite: --scaffold --allow-tools Bash Write Edit --trust-plugin
npm run eval:quick    # 1 run per case, no baseline arm
claude plugin eval . --scaffold --allow-tools Bash Write Edit --trust-plugin --tag a11y
claude plugin eval . --scaffold --allow-tools Bash --trust-plugin --tag trigger --ablation none
```

Requirements: everything under Install, plus the harness sandbox on Linux
(`apt install bubblewrap socat`).

> **Linux gotcha:** the harness creates each run's workspace under `os.tmpdir()` and also puts
> `/tmp` on the sandbox's write-deny list, so with the default `TMPDIR=/tmp` shell commands see a
> read-only workspace (the audit scripts can't write `audit-reports/`, builds fail). Point
> `TMPDIR` somewhere else when running evals — the npm scripts do this for you:
> `TMPDIR="$HOME/.cache/claude-eval-tmp" claude plugin eval …`

`--scaffold` is needed because each case's `scaffold.sh` copies
its fixture into the run's workspace (the perf fixture generates its heavy images and bundles at
stage time so they aren't committed). Fix cases are long agent runs; use `--runs`, `--case`,
`--tag` and `--max-cost-usd` to control spend.

### Testing the tools and the graders (no agent, no API key)

```bash
npm test
```

- `test/eval-cases.test.mjs` checks every `case.yaml`, then stages each fixture and asserts that
  every deterministic grader **fails on the broken fixture** and **passes on the reference
  solution** in `evals/solutions/`, plus alternative valid fixes — so graders reward the fix, not a
  particular spelling of it.
- `test/audit-scripts.test.mjs` runs each audit script against the fixtures (real Chrome) and
  asserts the seeded defects are detected and reported as resolved after the solution is applied
  (`SKIP_LIGHTHOUSE=1` skips the slow Lighthouse test).

### Adding a case

1. Put a small site with seeded defects in `evals/fixtures/<name>/` and its fixed version (changed
   files only) in `evals/solutions/<name>/`.
2. Create `evals/<case>/scaffold.sh` (copy an existing one, change the fixture name) and
   `evals/<case>/case.yaml`. Prefer deterministic `regex`/`file_exists` graders on workspace files;
   name guard graders `preserve-*`; use `llm` graders for judgment calls; mark plugin-only signals
   `arm: with-only`; give `tool_used` graders with `max: 0` an explicit `min: 0`.
3. `npm test` — the self-test will tell you if a grader can't tell broken from fixed.

## Layout

```
.claude-plugin/        plugin.json, marketplace.json
skills/
  perf-audit/          SKILL.md, scripts/lighthouse-audit.mjs, references/optimization-playbook.md
  a11y-audit/          SKILL.md, scripts/a11y-audit.mjs, references/wcag-fix-playbook.md
  css-audit/           SKILL.md, scripts/{css-audit,visual-diff}.mjs, config/stylelint.best-practices.mjs, references/css-patterns.md
  layout-audit/        SKILL.md, scripts/{layout-audit.mjs,layout-analyze.browser.js}, references/{responsive-patterns,usability-heuristics}.md
lib/                   shared CLI, static server, browser launcher, output/compare helpers
evals/
  <case>/              case.yaml + scaffold.sh
  fixtures/            seeded sites + _tools/ (stage-fixture.sh, generate-perf-assets.mjs)
  solutions/           reference fixes used by the grader self-tests
test/                  node --test suites
```

## Design notes

- **Condense, don't dump.** A Lighthouse JSON is several MB; the summaries rank findings by
  estimated impact and keep only what's needed to act (URLs, selectors, snippets, savings, source
  file). Version-agnostic extraction handles Lighthouse 12 audits and 13 insights.
- **Map to source.** `--dir` audits serve files locally, so every URL in a finding resolves to a
  file path. Environment-dependent findings (cache headers, compression, HTTP/2) are separated so
  the agent doesn't "fix" the audit server.
- **Verify, don't claim.** Every skill re-runs its tool with `--compare` and the report must show
  before/after evidence. CSS refactors must also pass a pixel diff review.
- **Don't game the metric.** The skills explicitly forbid hiding content, silencing tools with
  ARIA, UA-sniffing Lighthouse, or deleting features.
- **Automation has limits.** The a11y skill always lists manual checks; the layout skill pairs
  geometry with a screenshot review rubric.
