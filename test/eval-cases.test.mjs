// Validates the eval suite itself, without running an agent:
//  - every case.yaml is well-formed for `claude plugin eval` (schema v1.x)
//  - every deterministic grader FAILS on the untouched fixture (it can detect the bug)…
//  - …and PASSES on the reference solution (a correct fix is rewarded),
//  - "preserve-*" guard graders pass on both.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCases, stageCase, applySolution, deterministicGraders, evaluateGrader, EVALS } from './helpers.mjs';

const cases = loadCases();
const GRADER_TYPES = new Set(['regex', 'tool_order', 'tool_used', 'file_exists', 'llm', 'baseline']);
const TOP_KEYS = new Set(['schema_version', 'name', 'description', 'tags', 'plugins', 'context', 'execution', 'runs', 'graders', 'expected_outcome']);

test('suite has fix, report, trigger and negative cases for every skill', () => {
  const tags = cases.flatMap((c) => c.data.tags || []);
  for (const t of ['perf', 'a11y', 'css', 'layout', 'fix', 'trigger', 'negative', 'report']) assert.ok(tags.includes(t), `no case tagged ${t}`);
});

for (const c of cases) {
  test(`${c.dirName}: case.yaml is well-formed`, () => {
    const d = c.data;
    for (const k of Object.keys(d)) assert.ok(TOP_KEYS.has(k), `unknown top-level key ${k}`);
    assert.match(String(d.schema_version), /^1\.\d+$/);
    assert.equal(d.name, c.dirName, 'name should match directory');
    assert.ok(d.execution?.prompt?.trim().length > 20, 'prompt missing');
    assert.ok(d.execution.max_turns > 0 && d.execution.max_turns <= 200);
    assert.ok(!d.execution.timeout_seconds || d.execution.timeout_seconds <= 3600);
    assert.ok(fs.existsSync(path.join(c.dir, d.context.scaffold_script)), 'scaffold script missing');
    assert.ok(c.fixture && fs.existsSync(path.join(EVALS, 'fixtures', c.fixture)), `fixture ${c.fixture} missing`);
    const names = new Set();
    for (const g of d.graders) {
      assert.ok(GRADER_TYPES.has(g.type), `bad grader type ${g.type}`);
      assert.ok(g.name && !names.has(g.name), `duplicate/missing grader name ${g.name}`);
      names.add(g.name);
      if (g.type === 'regex') {
        assert.doesNotThrow(() => new RegExp(g.pattern, g.flags || ''), `${g.name}: invalid regex`);
        if (g.match) assert.match(g.match, /^(contains|not_contains|count:\d+)$/);
      }
      if (g.type === 'llm') assert.ok(g.criteria.trim().length > 40, `${g.name}: criteria too vague`);
      // The harness defaults tool_used min to 1, so "never called" needs an explicit min: 0.
      if (g.type === 'tool_used' && g.max === 0) assert.equal(g.min, 0, `${g.name}: max: 0 requires min: 0`);
      if (g.arm) assert.ok(['with-only', 'both'].includes(g.arm));
    }
  });

  const graders = deterministicGraders(c);
  if (!graders.length) continue;

  test(`${c.dirName}: deterministic graders detect the seeded problems`, () => {
    const dir = stageCase(c);
    try {
      for (const g of graders) {
        const passed = evaluateGrader(g, dir);
        if (g.name.startsWith('preserve-')) assert.equal(passed, true, `${g.name} should pass on the untouched fixture`);
        else if ((c.data.tags || []).includes('fix') || c.data.tags.includes('negative')) assert.equal(passed, false, `${g.name} should FAIL on the untouched fixture`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  if ((c.data.tags || []).includes('fix')) {
    test(`${c.dirName}: reference solution passes every deterministic grader`, () => {
      const dir = stageCase(c);
      try {
        applySolution(dir, c.fixture);
        const failed = graders.filter((g) => !evaluateGrader(g, dir)).map((g) => g.name);
        assert.deepEqual(failed, [], `graders failing on the reference solution: ${failed.join(', ')}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

// Graders must accept other valid fixes, not just the reference one.
test('a11y graders accept alternative valid fixes', () => {
  const c = cases.find((x) => x.dirName === 'a11y-fix');
  const dir = stageCase(c);
  try {
    applySolution(dir, c.fixture);
    const file = path.join(dir, 'index.html');
    let html = fs.readFileSync(file, 'utf8');
    // Wrap inputs in their labels instead of label[for]; sr-only text instead of aria-label on social links.
    html = html
      .replace(/<label for="name">Your name<\/label>\s*<input([^>]*)>/, '<label>Your name <input$1></label>')
      .replace(/<label for="email">Email address<\/label>\s*<input([^>]*)>/, '<label>Email address <input$1></label>')
      .replace(/<a class="social" href="([^"]+)" aria-label="([^"]+)">(<svg[\s\S]*?<\/svg>)<\/a>/g, '<a class="social" href="$1">$3<span class="visually-hidden">$2</span></a>');
    fs.writeFileSync(file, html);
    const byName = Object.fromEntries(c.data.graders.map((g) => [g.name, g]));
    for (const name of ['email-field-labelled', 'name-field-labelled', 'social-links-named']) {
      assert.equal(evaluateGrader(byName[name], dir), true, `${name} should accept the alternative fix`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('css graders allow !important only in reduced-motion overrides', () => {
  const g = cases.find((x) => x.dirName === 'css-refactor').data.graders.find((x) => x.name === 'no-stray-important');
  const re = new RegExp(g.pattern, g.flags);
  assert.equal(re.test('@media (prefers-reduced-motion: reduce) {\n  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }\n}'), false);
  assert.equal(re.test('.btn { color: red !important; }'), true);
});
