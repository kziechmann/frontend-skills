#!/usr/bin/env node
// Runs Lighthouse against one or more pages and condenses the (multi-MB) LHR
// into an LLM-friendly summary.md + summary.json: scores, Core Web Vitals,
// failing audits ranked by estimated impact, with offending URLs/elements and
// (for --dir runs) the source file each URL maps to.
import path from 'node:path';
import fs from 'node:fs';
import { cli, TARGET_HELP, fail } from '../../../lib/cli.mjs';
import { importDep } from '../../../lib/deps.mjs';
import { resolveChromePath } from '../../../lib/browser.mjs';
import { resolveTargets } from '../../../lib/targets.mjs';
import {
  prepareRunDir,
  writeJson,
  writeText,
  loadComparison,
  mdTable,
  code,
  truncate,
  fmtDelta,
  finish,
  rel,
} from '../../../lib/output.mjs';

const NAME = 'lighthouse-audit';
const USAGE = `Usage: node lighthouse-audit.mjs (--url <url> | --dir <path>) [options]

Runs Lighthouse and writes a condensed, prioritized performance summary.
${TARGET_HELP}
Lighthouse:
  --preset <name>      mobile (default) | desktop
  --runs <n>           Runs per page; the median-scoring run is kept (default 1, use 3+ to compare)
  --categories <list>  Comma-separated categories (default: performance).
                       Also: accessibility, best-practices, seo
  --throttling <mode>  simulate (default) | devtools | provided (no throttling)
  --max-items <n>      Offending items listed per finding (default 6)
`;

const opts = cli({
  name: NAME,
  usage: USAGE,
  options: {
    preset: { type: 'string', default: 'mobile' },
    runs: { type: 'string', default: '1' },
    categories: { type: 'string', default: 'performance' },
    throttling: { type: 'string', default: 'simulate' },
    'max-items': { type: 'string', default: '6' },
  },
});

const runs = Math.max(1, Math.min(9, parseInt(opts.runs, 10) || 1));
const maxItems = Math.max(1, parseInt(opts['max-items'], 10) || 6);
const categories = opts.categories.split(',').map((c) => c.trim()).filter(Boolean);
if (!['mobile', 'desktop'].includes(opts.preset)) fail(NAME, '--preset must be mobile or desktop');
if (!['simulate', 'devtools', 'provided'].includes(opts.throttling)) fail(NAME, '--throttling must be simulate, devtools or provided');

const outRoot = opts.out || 'audit-reports/perf';

// Findings whose result depends on the server/CDN rather than the code. When
// auditing a --dir through the local static server they describe that server.
const ENV_DEPENDENT = new Set([
  'uses-long-cache-ttl',
  'cache-insight',
  'uses-http2',
  'server-response-time',
  'redirects',
  'document-latency-insight',
  'modern-http-insight',
  'uses-text-compression',
]);

const NOISE = new Set([
  'network-requests',
  'main-thread-tasks',
  'diagnostics',
  'metrics',
  'screenshot-thumbnails',
  'final-screenshot',
  'script-treemap-data',
  'full-page-screenshot',
  'network-rtt',
  'network-server-latency',
  'interactive',
  'max-potential-fid',
]);

const METRICS = [
  ['first-contentful-paint', 'FCP', 'First Contentful Paint'],
  ['largest-contentful-paint', 'LCP', 'Largest Contentful Paint'],
  ['total-blocking-time', 'TBT', 'Total Blocking Time'],
  ['cumulative-layout-shift', 'CLS', 'Cumulative Layout Shift'],
  ['speed-index', 'SI', 'Speed Index'],
  ['interactive', 'TTI', 'Time to Interactive'],
];

// ---------------------------------------------------------------- extraction

