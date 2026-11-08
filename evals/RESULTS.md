# Eval results log

## 2026-11-08 — first end-to-end run (fix cases, 1 run each, `--ablation none`, default model)

Total cost $0.84. Run with `TMPDIR` outside `/tmp` and chrome-headless-shell (see README).

| Case | Score | Turns | Cost | Failed graders |
| --- | --- | --- | --- | --- |
| perf-fix | 0.91 | 16 | $0.28 | `cls-and-main-thread-fixed` (judge) |
| a11y-fix | 0.89 | 9 | $0.17 | `semantic-fixes-not-bandaids`, `report-quality` (judges) |
| css-refactor | 0.88 | 13 | $0.25 | `no-layout-property-animation`, `visual-parity-verified` (judge) |
| layout-fix | 0.73 | 7 | $0.14 | `looked-at-rendering`, `used-layout-script` (1×, needs 2), `viewed-screenshots`, `after-run-no-overflow` |

Trigger cases (separate run): all four `trigger-*` cases loaded the right skill; `no-trigger-copy-edit` passed.

### Open follow-ups
- **layout-audit**: the agent ran the audit once and never re-ran it or opened the screenshots. Strengthen
  SKILL.md steps 2 and 5 (make re-run and screenshot review non-optional), then re-measure.
- **css-audit**: the width-animating `@keyframes` was left in place, and the visual-diff before/after step was
  not judged as done. Check the trace, and make the visual baseline the very first command in the skill.
- **LLM judges** (Haiku by default) failed some cases unanimously, and the result JSON records no rationale.
  Re-run with `--judge-model sonnet` and `--keep-temp` to confirm the criteria are fair before changing skills.
- Next: run with the default with/without ablation to measure each skill's delta over no plugin.
