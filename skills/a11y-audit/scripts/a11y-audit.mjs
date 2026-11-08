#!/usr/bin/env node
// Automated accessibility audit: axe-core (WCAG 2.x A/AA + best practices)
// plus checks axe does not do — a real keyboard Tab walk (focus order, missing
// focus indicators, focus traps, obscured focus) and a heuristic scan for
// mouse-only "clickable" elements. Writes summary.md + summary.json.
import path from 'node:path';
import { cli, TARGET_HELP } from '../../../lib/cli.mjs';
import { importDep } from '../../../lib/deps.mjs';
import { launchBrowser } from '../../../lib/browser.mjs';
import { resolveTargets } from '../../../lib/targets.mjs';
import { DOM_HELPERS } from '../../../lib/dom-helpers.mjs';
import { prepareRunDir, writeJson, writeText, loadComparison, mdTable, code, truncate, fmtDelta, finish } from '../../../lib/output.mjs';

const NAME = 'a11y-audit';
const USAGE = `Usage: node a11y-audit.mjs (--url <url> | --dir <path>) [options]

Runs axe-core plus keyboard/focus checks and writes a prioritized summary.
${TARGET_HELP}
Accessibility:
  --tags <list>        axe rule tags (default: wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa,best-practice)
  --viewport <WxH>     Viewport (default 1280x800). Run again with 390x844 for mobile.
  --include <css>      Only audit inside this selector
  --exclude <css>      Skip this selector (e.g. third-party widgets)
  --max-tabs <n>       Max Tab presses in the keyboard walk (default 80)
  --no-keyboard        Skip the keyboard walk
  --max-nodes <n>      Elements listed per rule (default 8)
`;

const opts = cli({
  name: NAME,
  usage: USAGE,
  options: {
    tags: { type: 'string', default: 'wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa,best-practice' },
    viewport: { type: 'string', default: '1280x800' },
    include: { type: 'string' },
    exclude: { type: 'string' },
    'max-tabs': { type: 'string', default: '80' },
    'no-keyboard': { type: 'boolean', default: false },
    'max-nodes': { type: 'string', default: '8' },
  },
});

const outRoot = opts.out || 'audit-reports/a11y';
const [vw, vh] = opts.viewport.split('x').map(Number);
const maxNodes = parseInt(opts['max-nodes'], 10) || 8;
const maxTabs = parseInt(opts['max-tabs'], 10) || 80;
const IMPACT_WEIGHT = { critical: 10, serious: 5, moderate: 2, minor: 1 };
const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];

const wcagCriteria = (tags) =>
  tags
    .map((t) => /^wcag(\d)(\d)(\d+)$/.exec(t))
    .filter(Boolean)
    .map((m) => `${m[1]}.${m[2]}.${m[3]}`);

// ---------------------------------------------------------- keyboard walk