const fmtBytes = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MiB` : `${(b / 1024).toFixed(1)} KiB`);
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

function flattenItems(details, depth = 0) {
  if (!details || depth > 4) return [];
  const out = [];
  if (details.type === 'checklist' && details.items && !Array.isArray(details.items)) {
    for (const [key, v] of Object.entries(details.items)) {
      if (v && v.value === false) out.push({ __text: `✗ ${v.label || key}` });
    }
    return out;
  }
  if (details.type === 'network-tree' || details.type === 'criticalrequestchain') {
    const walk = (chains, d) => {
      for (const node of Object.values(chains || {})) {
        const url = node.url || node.request?.url;
        const t = node.navStartToEndTime ?? (node.request ? (node.request.endTime - node.request.startTime) * 1000 : undefined);
        if (url) out.push({ url, __chainDepth: d, ...(t != null ? { chainTimeMs: t } : {}) });
        walk(node.children, d + 1);
      }
    };
    walk(details.chains, 0);
    return out;
  }
  if (Array.isArray(details.items)) {
    for (const it of details.items) {
      if (it && it.type === 'list-section') {
        const v = it.value;
        if (v && (Array.isArray(v.items) || v.chains || v.type === 'checklist')) out.push(...flattenItems(v, depth + 1));
        else if (v && v.type === 'text' && it.title) out.push({ __text: `${it.title}: ${v.value}` });
      } else if (it && typeof it === 'object' && typeof it.type === 'string' && (Array.isArray(it.items) || it.chains || it.type === 'checklist')) {
        out.push(...flattenItems(it, depth + 1));
      } else if (it && typeof it === 'object' && Object.keys(it).length) {
        out.push(it);
      }
    }
  }
  return out;
}

function describeItem(item, sourceFor) {
  if (item.__text) return { text: truncate(item.__text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), 160) };
  if (item.type === 'node') item = { node: item };
  let url = null;
  let node = null;
  let line = null;
  const labels = [];
  const nums = [];

  for (const [key, value] of Object.entries(item)) {
    if (key === 'subItems' || key.startsWith('__')) continue;
    if (value && typeof value === 'object') {
      if (value.type === 'node') node = node || value;
      else if (value.type === 'source-location') {
        url = url || value.url;
        line = value.line != null ? value.line + 1 : null;
      } else if (value.type === 'url') url = url || value.value;
      else if (value.type === 'link') labels.push(value.text);
      else if ((value.type === 'text' || value.type === 'code') && value.value) labels.push(String(value.value));
      continue;
    }
    if (typeof value === 'string') {
      if (key === 'url' || key === 'source') url = url || value;
      else if (['label', 'groupLabel', 'entity', 'name', 'group', 'reason', 'description', 'failureReason'].includes(key)) labels.push(value);
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
      if (/bytes|size/i.test(key)) nums.push(`${key}=${fmtBytes(value)}`);
      else if (/ms$|time|duration|latency/i.test(key) && !/^(startTime|endTime)$/.test(key)) nums.push(`${key}=${fmtMs(value)}`);
      else if (key === 'score' || key === 'weightedScore' || key === 'cumulativeLayoutShiftMainFrame') nums.push(`shift=${value.toFixed(3)}`);
      else if (/count|percent|wasted/i.test(key)) nums.push(`${key}=${Math.round(value * 100) / 100}`);
    }
  }
  if (item.__chainDepth != null) labels.unshift(`${'↳'.repeat(Math.min(item.__chainDepth, 4))} chain depth ${item.__chainDepth}`);

  const parts = [];
  if (url) parts.push(truncate(url, 110));
  if (node) parts.push(`element ${code(truncate(node.selector || node.nodeLabel || '', 90))}${node.snippet ? ` ${code(truncate(node.snippet, 120))}` : ''}`);
  if (labels.length) parts.push(truncate(labels.join(' · '), 120));
  if (nums.length) parts.push(nums.slice(0, 4).join(', '));
  const source = url ? sourceFor(url) : null;
  return {
    text: parts.join(' — ') || truncate(JSON.stringify(item), 140),
    url: url || undefined,
    line: line || undefined,
    selector: node?.selector,
    snippet: node?.snippet ? truncate(node.snippet, 200) : undefined,
    source: source && fs.existsSync(source) ? source : undefined,
  };
}

function estimateImpact(audit) {
  const s = audit.metricSavings || {};
  const d = audit.details || {};
  let impact =
    (s.LCP || 0) +
    (s.FCP || 0) * 0.6 +
    (s.TBT || 0) +
    (s.INP || 0) * 0.5 +
    (s.CLS || 0) * 4000 +
    (d.overallSavingsMs || 0) * 0.5 +
    (d.overallSavingsBytes || 0) / 4096;
  if (!impact && audit.score != null) impact = (1 - audit.score) * 60;
  return Math.round(impact);
}

const priorityOf = (impact, audit) =>
  impact >= 600 || (audit.metricSavings?.CLS || 0) >= 0.1 ? 'high' : impact >= 150 ? 'medium' : 'low';

function summarizeLhr(lhr, sourceFor, mode) {
  const scores = {};
  for (const [id, cat] of Object.entries(lhr.categories)) scores[id] = cat.score == null ? null : Math.round(cat.score * 100);

  const metrics = {};
  for (const [id, key, title] of METRICS) {
    const a = lhr.audits[id];
    if (!a || a.numericValue == null) continue;
    metrics[key] = { title, value: a.numericValue, display: a.displayValue, score: a.score };
  }

  // Locate the LCP element from whichever audit/insight carries it.
  let lcpElement = null;
  for (const [id, a] of Object.entries(lhr.audits)) {
    if (!/largest-contentful-paint-element|lcp-(breakdown|discovery|phases)-insight/.test(id)) continue;
    const node = flattenItems(a.details)
      .map((i) => (i.type === 'node' ? i : Object.values(i).find((v) => v && v.type === 'node')))
      .find(Boolean);
    if (node) {
      lcpElement = { selector: node.selector, snippet: truncate(node.snippet, 200), label: node.nodeLabel };
      break;
    }
  }

  const findings = [];
  const diagnostics = [];
  const seen = new Set();
  for (const catId of Object.keys(lhr.categories)) {
    for (const ref of lhr.categories[catId].auditRefs) {
      if (ref.group === 'metrics' || NOISE.has(ref.id) || seen.has(ref.id)) continue;
      const a = lhr.audits[ref.id];
      if (!a) continue;
      seen.add(ref.id);
      const failing =
        a.score != null && a.score < 0.9 && !['notApplicable', 'manual', 'informative', 'error'].includes(a.scoreDisplayMode);
      const items = flattenItems(a.details).slice(0, maxItems).map((i) => describeItem(i, sourceFor));
      if (failing) {
        const impact = catId === 'performance' ? estimateImpact(a) : Math.round((1 - a.score) * 100);
        findings.push({
          id: a.id,
          category: catId,
          title: a.title,
          score: a.score,
          displayValue: a.displayValue || undefined,
          metricSavings: a.metricSavings && Object.keys(a.metricSavings).length ? a.metricSavings : undefined,
          savingsMs: a.details?.overallSavingsMs || undefined,
          savingsBytes: a.details?.overallSavingsBytes || undefined,
          impact,
          priority: priorityOf(impact, a),
          envDependent: mode === 'dir' && ENV_DEPENDENT.has(a.id) ? true : undefined,
          items,
          totalItems: flattenItems(a.details).length,
        });
      } else if (catId === 'performance' && a.scoreDisplayMode === 'informative' && a.displayValue) {
        diagnostics.push({ id: a.id, title: a.title, displayValue: a.displayValue, items: items.slice(0, 3) });
      }
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  findings.sort((x, y) => !!x.envDependent - !!y.envDependent || rank[x.priority] - rank[y.priority] || y.impact - x.impact);
  return { scores, metrics, lcpElement, findings, diagnostics, runtimeErrors: lhr.runtimeError ? [lhr.runtimeError.message] : [], warnings: lhr.runWarnings || [] };
}

// --------------------------------------------------------------- markdown

function savingsText(f) {
  const parts = [];
  for (const [k, v] of Object.entries(f.metricSavings || {})) {
    if (!v) continue;
    parts.push(k === 'CLS' ? `CLS −${v.toFixed(3)}` : `${k} −${fmtMs(v)}`);
  }
  if (f.savingsBytes) parts.push(`−${fmtBytes(f.savingsBytes)}`);
  if (!parts.length && f.savingsMs) parts.push(`−${fmtMs(f.savingsMs)}`);
  return parts.join(', ');
}

function renderPage(page, before) {
  let md = `## ${page.name} — ${page.url}\n\n`;
  const scoreRows = Object.entries(page.scores).map(([k, v]) => {
    const prev = before?.scores?.[k];
    return [k, v ?? 'n/a', ...(before ? [prev ?? 'n/a', fmtDelta(prev, v, { lowerIsBetter: false })] : [])];
  });
  md += mdTable(['Category', 'Score', ...(before ? ['Before', 'Δ'] : [])], scoreRows);
  if (page.runScores.length > 1) md += `\nPerformance across ${page.runScores.length} runs: ${page.runScores.join(', ')} (median kept)\n`;

  md += `\n### Metrics\n\n`;
  const metricRows = Object.entries(page.metrics).map(([k, m]) => {
    const prev = before?.metrics?.[k];
    const unitDigits = k === 'CLS' ? 3 : 0;
    const status = m.score == null ? '' : m.score >= 0.9 ? '✅ good' : m.score >= 0.5 ? '🟠 needs work' : '❌ poor';
    return [
      `${k} (${m.title})`,
      m.display,
      status,
      ...(before ? [prev?.display ?? 'n/a', fmtDelta(prev?.value, m.value, { digits: unitDigits, unit: k === 'CLS' ? '' : ' ms' })] : []),
    ];
  });
  md += mdTable(['Metric', 'Value', 'Status', ...(before ? ['Before', 'Δ'] : [])], metricRows);
  if (page.lcpElement) md += `\nLCP element: ${code(page.lcpElement.selector)} ${code(page.lcpElement.snippet || '')}\n`;

  if (before) {
    const beforeIds = new Set((before.findings || []).map((f) => f.id));
    const nowIds = new Set(page.findings.map((f) => f.id));
    const resolved = [...beforeIds].filter((id) => !nowIds.has(id));
    const added = [...nowIds].filter((id) => !beforeIds.has(id));
    md += `\nResolved since baseline: ${resolved.length ? resolved.map(code).join(', ') : '_none_'}\n`;
    md += `New since baseline: ${added.length ? added.map(code).join(', ') : '_none_'}\n`;
  }

  const codeFindings = page.findings.filter((f) => !f.envDependent);
  const envFindings = page.findings.filter((f) => f.envDependent);
  md += `\n### Failing audits (${codeFindings.length}), highest estimated impact first\n\n`;
  if (!codeFindings.length) md += '_No failing audits._\n';
  codeFindings.forEach((f, i) => {
    const sv = savingsText(f);
    md += `#### ${i + 1}. [${f.priority.toUpperCase()}] ${f.title}${f.displayValue ? ` — ${f.displayValue}` : ''}\n`;
    md += `${code(f.id)} · category ${f.category} · score ${f.score}${sv ? ` · est. savings ${sv}` : ''}\n`;
    for (const it of f.items) md += `- ${it.text}${it.source ? ` → source: ${code(it.source)}` : ''}\n`;
    if (f.totalItems > f.items.length) md += `- …and ${f.totalItems - f.items.length} more (see raw JSON)\n`;
    md += '\n';
  });
  if (envFindings.length) {
    md += `### Environment-dependent findings (local audit server — verify against production)\n\n`;
    for (const f of envFindings) md += `- ${code(f.id)} ${f.title}${f.displayValue ? ` — ${f.displayValue}` : ''}\n`;
    md += '\n';
  }
  if (page.diagnostics.length) {
    md += `### Diagnostics (informative)\n\n`;
    for (const d of page.diagnostics) {
      md += `- ${code(d.id)} ${d.title} — ${d.displayValue}\n`;
      for (const it of d.items) md += `  - ${it.text}${it.source ? ` → ${code(it.source)}` : ''}\n`;
    }
    md += '\n';
  }
  if (page.warnings.length) md += `### Lighthouse warnings\n\n${page.warnings.map((w) => `- ${truncate(w, 300)}`).join('\n')}\n\n`;
  if (page.runtimeErrors.length) md += `### Runtime errors\n\n${page.runtimeErrors.map((w) => `- ${w}`).join('\n')}\n\n`;
  return md;
}

