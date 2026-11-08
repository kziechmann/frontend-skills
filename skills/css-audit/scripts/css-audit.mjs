#!/usr/bin/env node
// CSS quality audit. Combines three open-source engines:
//   1. stylelint with a curated correctness + maintainability config
//   2. @projectwallace/css-analyzer for codebase-wide metrics (specificity,
//      !important, color/font-size sprawl, vendor prefixes, z-index…)
//   3. pattern checks stylelint has no rule for (transition: all, animating
//      layout properties, outline removal, float layouts, px font sizes,
//      @import chains, missing prefers-reduced-motion, near-duplicate colors)
// Optionally (--url/--dir) measures unused CSS with Chromium coverage.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, TARGET_HELP } from '../../../lib/cli.mjs';
import { importDep, PLUGIN_ROOT } from '../../../lib/deps.mjs';
import { launchBrowser } from '../../../lib/browser.mjs';
import { resolveTargets } from '../../../lib/targets.mjs';
import { prepareRunDir, writeJson, writeText, loadComparison, mdTable, code, truncate, fmtDelta, finish, rel } from '../../../lib/output.mjs';

const NAME = 'css-audit';
const USAGE = `Usage: node css-audit.mjs [--src <path>]... [--url <url> | --dir <path>] [options]

Static CSS analysis of source files, plus optional runtime unused-CSS coverage.

Source:
  --src <path>         CSS/SCSS file or directory to analyze (repeatable, default ".").
                       node_modules, dist, build, .git, audit-reports are skipped.
  --config <file>      Use this stylelint config instead of the curated one
  --max-locations <n>  Locations listed per finding (default 8)

Runtime coverage (optional — pass a page to measure unused CSS):
${TARGET_HELP}`;

const opts = cli({
  name: NAME,
  usage: USAGE,
  options: {
    src: { type: 'string', multiple: true },
    config: { type: 'string' },
    'max-locations': { type: 'string', default: '8' },
  },
});

const outRoot = opts.out || 'audit-reports/css';
const maxLoc = parseInt(opts['max-locations'], 10) || 8;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'audit-reports', '.next', '.nuxt', 'coverage', 'vendor', '.svelte-kit', 'out']);

function collectFiles(inputs) {
  const files = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const entry of fs.readdirSync(p)) {
        if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
        walk(path.join(p, entry));
      }
    } else if (/\.(css|scss)$/.test(p) && !/\.min\.css$/.test(p)) {
      files.push(path.resolve(p));
    }
  };
  for (const i of inputs) {
    if (!fs.existsSync(i)) throw new Error(`--src ${i} does not exist`);
    walk(i);
  }
  return [...new Set(files)].sort();
}

// ----------------------------------------------------------- pattern checks

const LAYOUT_PROPS = /^(width|height|top|left|right|bottom|margin(-\w+)?|padding(-\w+)?|inset|max-width|max-height|min-width|min-height|font-size)$/;

function parseColor(value) {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const named = { white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192] };
  return named[v] || null;
}