async function keyboardWalk(page) {
  await page.evaluate(() => {
    const FOCUSABLE =
      'a[href], area[href], button, input:not([type=hidden]), select, textarea, summary, iframe, [tabindex], [contenteditable=""], [contenteditable=true]';
    const props = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'borderTopColor', 'borderBottomColor', 'borderBottomWidth', 'backgroundColor', 'color', 'textDecorationLine'];
    window.__fsProps = props;
    window.__fsBase = new Map();
    document.activeElement?.blur?.();
    for (const el of document.querySelectorAll(FOCUSABLE)) {
      const cs = getComputedStyle(el);
      window.__fsBase.set(el, Object.fromEntries(props.map((p) => [p, cs[p]])));
    }
    window.scrollTo(0, 0);
  });

  const stops = [];
  const issues = [];
  const seen = new Map();
  let wrapped = false;

  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { none: true };
      const { selector, snippet, isVisible } = window.__fs;
      const cs = getComputedStyle(el);
      const now = Object.fromEntries(window.__fsProps.map((p) => [p, cs[p]]));
      const base = window.__fsBase.get(el);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(cs.outlineColor);
      const changed = base ? window.__fsProps.filter((p) => p !== 'outlineStyle' && p !== 'outlineWidth' && p !== 'outlineColor' && base[p] !== now[p]) : [];
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const inViewport = cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight;
      const hit = inViewport ? document.elementFromPoint(cx, cy) : null;
      const obscuredBy = hit && hit !== el && !el.contains(hit) && !hit.contains(el) ? selector(hit) : null;
      const name = (
        el.getAttribute('aria-label') ||
        el.labels?.[0]?.innerText ||
        el.getAttribute('alt') ||
        el.innerText ||
        el.querySelector?.('img[alt]')?.getAttribute('alt') ||
        el.getAttribute('title') ||
        el.getAttribute('placeholder') ||
        ''
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 60);
      return {
        selector: selector(el),
        snippet: snippet(el),
        tag: el.localName,
        role: el.getAttribute('role') || undefined,
        name,
        tabindex: el.getAttribute('tabindex'),
        visible: isVisible(el) && r.width > 1 && r.height > 1,
        indicator: outline || changed.length > 0,
        indicatorVia: outline ? 'outline' : changed.join(',') || null,
        obscuredBy,
        inModal: Boolean(el.closest('[aria-modal="true"], dialog[open]')),
      };
    });
    if (info.none) {
      if (stops.length) {
        wrapped = true;
        break;
      }
      continue;
    }
    const key = info.selector;
    if (seen.has(key)) {
      if (seen.get(key) === 0) wrapped = true;
      else if (!info.inModal) {
        issues.push({ type: 'focus-trap', wcag: '2.1.2', selector: key, snippet: info.snippet, detail: `Tab cycled back to stop #${seen.get(key) + 1} without leaving the region (${stops.length} stops)` });
      }
      break;
    }
    seen.set(key, stops.length);
    stops.push(info);
    if (!info.visible) issues.push({ type: 'focus-hidden-element', wcag: '2.4.7', selector: key, snippet: info.snippet, detail: 'Keyboard focus lands on an element that is invisible or zero-sized' });
    else if (!info.indicator) issues.push({ type: 'no-focus-indicator', wcag: '2.4.7', selector: key, snippet: info.snippet, detail: 'No visible focus style (outline/box-shadow/border/background/color unchanged on focus)' });
    if (info.visible && info.obscuredBy) issues.push({ type: 'focus-obscured', wcag: '2.4.11', selector: key, snippet: info.snippet, detail: `Focused element is covered by ${info.obscuredBy}` });
    if (info.tag !== 'a' && info.tag !== 'button' && !['input', 'select', 'textarea', 'summary', 'iframe'].includes(info.tag) && !info.role) {
      issues.push({ type: 'focusable-without-role', wcag: '4.1.2', selector: key, snippet: info.snippet, detail: `<${info.tag}> is focusable but has no role, so assistive tech cannot tell what it is` });
    }
  }
  return { stops, issues, wrapped, truncated: !wrapped && stops.length >= maxTabs };
}

async function findMouseOnlyClickables(page) {
  return page.evaluate(() => {
    const { selector, snippet, isVisible } = window.__fs;
    const INTERACTIVE = 'a[href], button, input, select, textarea, summary, label, option, [tabindex], [contenteditable], [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [role=switch], [role=option], [role=radio], iframe, video, audio';
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (out.length >= 25) break;
      if (el.matches(INTERACTIVE) || el.closest(INTERACTIVE)) continue;
      const hasHandler = el.hasAttribute('onclick') || el.hasAttribute('onmousedown') || el.hasAttribute('onmouseup');
      const pointer = getComputedStyle(el).cursor === 'pointer' && getComputedStyle(el.parentElement || el).cursor !== 'pointer';
      if (!(hasHandler || pointer) || !isVisible(el)) continue;
      out.push({ selector: selector(el), snippet: snippet(el), reason: hasHandler ? 'inline click handler' : 'cursor:pointer' });
    }
    return out;
  });
}

// ------------------------------------------------------------------ main

function condenseRule(r, withNodes = maxNodes) {
  return {
    id: r.id,
    impact: r.impact || 'minor',
    help: r.help,
    description: r.description,
    helpUrl: r.helpUrl,
    wcag: wcagCriteria(r.tags),
    tags: r.tags.filter((t) => !/^wcag\d{3,}$/.test(t)),
    count: r.nodes.length,
    nodes: r.nodes.slice(0, withNodes).map((n) => ({
      target: n.target.flat().join(' '),
      html: truncate(n.html, 220),
      summary: truncate(
        (n.failureSummary || '')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !/^Fix (any|all) of the following:?$/i.test(l))
          .join('; '),
        260,
      ),
    })),
  };
}

