// End-to-end checks of the audit scripts against the eval fixtures: each tool
// must detect the seeded problems in the broken fixture and report them as
// resolved on the reference solution (via --compare). Needs Chrome/Chromium.
// Set SKIP_LIGHTHOUSE=1 to skip the slow Lighthouse test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveChromePath } from '../lib/browser.mjs';
import { stageFixture, applySolution, runScript, readSummary } from './helpers.mjs';

let chromeMissing = false;
try {
  await resolveChromePath();
} catch {
  chromeMissing = 'no Chrome/Chromium available';
}

function withFixture(name, fn) {
  return async () => {
    const dir = stageFixture(name);
    try {
      await fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('a11y-audit: detects seeded WCAG failures and confirms the fix', { skip: chromeMissing, timeout: 180000 }, withFixture('a11y-site', (dir) => {
  runScript('skills/a11y-audit/scripts/a11y-audit.mjs', ['--dir', '.', '--label', 'baseline'], dir);
  const before = readSummary(dir, 'a11y', 'baseline').pages[0];
  const rules = before.violations.map((v) => v.id);
  for (const r of ['image-alt', 'button-name', 'link-name', 'color-contrast', 'html-has-lang', 'meta-viewport', 'tabindex', 'select-name']) {
    assert.ok(rules.includes(r), `expected axe rule ${r}, got ${rules.join(', ')}`);
  }
  assert.ok(before.keyboard.issues.some((i) => i.type === 'no-focus-indicator'), 'keyboard walk should flag missing focus styles');
  assert.ok(before.clickables.length >= 1, 'should flag the div "button"');

  applySolution(dir, 'a11y-site');
  runScript('skills/a11y-audit/scripts/a11y-audit.mjs', ['--dir', '.', '--label', 'after', '--compare', 'baseline'], dir);
  const after = readSummary(dir, 'a11y', 'after').pages[0];
  assert.equal(after.counts.critical + after.counts.serious, 0, 'solution should have no critical/serious violations');
  assert.equal(after.keyboard.issues.length, 0);
  assert.match(fs.readFileSync(path.join(dir, 'audit-reports/a11y/after/summary.md'), 'utf8'), /Resolved rules: .*image-alt/);
}));

test('layout-audit: detects responsive/usability bugs and confirms the fix', { skip: chromeMissing, timeout: 180000 }, withFixture('layout-site', (dir) => {
  runScript('skills/layout-audit/scripts/layout-audit.mjs', ['--dir', '.', '--label', 'baseline', '--viewports', '390x844,1440x900'], dir);
  const before = readSummary(dir, 'layout', 'baseline');
  const phone = before.pages[0].viewports.find((v) => v.viewport === '390x844');
  assert.equal(phone.horizontalOverflow, true);
  for (const t of ['horizontal-overflow', 'text-too-small', 'text-clipped', 'image-distorted', 'overlapping-content']) {
    assert.ok(before.byType[t] > 0, `expected ${t} findings`);
  }
  assert.ok(fs.existsSync(path.join(dir, phone.annotatedScreenshot)), 'annotated screenshot written');

  applySolution(dir, 'layout-site');
  runScript('skills/layout-audit/scripts/layout-audit.mjs', ['--dir', '.', '--label', 'after', '--compare', 'baseline', '--viewports', '390x844,1440x900'], dir);
  const after = readSummary(dir, 'layout', 'after');
  assert.ok(after.pages[0].viewports.every((v) => !v.horizontalOverflow), 'no overflow after fix');
  assert.equal(after.totals.high + after.totals.medium, 0, JSON.stringify(after.byType));
}));

test('css-audit + visual-diff: detect CSS debt, confirm refactor, flag visual changes', { skip: chromeMissing, timeout: 180000 }, withFixture('css-site', (dir) => {
  runScript('skills/css-audit/scripts/visual-diff.mjs', ['--dir', '.', '--label', 'baseline', '--viewports', '1280x800'], dir);
  runScript('skills/css-audit/scripts/css-audit.mjs', ['--src', 'css', '--dir', '.', '--label', 'baseline'], dir);
  const before = readSummary(dir, 'css', 'baseline');
  assert.ok(before.metrics.stylelintErrors >= 5);
  assert.ok(before.metrics.idSelectors >= 5);
  const patterns = before.patterns.map((p) => p.id);
  for (const p of ['outline-removed', 'css-import-chain', 'float-layout', 'transition-all', 'missing-reduced-motion', 'animating-layout-property']) {
    assert.ok(patterns.includes(p), `expected pattern ${p}`);
  }
  assert.ok(before.colors.nearDuplicateGroups.length >= 2, 'near-duplicate colors detected');

  // Unchanged page => visual diff reports no change.
  runScript('skills/css-audit/scripts/visual-diff.mjs', ['--dir', '.', '--label', 'same', '--compare', 'baseline', '--viewports', '1280x800'], dir);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'audit-reports/css/visual/same/summary.json'), 'utf8')).shots[0].status, 'unchanged');

  applySolution(dir, 'css-site');
  runScript('skills/css-audit/scripts/css-audit.mjs', ['--src', 'css', '--dir', '.', '--label', 'after', '--compare', 'baseline'], dir);
  const after = readSummary(dir, 'css', 'after');
  assert.equal(after.metrics.stylelintErrors, 0);
  assert.equal(after.metrics.idSelectors, 0);
  assert.equal(after.patterns.length, 0, JSON.stringify(after.patterns));

  // The refactor intentionally changes the card grid slightly => diff must notice.
  runScript('skills/css-audit/scripts/visual-diff.mjs', ['--dir', '.', '--label', 'after', '--compare', 'baseline', '--viewports', '1280x800'], dir);
  const shot = JSON.parse(fs.readFileSync(path.join(dir, 'audit-reports/css/visual/after/summary.json'), 'utf8')).shots[0];
  assert.equal(shot.status, 'changed');
  assert.ok(fs.existsSync(path.join(dir, shot.diff)));
}));

test('lighthouse-audit: finds seeded perf bugs and measures the improvement', { skip: chromeMissing || (process.env.SKIP_LIGHTHOUSE && 'SKIP_LIGHTHOUSE set'), timeout: 300000 }, withFixture('perf-site', (dir) => {
  runScript('skills/perf-audit/scripts/lighthouse-audit.mjs', ['--dir', '.', '--label', 'baseline'], dir);
  const before = readSummary(dir, 'perf', 'baseline').pages[0];
  const ids = before.findings.map((f) => f.id);
  for (const id of ['render-blocking-insight', 'lcp-discovery-insight', 'unsized-images']) assert.ok(ids.includes(id), `expected ${id}, got ${ids.join(', ')}`);
  assert.ok(before.metrics.CLS.value > 0.1, 'seeded CLS');
  assert.ok(before.findings.find((f) => f.id === 'render-blocking-insight').items.some((i) => i.source === 'js/vendor-bundle.js'), 'maps URLs to source files');

  applySolution(dir, 'perf-site');
  runScript('skills/perf-audit/scripts/lighthouse-audit.mjs', ['--dir', '.', '--label', 'after', '--compare', 'baseline'], dir);
  const after = readSummary(dir, 'perf', 'after').pages[0];
  assert.ok(after.metrics.CLS.value < 0.1, `CLS fixed (got ${after.metrics.CLS.value})`);
  assert.ok(after.scores.performance >= before.scores.performance + 10, `score ${before.scores.performance} -> ${after.scores.performance}`);
  assert.ok(after.metrics.LCP.value < before.metrics.LCP.value);
}));