// -------------------------------------------------------------------- main

async function main() {
  const { default: lighthouse } = await importDep('lighthouse');
  const chromeLauncher = await importDep('chrome-launcher');
  const config = opts.preset === 'desktop' ? (await importDep('lighthouse/core/config/desktop-config.js')).default : undefined;

  const chromePath = await resolveChromePath(opts.chrome);
  const target = await resolveTargets(opts, NAME);
  const runDir = prepareRunDir(outRoot, opts.label);
  const before = loadComparison(outRoot, opts.compare);

  const pages = [];
  let lighthouseVersion = null;
  try {
    for (const t of target.targets) {
      const results = [];
      for (let i = 0; i < runs; i++) {
        process.stderr.write(`[${NAME}] ${t.url} (${opts.preset}) run ${i + 1}/${runs}…\n`);
        const chrome = await chromeLauncher.launch({
          chromePath,
          chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
        });
        try {
          const rr = await lighthouse(
            t.url,
            { port: chrome.port, output: ['json', 'html'], logLevel: 'error', onlyCategories: categories, throttlingMethod: opts.throttling },
            config,
          );
          if (!rr) throw new Error('Lighthouse returned no result');
          results.push(rr);
        } finally {
          await chrome.kill();
        }
      }
      const perfScore = (rr) => rr.lhr.categories.performance?.score ?? rr.lhr.categories[categories[0]]?.score ?? 0;
      const sorted = [...results].sort((a, b) => perfScore(a) - perfScore(b));
      const median = sorted[Math.floor((sorted.length - 1) / 2)];
      lighthouseVersion = median.lhr.lighthouseVersion;

      fs.writeFileSync(path.join(runDir, `${t.name}.lighthouse.json`), median.report[0]);
      fs.writeFileSync(path.join(runDir, `${t.name}.lighthouse.html`), median.report[1]);

      pages.push({
        name: t.name,
        url: t.url,
        runScores: results.map((r) => Math.round(perfScore(r) * 100)),
        rawReport: rel(path.join(runDir, `${t.name}.lighthouse.json`)),
        htmlReport: rel(path.join(runDir, `${t.name}.lighthouse.html`)),
        ...summarizeLhr(median.lhr, target.sourceFor, target.mode),
      });
    }
  } finally {
    await target.close();
  }

  const summary = {
    tool: 'perf-audit',
    schema: 1,
    label: opts.label,
    comparedTo: before ? opts.compare : undefined,
    generatedAt: new Date().toISOString(),
    lighthouseVersion,
    preset: opts.preset,
    throttling: opts.throttling,
    mode: target.mode,
    pages,
  };
  writeJson(path.join(runDir, 'summary.json'), summary);

  let md = `# Performance audit (${opts.label})\n\n`;
  md += `Lighthouse ${lighthouseVersion} · preset **${opts.preset}** · throttling ${opts.throttling} · ${runs} run(s)/page · ${summary.generatedAt}\n`;
  if (before) md += `Compared against: **${opts.compare}** (${before.generatedAt})\n`;
  if (target.mode === 'dir') md += `Served locally from ${code(rel(target.root))}; "source:" paths point at the files that produced each URL.\n`;
  md += `Lab data from a single machine: treat differences under ~5 points as noise; use --runs 3 when comparing.\n\n`;
  for (const p of pages) {
    const prev = before?.pages?.find((b) => b.name === p.name);
    md += renderPage(p, prev);
  }
  md += `---\nRaw reports: ${pages.map((p) => code(p.rawReport)).join(', ')} (large; use only for details not shown above). HTML: ${pages.map((p) => code(p.htmlReport)).join(', ')}\n`;
  writeText(path.join(runDir, 'summary.md'), md);

  for (const p of pages) {
    const s = p.scores.performance ?? Object.values(p.scores)[0];
    process.stdout.write(`${p.name}: performance ${s} · ${p.findings.filter((f) => !f.envDependent).length} failing audits\n`);
  }
  finish(NAME, runDir);
}

main().catch((err) => {
  process.stderr.write(`${NAME}: ${err.stack || err.message}\n`);
  process.exit(1);
});