async function main() {
  const { default: AxeBuilder } = await importDep('@axe-core/playwright');
  const target = await resolveTargets(opts, NAME);
  const runDir = prepareRunDir(outRoot, opts.label);
  const before = loadComparison(outRoot, opts.compare);
  const browser = await launchBrowser({ chrome: opts.chrome });
  const pages = [];
  let axeVersion = null;
  try {
    for (const t of target.targets) {
      process.stderr.write(`[${NAME}] ${t.url} @ ${vw}x${vh}…\n`);
      const context = await browser.newContext({ viewport: { width: vw, height: vh } });
      const page = await context.newPage();
      await page.goto(t.url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.evaluate(DOM_HELPERS);

      let builder = new AxeBuilder({ page }).withTags(opts.tags.split(',').map((s) => s.trim()));
      if (opts.include) builder = builder.include(opts.include);
      if (opts.exclude) builder = builder.exclude(opts.exclude);
      const axe = await builder.analyze();
      axeVersion = axe.testEngine?.version;

      const violations = axe.violations.map((r) => condenseRule(r)).sort(
        (a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) || b.count - a.count,
      );
      const incomplete = axe.incomplete.map((r) => condenseRule(r, 3));
      const clickables = await findMouseOnlyClickables(page);
      const keyboard = opts['no-keyboard'] ? null : await keyboardWalk(page);

      const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      for (const v of violations) counts[v.impact] += v.count;
      const keyboardIssues = keyboard ? keyboard.issues.length : 0;
      pages.push({
        name: t.name,
        url: t.url,
        viewport: `${vw}x${vh}`,
        counts: {
          ...counts,
          rules: violations.length,
          elements: violations.reduce((s, v) => s + v.count, 0),
          weighted: violations.reduce((s, v) => s + IMPACT_WEIGHT[v.impact] * v.count, 0),
          keyboardIssues,
          mouseOnly: clickables.length,
          passes: axe.passes.length,
          needsReview: incomplete.length,
        },
        violations,
        incomplete,
        keyboard,
        clickables,
      });
      await context.close();
    }
  } finally {
    await browser.close();
    await target.close();
  }

  const summary = { tool: 'a11y-audit', schema: 1, label: opts.label, comparedTo: before ? opts.compare : undefined, generatedAt: new Date().toISOString(), axeVersion, tags: opts.tags, pages };
  writeJson(path.join(runDir, 'summary.json'), summary);

  let md = `# Accessibility audit (${opts.label})\n\naxe-core ${axeVersion} · tags ${code(opts.tags)} · viewport ${vw}x${vh} · ${summary.generatedAt}\n`;
  if (before) md += `Compared against: **${opts.compare}** (${before.generatedAt})\n`;
  md += `\nAutomated tools catch roughly a third of WCAG issues. A clean run is necessary, not sufficient — see "Manual checks" at the end.\n\n`;

  for (const p of pages) {
    const prev = before?.pages?.find((b) => b.name === p.name);
    md += `## ${p.name} — ${p.url}\n\n`;
    const rows = [
      ['Critical', p.counts.critical, prev?.counts.critical],
      ['Serious', p.counts.serious, prev?.counts.serious],
      ['Moderate', p.counts.moderate, prev?.counts.moderate],
      ['Minor', p.counts.minor, prev?.counts.minor],
      ['Weighted score (lower is better)', p.counts.weighted, prev?.counts.weighted],
      ['Keyboard/focus issues', p.counts.keyboardIssues, prev?.counts.keyboardIssues],
      ['Mouse-only clickables', p.counts.mouseOnly, prev?.counts.mouseOnly],
      ['Needs manual review (axe incomplete)', p.counts.needsReview, prev?.counts.needsReview],
    ].map(([k, v, b]) => [k, v, ...(prev ? [b ?? 'n/a', fmtDelta(b, v)] : [])]);
    md += mdTable(['Measure', 'Count', ...(prev ? ['Before', 'Δ'] : [])], rows);

    if (prev) {
      const prevIds = new Set(prev.violations.map((v) => v.id));
      const nowIds = new Set(p.violations.map((v) => v.id));
      md += `\nResolved rules: ${[...prevIds].filter((id) => !nowIds.has(id)).map(code).join(', ') || '_none_'}\n`;
      md += `New rules: ${[...nowIds].filter((id) => !prevIds.has(id)).map(code).join(', ') || '_none_'}\n`;
    }

    md += `\n### axe violations (${p.violations.length} rules, ${p.counts.elements} elements)\n\n`;
    if (!p.violations.length) md += '_No axe violations._\n\n';
    p.violations.forEach((v, i) => {
      md += `#### ${i + 1}. [${v.impact.toUpperCase()}] ${v.help} — ${code(v.id)} × ${v.count}\n`;
      md += `WCAG ${v.wcag.join(', ') || 'best practice'} · ${v.helpUrl}\n`;
      for (const n of v.nodes) md += `- ${code(n.target)} ${code(n.html)}\n  - ${n.summary}\n`;
      if (v.count > v.nodes.length) md += `- …and ${v.count - v.nodes.length} more\n`;
      md += '\n';
    });

    if (p.keyboard) {
      md += `### Keyboard walk (${p.keyboard.stops.length} tab stops${p.keyboard.truncated ? ', stopped at --max-tabs' : ''})\n\n`;
      md += `Tab order: ${p.keyboard.stops.slice(0, 30).map((s, i) => `${i + 1}. ${code(truncate(s.name || s.selector, 40))}`).join(' ')}${p.keyboard.stops.length > 30 ? ' …' : ''}\n\n`;
      if (!p.keyboard.issues.length) md += '_No keyboard/focus issues detected._\n\n';
      for (const k of p.keyboard.issues) md += `- **${k.type}** (WCAG ${k.wcag}) ${code(k.selector)} — ${k.detail}\n  - ${code(k.snippet)}\n`;
      md += '\n';
    }
    if (p.clickables.length) {
      md += `### Mouse-only clickable elements (heuristic)\n\nThese look clickable but are not focusable or exposed with a role. Use <button>/<a href> instead.\n\n`;
      for (const c of p.clickables) md += `- ${code(c.selector)} (${c.reason}) ${code(c.snippet)}\n`;
      md += '\n';
    }
    if (p.incomplete.length) {
      md += `### Needs manual review (axe could not decide)\n\n`;
      for (const r of p.incomplete) md += `- ${code(r.id)} ${r.help} × ${r.count}${r.nodes[0] ? ` — e.g. ${code(r.nodes[0].target)}` : ''}\n`;
      md += '\n';
    }
  }
  md += `## Manual checks still required\n\n`;
  md += [
    'Screen reader pass (VoiceOver/NVDA): headings, landmarks, form errors and live updates are announced sensibly',
    'Alt text is meaningful (not just present); decorative images use alt=""',
    'Visible labels match accessible names (WCAG 2.5.3); error messages are tied to fields (aria-describedby)',
    'Content reflows at 320px / 400% zoom without loss (1.4.10) — run the layout audit at 320x640',
    'Motion respects prefers-reduced-motion; nothing flashes more than 3×/s',
    'Custom widgets (menus, dialogs, tabs) follow WAI-ARIA APG keyboard patterns; dialogs trap and restore focus',
  ]
    .map((s) => `- [ ] ${s}`)
    .join('\n');
  md += '\n';
  writeText(path.join(runDir, 'summary.md'), md);

  for (const p of pages) {
    process.stdout.write(`${p.name}: ${p.counts.critical} critical, ${p.counts.serious} serious, ${p.counts.moderate} moderate, ${p.counts.minor} minor · ${p.counts.keyboardIssues} keyboard issues · ${p.counts.mouseOnly} mouse-only\n`);
  }
  finish(NAME, runDir);
}

main().catch((err) => {
  process.stderr.write(`${NAME}: ${err.stack || err.message}\n`);
  process.exit(1);
});