function nearDuplicateColors(colors) {
  const parsed = colors.map((c) => ({ c, rgb: parseColor(c) })).filter((x) => x.rgb);
  const groups = [];
  const used = new Set();
  for (let i = 0; i < parsed.length; i++) {
    if (used.has(i)) continue;
    const group = [parsed[i].c];
    for (let j = i + 1; j < parsed.length; j++) {
      if (used.has(j)) continue;
      const [a, b] = [parsed[i].rgb, parsed[j].rgb];
      const dist = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
      if (dist <= 12) {
        group.push(parsed[j].c);
        used.add(j);
      }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

function patternChecks(postcss, scss, files) {
  const findings = {};
  const add = (id, file, node, detail) => {
    (findings[id] ??= []).push({ file: rel(file), line: node.source?.start?.line, detail: truncate(detail, 140) });
  };
  let hasReducedMotion = false;
  let hasFocusVisible = false;
  let animationCount = 0;
  let customPropertyDefs = 0;
  let varUsages = 0;
  let literalColorDecls = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let root;
    try {
      root = file.endsWith('.scss') ? scss.parse(text, { from: file }) : postcss.parse(text, { from: file });
    } catch {
      continue; // stylelint reports parse errors
    }
    root.walkAtRules((at) => {
      if (at.name === 'media' && /prefers-reduced-motion/.test(at.params)) hasReducedMotion = true;
      if (at.name === 'import' && file.endsWith('.css')) add('css-import-chain', file, at, `@import ${at.params} — creates a serial, render-blocking request chain`);
      if (at.name === 'keyframes') {
        animationCount++;
        const animated = new Set();
        at.walkDecls((d) => {
          if (LAYOUT_PROPS.test(d.prop) && !animated.has(d.prop)) {
            animated.add(d.prop);
            add('animating-layout-property', file, d, `@keyframes ${at.params} animates ${d.prop} (triggers layout every frame; use transform/opacity)`);
          }
        });
      }
    });
    root.walkRules((rule) => {
      if (/:focus-visible/.test(rule.selector)) hasFocusVisible = true;
    });
    root.walkDecls((d) => {
      const prop = d.prop.toLowerCase();
      const value = d.value.toLowerCase();
      const sel = d.parent?.selector || (d.parent?.type === 'atrule' ? `@${d.parent.name}` : '');
      if (prop.startsWith('--')) customPropertyDefs++;
      if (/var\(--/.test(value)) varUsages++;
      if (!prop.startsWith('--') && /(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/.test(value)) literalColorDecls++;
      if ((prop === 'transition' || prop === 'transition-property') && /(^|[\s,])all\b/.test(value)) {
        add('transition-all', file, d, `${sel} { ${prop}: ${d.value} } — transitions every property, incl. layout ones`);
      }
      if (prop === 'transition' || prop === 'transition-property' || prop === 'animation' || prop === 'animation-name') animationCount++;
      if (prop === 'transition-property' || prop === 'transition') {
        for (const part of value.split(',')) {
          const p = part.trim().split(/\s+/)[0];
          if (LAYOUT_PROPS.test(p)) add('animating-layout-property', file, d, `${sel} transitions ${p} (layout on every frame; prefer transform/opacity)`);
        }
      }
      if (prop === 'outline' && /^(none|0)(\s|$)/.test(value)) add('outline-removed', file, d, `${sel} { outline: ${d.value} } — removes the focus indicator`);
      if (prop === 'outline-style' && value === 'none') add('outline-removed', file, d, `${sel} { outline-style: none }`);
      if (prop === 'font-size' && /^\d*\.?\d+px$/.test(value)) add('px-font-size', file, d, `${sel} { font-size: ${d.value} } — px ignores the user's font-size preference; use rem`);
      if (prop === 'float' && /^(left|right)$/.test(value) && !/\b(img|figure|picture|svg)\b/.test(sel)) add('float-layout', file, d, `${sel} { float: ${d.value} } — float-based layout; use flex or grid`);
      if (prop === 'clear' && value === 'both') add('clearfix', file, d, `${sel} { clear: both } — clearfix hack, unnecessary with flex/grid`);
      if (prop === 'z-index' && /^\d+$/.test(value) && Number(value) >= 100) add('z-index-escalation', file, d, `${sel} { z-index: ${d.value} } — arbitrary large z-index; use a small token scale`);
      if (/^(-webkit-|-moz-)?user-select$/.test(prop) && value === 'none' && /^(html|body|\*)$/.test(sel.trim())) add('global-user-select-none', file, d, `${sel} disables text selection globally`);
    });
  }
  if (animationCount > 0 && !hasReducedMotion) {
    findings['missing-reduced-motion'] = [{ file: '(all files)', detail: `${animationCount} transitions/animations but no @media (prefers-reduced-motion: reduce) block` }];
  }
  if (findings['outline-removed'] && hasFocusVisible) {
    for (const f of findings['outline-removed']) f.detail += ' (a :focus-visible rule exists — verify it covers this element)';
  }
  return { findings, tokens: { customPropertyDefs, varUsages, literalColorDecls } };
}

const PATTERN_INFO = {
  'css-import-chain': ['high', '@import inside CSS', 'Link stylesheets from HTML (or bundle them) instead of chaining @import'],
  'outline-removed': ['high', 'Focus outline removed', 'Keep a visible focus style: replace with :focus-visible { outline: 2px solid … }'],
  'animating-layout-property': ['medium', 'Animating layout properties', 'Animate transform/opacity instead of width/height/top/left/margin'],
  'transition-all': ['medium', 'transition: all', 'List the properties that actually change'],
  'missing-reduced-motion': ['medium', 'No prefers-reduced-motion handling', 'Add @media (prefers-reduced-motion: reduce) to disable non-essential motion'],
  'float-layout': ['medium', 'Float-based layout', 'Replace with flexbox or grid (and drop clearfix)'],
  clearfix: ['low', 'Clearfix hacks', 'Unnecessary once floats are replaced by flex/grid'],
  'px-font-size': ['low', 'Font sizes in px', 'Use rem so text scales with user preferences'],
  'z-index-escalation': ['low', 'z-index escalation', 'Define a z-index scale (e.g. --z-dropdown: 10; --z-modal: 100)'],
  'global-user-select-none': ['low', 'Global user-select: none', 'Only disable selection on specific controls'],
};

// ------------------------------------------------------------- runtime

async function runtimeCoverage() {
  if (!(opts.url?.length || opts.dir)) return null;
  const target = await resolveTargets(opts, NAME);
  const browser = await launchBrowser({ chrome: opts.chrome });
  const sheets = new Map();
  const pages = [];
  try {
    for (const t of target.targets) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.coverage.startCSSCoverage();
      await page.goto(t.url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      const coverage = await page.coverage.stopCSSCoverage();
      const dom = await page.evaluate(() => ({
        inlineStyleAttrs: document.querySelectorAll('[style]').length,
        styleBlocks: document.querySelectorAll('style').length,
        stylesheets: document.querySelectorAll('link[rel=stylesheet]').length,
      }));
      pages.push({ name: t.name, url: t.url, ...dom });
      for (const entry of coverage) {
        const key = entry.url || `${t.name}:inline`;
        const used = entry.ranges.reduce((s, r) => s + (r.end - r.start), 0);
        const prev = sheets.get(key);
        // A rule used on any audited page counts as used.
        if (!prev || used > prev.usedBytes) {
          sheets.set(key, { url: key, source: target.sourceFor(entry.url) || undefined, totalBytes: entry.text.length, usedBytes: used });
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await target.close();
  }
  const list = [...sheets.values()].map((s) => ({ ...s, unusedBytes: s.totalBytes - s.usedBytes, unusedPct: s.totalBytes ? Math.round(((s.totalBytes - s.usedBytes) / s.totalBytes) * 100) : 0 }));
  list.sort((a, b) => b.unusedBytes - a.unusedBytes);
  const total = list.reduce((s, x) => s + x.totalBytes, 0);
  const unused = list.reduce((s, x) => s + x.unusedBytes, 0);
  return { pages, stylesheets: list, totalBytes: total, unusedBytes: unused, unusedPct: total ? Math.round((unused / total) * 100) : 0 };
}

// ------------------------------------------------------------------ main

async function main() {
  const { default: stylelint } = await importDep('stylelint');
  const { analyze } = await importDep('@projectwallace/css-analyzer');
  const { default: postcss } = await importDep('postcss');
  const { default: scss } = await importDep('postcss-scss');

  const files = collectFiles(opts.src?.length ? opts.src : ['.']);
  if (!files.length) throw new Error('no .css/.scss files found (pass --src <dir>)');
  const runDir = prepareRunDir(outRoot, opts.label);
  const before = loadComparison(outRoot, opts.compare);

  process.stderr.write(`[${NAME}] ${files.length} stylesheet(s)…\n`);
  const configPath = opts.config ? path.resolve(opts.config) : new URL('../config/stylelint.best-practices.mjs', import.meta.url).pathname;
  const configLabel = opts.config ? rel(configPath) : `curated (${path.relative(PLUGIN_ROOT, configPath)})`;
  const config = (await import(pathToFileURL(configPath).href)).default;
  const lint = await stylelint.lint({ files, config, configBasedir: path.dirname(configPath), allowEmptyInput: true });

  const byRule = new Map();
  let errors = 0;
  let warnings = 0;
  for (const r of lint.results) {
    for (const w of r.warnings) {
      if (w.severity === 'error') errors++;
      else warnings++;
      const entry = byRule.get(w.rule) || { rule: w.rule, severity: w.severity, count: 0, locations: [] };
      entry.count++;
      if (entry.locations.length < maxLoc) entry.locations.push({ file: rel(r.source), line: w.line, column: w.column, text: truncate(w.text.replace(/\s*\([\w/-]+\)$/, ''), 150) });
      byRule.set(w.rule, entry);
    }
    for (const w of r.invalidOptionWarnings || []) process.stderr.write(`stylelint config warning: ${w.text}\n`);
    if (r.parseErrors?.length) for (const pe of r.parseErrors) process.stderr.write(`parse error ${rel(r.source)}: ${pe.text}\n`);
  }
  const lintFindings = [...byRule.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'error' ? -1 : 1));

  const cssFiles = files.filter((f) => f.endsWith('.css'));
  const combined = cssFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const w = analyze(combined);
  const uniqueColors = Object.keys(w.values.colors.unique || {});
  const specItems = w.selectors.specificity.items || [];
  const topSpecific = Object.entries(w.selectors.specificity.unique || {})
    .map(([s, n]) => ({ spec: s, n }))
    .sort((a, b) => {
      const [x, y] = [a.spec.split(',').map(Number), b.spec.split(',').map(Number)];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    })
    .slice(0, 5);
  const metrics = {
    files: files.length,
    bytes: files.reduce((s, f) => s + fs.statSync(f).size, 0),
    rules: w.rules.total,
    selectors: w.selectors.total,
    declarations: w.declarations.total,
    importants: w.declarations.importants.total,
    importantRatio: Math.round(w.declarations.importants.ratio * 1000) / 10,
    idSelectors: w.selectors.id.total,
    maxSpecificity: w.selectors.specificity.max?.join(',') ?? '0,0,0',
    meanSpecificity: (w.selectors.specificity.mean || [0, 0, 0]).map((n) => Math.round(n * 100) / 100).join(','),
    selectorsAbove030: specItems.filter(([a, b]) => a > 0 || b > 3).length,
    uniqueColors: uniqueColors.length,
    uniqueFontSizes: w.values.fontSizes.totalUnique,
    uniqueFontFamilies: w.values.fontFamilies.totalUnique,
    uniqueZIndexes: w.values.zindexes.totalUnique,
    maxZIndex: Math.max(0, ...Object.keys(w.values.zindexes.unique || {}).map(Number).filter(Number.isFinite)),
    vendorPrefixedProperties: w.properties.prefixed.total,
    vendorPrefixedValues: w.values.prefixes.total,
    mediaQueries: w.atrules.media.totalUnique,
    emptyRules: w.rules.empty.total,
    embeddedBytes: w.stylesheet.embeddedContent.size.total,
    customProperties: w.properties.custom.totalUnique,
    stylelintErrors: errors,
    stylelintWarnings: warnings,
  };

  const { findings: patterns, tokens } = patternChecks(postcss, scss, files);
  const colorGroups = nearDuplicateColors(uniqueColors);
  metrics.nearDuplicateColorGroups = colorGroups.length;
  metrics.tokenAdoption = tokens.literalColorDecls + tokens.varUsages ? Math.round((tokens.varUsages / (tokens.literalColorDecls + tokens.varUsages)) * 100) : null;
  for (const [id, list] of Object.entries(patterns)) metrics[`pattern:${id}`] = list.length;

  const runtime = await runtimeCoverage();
  if (runtime) {
    metrics.unusedCssBytes = runtime.unusedBytes;
    metrics.unusedCssPct = runtime.unusedPct;
    metrics.inlineStyleAttrs = runtime.pages.reduce((s, p) => s + p.inlineStyleAttrs, 0);
  }

  const summary = {
    tool: 'css-audit',
    schema: 1,
    label: opts.label,
    comparedTo: before ? opts.compare : undefined,
    generatedAt: new Date().toISOString(),
    config: configLabel,
    files: files.map(rel),
    metrics,
    stylelint: lintFindings,
    patterns: Object.entries(patterns).map(([id, locations]) => ({ id, severity: PATTERN_INFO[id]?.[0] || 'low', title: PATTERN_INFO[id]?.[1] || id, fix: PATTERN_INFO[id]?.[2], count: locations.length, locations: locations.slice(0, maxLoc) })),
    colors: { unique: uniqueColors.slice(0, 60), nearDuplicateGroups: colorGroups },
    topSpecificity: topSpecific,
    runtime,
  };
  const rank = { high: 0, medium: 1, low: 2 };
  summary.patterns.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);
  writeJson(path.join(runDir, 'summary.json'), summary);

  // ------------------------------------------------------------ markdown
  const bm = before?.metrics;
  const KEY_METRICS = [
    ['stylelintErrors', 'stylelint errors (correctness)'],
    ['stylelintWarnings', 'stylelint warnings (maintainability)'],
    ['importants', '!important declarations'],
    ['idSelectors', 'ID selectors'],
    ['maxSpecificity', 'Max specificity'],
    ['selectorsAbove030', 'Selectors above 0,3,0'],
    ['uniqueColors', 'Unique colors'],
    ['nearDuplicateColorGroups', 'Near-duplicate color groups'],
    ['customProperties', 'Custom properties defined'],
    ['tokenAdoption', 'Color values via var() (%)'],
    ['uniqueFontSizes', 'Unique font sizes'],
    ['maxZIndex', 'Max z-index'],
    ['vendorPrefixedProperties', 'Vendor-prefixed properties'],
    ['emptyRules', 'Empty rules'],
    ['unusedCssPct', 'Unused CSS on audited pages (%)'],
    ['inlineStyleAttrs', 'Inline style="" attributes'],
  ];
  const higherIsBetter = new Set(['customProperties', 'tokenAdoption']);
  let md = `# CSS audit (${opts.label})\n\n${files.length} file(s), ${(metrics.bytes / 1024).toFixed(1)} KiB · stylelint config ${code(configLabel)} · ${summary.generatedAt}\n`;
  if (before) md += `Compared against: **${opts.compare}** (${before.generatedAt})\n`;
  md += `\nFiles: ${files.map((f) => code(rel(f))).join(', ')}\n\n## Key metrics\n\n`;
  md += mdTable(
    ['Metric', 'Value', ...(bm ? ['Before', 'Δ'] : [])],
    KEY_METRICS.filter(([k]) => metrics[k] !== undefined).map(([k, label]) => {
      const v = metrics[k];
      const b = bm?.[k];
      const numeric = typeof v === 'number' && typeof b === 'number';
      return [label, v ?? 'n/a', ...(bm ? [b ?? 'n/a', numeric ? fmtDelta(b, v, { lowerIsBetter: !higherIsBetter.has(k) }) : b === v ? '±0' : 'changed'] : [])];
    }),
  );

  md += `\n## stylelint (${errors} errors, ${warnings} warnings)\n\nErrors are invalid or ignored CSS — fix all of them. Warnings are maintainability debt — fix where the change is safe.\n\n`;
  if (!lintFindings.length) md += '_No stylelint findings._\n';
  for (const f of lintFindings) {
    md += `### ${f.severity === 'error' ? '❌' : '⚠️'} ${code(f.rule)} × ${f.count}\n`;
    for (const l of f.locations) md += `- ${code(`${l.file}:${l.line}:${l.column}`)} ${l.text}\n`;
    if (f.count > f.locations.length) md += `- …and ${f.count - f.locations.length} more\n`;
    md += '\n';
  }

  md += `## Pattern checks\n\n`;
  if (!summary.patterns.length) md += '_No pattern findings._\n\n';
  for (const p of summary.patterns) {
    md += `### [${p.severity.toUpperCase()}] ${p.title} — ${code(p.id)} × ${p.count}\nFix: ${p.fix}\n`;
    for (const l of p.locations) md += `- ${l.line ? code(`${l.file}:${l.line}`) : code(l.file)} ${l.detail}\n`;
    md += '\n';
  }

  md += `## Design-token health\n\n`;
  md += `- ${metrics.uniqueColors} unique colors, ${metrics.customProperties} custom properties, ${metrics.tokenAdoption ?? 0}% of color declarations use var()\n`;
  if (colorGroups.length) md += `- Near-duplicate colors (merge into one token each): ${colorGroups.map((g) => g.map(code).join(' ≈ ')).join('; ')}\n`;
  md += `- Font sizes in use (${metrics.uniqueFontSizes}): ${Object.keys(w.values.fontSizes.unique || {}).slice(0, 20).map(code).join(' ')}\n`;
  md += `- z-index values: ${Object.keys(w.values.zindexes.unique || {}).map(code).join(' ') || '_none_'}\n`;
  md += `- Most specific selectors: ${topSpecific.map((s) => code(s.spec)).join(', ') || '_n/a_'} (see stylelint ${code('selector-max-specificity')} for locations)\n\n`;

  if (runtime) {
    md += `## Runtime coverage (${runtime.pages.length} page(s))\n\n${runtime.unusedPct}% of loaded CSS was unused on first render (${(runtime.unusedBytes / 1024).toFixed(1)} of ${(runtime.totalBytes / 1024).toFixed(1)} KiB). Rules for hover/JS/other-page states show as unused — confirm before deleting.\n\n`;
    md += mdTable(
      ['Stylesheet', 'Source', 'Size', 'Unused'],
      runtime.stylesheets.map((s) => [truncate(s.url, 70), s.source || '', `${(s.totalBytes / 1024).toFixed(1)} KiB`, `${s.unusedPct}%`]),
    );
    md += `\nInline style attributes: ${metrics.inlineStyleAttrs} · <style> blocks: ${runtime.pages.reduce((s, p) => s + p.styleBlocks, 0)}\n`;
  }
  writeText(path.join(runDir, 'summary.md'), md);

  process.stdout.write(`css: ${errors} stylelint errors, ${warnings} warnings, ${metrics.importants} !important, ${metrics.idSelectors} id selectors, ${metrics.uniqueColors} colors, ${summary.patterns.reduce((s, p) => s + p.count, 0)} pattern findings\n`);
  finish(NAME, runDir);
}

main().catch((err) => {
  process.stderr.write(`${NAME}: ${err.stack || err.message}\n`);
  process.exit(1);
});
