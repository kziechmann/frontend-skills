#!/usr/bin/env node
// Visual layout & usability audit. Loads each page at several viewports with
// Playwright, runs geometric checks (horizontal overflow/reflow, tap target
// size & spacing, overlapping content, clipped/spilling text, tiny text,
// distorted images, fixed elements covering the screen, line length) and saves
// plain + annotated full-page screenshots for the agent's visual review.
import fs from 'node:fs';
import path from 'node:path';
import { cli, TARGET_HELP } from '../../../lib/cli.mjs';
import { launchBrowser } from '../../../lib/browser.mjs';
import { resolveTargets } from '../../../lib/targets.mjs';
import { DOM_HELPERS } from '../../../lib/dom-helpers.mjs';
import { prepareRunDir, writeJson, writeText, loadComparison, mdTable, code, truncate, fmtDelta, finish, rel } from '../../../lib/output.mjs';

const NAME = 'layout-audit';
const USAGE = `Usage: node layout-audit.mjs (--url <url> | --dir <path>) [options]

Checks responsive layout and usability at several viewports and captures screenshots.
${TARGET_HELP}
Layout:
  --viewports <list>   Comma-separated WxH (default 320x640,390x844,768x1024,1440x900).
                       Widths under 768 are emulated as touch/mobile devices.
  --max-per-type <n>   Max findings per type per viewport (default 12)
  --max-height <px>    Clip full-page screenshots to this height (default 6000)
  --no-screenshots     Skip screenshots
  --wait <ms>          Extra settle time after load (default 400)
`;

const opts = cli({
  name: NAME,
  usage: USAGE,
  options: {
    viewports: { type: 'string', default: '320x640,390x844,768x1024,1440x900' },
    'max-per-type': { type: 'string', default: '12' },
    'max-height': { type: 'string', default: '6000' },
    'no-screenshots': { type: 'boolean', default: false },
    wait: { type: 'string', default: '400' },
  },
});

const outRoot = opts.out || 'audit-reports/layout';
const viewports = opts.viewports.split(',').map((v) => {
  const [width, height] = v.trim().split('x').map(Number);
  if (!width || !height) throw new Error(`bad viewport "${v}"`);
  return { width, height, mobile: width < 768 };
});
const maxPerType = parseInt(opts['max-per-type'], 10) || 12;
const maxHeight = parseInt(opts['max-height'], 10) || 6000;
const ANALYZE_SRC = fs.readFileSync(new URL('./layout-analyze.browser.js', import.meta.url), 'utf8').trim().replace(/;\s*$/, '');
const SEVERITY_ORDER = ['high', 'medium', 'low', 'info'];
const TYPE_TITLES = {
  'viewport-meta-missing': 'Missing viewport meta tag',
  'zoom-disabled': 'Pinch-zoom disabled',
  'horizontal-overflow': 'Horizontal overflow (page scrolls sideways)',
  'tap-target-too-small': 'Tap targets too small / too close (WCAG 2.5.8)',
  'tap-target-below-44': 'Tap targets under 44×44px (recommended)',
  'text-too-small': 'Text smaller than 12px',
  'body-text-small-on-mobile': 'Body text under 16px on mobile',
  'text-clipped': 'Text clipped by overflow:hidden',
  'content-spills-out': 'Content spills out of fixed-height box',
  'overlapping-content': 'Overlapping content',
  'fixed-element-covers-viewport': 'Fixed/sticky element covers too much of the screen',
  'image-distorted': 'Distorted image (aspect ratio)',
  'image-upscaled': 'Upscaled (blurry) image',
  'line-length-too-long': 'Lines too long to read comfortably',
  'line-height-tight': 'Tight line height',
};

async function annotate(page, issues) {
  await page.evaluate((list) => {
    const layer = document.createElement('div');
    layer.id = '__fs-annotations';
    const docW = document.documentElement.scrollWidth;
    const docH = document.documentElement.scrollHeight;
    layer.style.cssText = `position:absolute;left:0;top:0;width:${docW}px;height:${docH}px;overflow:hidden;z-index:2147483647;pointer-events:none`;
    const colors = { high: '#e00000', medium: '#ff8c00', low: '#1e6fff' };
    for (const i of list) {
      if (!i.rect || !i.annotation) continue;
      const box = document.createElement('div');
      const c = colors[i.severity] || '#888';
      box.style.cssText = `position:absolute;left:${i.rect.x}px;top:${i.rect.y}px;width:${Math.max(i.rect.width, 4)}px;height:${Math.max(i.rect.height, 4)}px;outline:3px solid ${c};background:${c}22;box-sizing:border-box`;
      const tag = document.createElement('span');
      tag.textContent = `#${i.annotation} ${i.type}`;
      const nearRight = i.rect.x + 220 > docW;
      const nearTop = i.rect.y < 18;
      tag.style.cssText = `position:absolute;${nearRight ? 'right:0' : 'left:0'};${nearTop ? 'bottom:-18px' : 'top:-18px'};font:bold 11px/16px monospace;color:#fff;background:${c};padding:0 4px;white-space:nowrap`;
      box.appendChild(tag);
      layer.appendChild(box);
    }
    document.body.appendChild(layer);
  }, issues);
}

async function main() {
  const target = await resolveTargets(opts, NAME);
  const runDir = prepareRunDir(outRoot, opts.label);
  const shotDir = path.join(runDir, 'screenshots');
  if (!opts['no-screenshots']) fs.mkdirSync(shotDir, { recursive: true });
  const before = loadComparison(outRoot, opts.compare);
  const browser = await launchBrowser({ chrome: opts.chrome });
  const pages = [];
  try {
    for (const t of target.targets) {
      const results = [];
      for (const vp of viewports) {
        process.stderr.write(`[${NAME}] ${t.url} @ ${vp.width}x${vp.height}${vp.mobile ? ' (mobile)' : ''}…\n`);
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.mobile,
          hasTouch: vp.mobile,
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        await page.goto(t.url, { waitUntil: 'load', timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
        await page.waitForTimeout(parseInt(opts.wait, 10) || 0);
        await page.evaluate(DOM_HELPERS);
        const result = await page.evaluate(`(${ANALYZE_SRC})(${JSON.stringify({ mobile: vp.mobile, maxPerType, height: vp.height })})`);
        result.mobile = vp.mobile;
        result.issues.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

        if (!opts['no-screenshots']) {
          const base = `${t.name}-${vp.width}x${vp.height}`;
          const clip = result.docHeight > maxHeight ? { x: 0, y: 0, width: vp.width, height: maxHeight } : undefined;
          const plain = path.join(shotDir, `${base}.png`);
          await page.screenshot({ path: plain, fullPage: true, clip });
          result.screenshot = rel(plain);
          if (result.issues.some((i) => i.annotation)) {
            await annotate(page, result.issues);
            const annotated = path.join(shotDir, `${base}-annotated.png`);
            await page.screenshot({ path: annotated, fullPage: true, clip });
            result.annotatedScreenshot = rel(annotated);
          }
        }
        results.push(result);
        await context.close();
      }
      pages.push({ name: t.name, url: t.url, viewports: results });
    }
  } finally {
    await browser.close();
    await target.close();
  }

  const totals = { high: 0, medium: 0, low: 0 };
  const byType = {};
  for (const p of pages) {
    for (const v of p.viewports) {
      for (const [type, n] of Object.entries(v.counts)) byType[type] = (byType[type] || 0) + n;
      for (const i of v.issues) if (totals[i.severity] !== undefined) totals[i.severity]++;
    }
  }
  const summary = {
    tool: 'layout-audit',
    schema: 1,
    label: opts.label,
    comparedTo: before ? opts.compare : undefined,
    generatedAt: new Date().toISOString(),
    viewports: viewports.map((v) => `${v.width}x${v.height}`),
    totals,
    byType,
    pages,
  };
  writeJson(path.join(runDir, 'summary.json'), summary);

  // ---------------------------------------------------------- markdown
  let md = `# Layout & usability audit (${opts.label})\n\nViewports: ${summary.viewports.map(code).join(', ')} · ${summary.generatedAt}\n`;
  if (before) md += `Compared against: **${opts.compare}** (${before.generatedAt})\n`;
  md += `\nGeometric checks find mechanical defects. Also LOOK at the screenshots below — hierarchy, alignment, spacing rhythm and CTA clarity need human (or model) judgment.\n\n`;
  md += `## Totals\n\n`;
  const types = [...new Set([...Object.keys(byType), ...Object.keys(before?.byType || {})])];
  md += mdTable(
    ['Finding', 'Count', ...(before ? ['Before', 'Δ'] : [])],
    types.map((t) => [TYPE_TITLES[t] || t, byType[t] || 0, ...(before ? [before.byType?.[t] || 0, fmtDelta(before.byType?.[t] || 0, byType[t] || 0)] : [])]),
  );
  md += `\nSeverity: ${totals.high} high · ${totals.medium} medium · ${totals.low} low\n\n`;

  for (const p of pages) {
    md += `## ${p.name} — ${p.url}\n\n`;
    md += mdTable(
      ['Viewport', 'Sideways scroll', 'High', 'Medium', 'Low', 'Screenshot', 'Annotated'],
      p.viewports.map((v) => [
        v.viewport + (v.mobile ? ' 📱' : ''),
        v.horizontalOverflow ? `❌ ${v.docWidth}px` : '✅',
        v.issues.filter((i) => i.severity === 'high').length,
        v.issues.filter((i) => i.severity === 'medium').length,
        v.issues.filter((i) => i.severity === 'low').length,
        v.screenshot || '',
        v.annotatedScreenshot || '',
      ]),
    );
    for (const v of p.viewports) {
      if (!v.issues.length) continue;
      md += `\n### ${v.viewport}${v.mobile ? ' (mobile/touch)' : ''}\n\n`;
      let lastType = null;
      for (const i of v.issues) {
        if (i.type !== lastType) {
          md += `\n**[${i.severity.toUpperCase()}] ${TYPE_TITLES[i.type] || i.type}**${i.wcag ? ` · WCAG ${i.wcag}` : ''}\n`;
          lastType = i.type;
        }
        if (!i.selector) {
          md += `- ${i.detail}\n`;
          continue;
        }
        md += `- ${i.annotation ? `#${i.annotation} ` : ''}${code(i.selector)} — ${i.detail}\n  - ${code(truncate(i.snippet, 140))}${i.rect ? ` at (${i.rect.x},${i.rect.y}) ${i.rect.width}×${i.rect.height}` : ''}\n`;
      }
      md += `\nScale check: ${v.stats.distinctFontSizes.length} font sizes (${v.stats.distinctFontSizes.join(', ')}), ${v.stats.distinctSpacingValues.length} spacing values, ${v.stats.distinctLeftEdges} distinct left edges for block content.\n`;
    }
    md += '\n';
  }

  md += `## Visual review checklist (look at the screenshots)\n\n`;
  md += [
    'Visual hierarchy: one clear primary action per view; headings visibly outrank body text',
    'Alignment: content shares a small number of left edges / grid columns; nothing is "almost" aligned',
    'Spacing rhythm: spacing comes from a consistent scale (e.g. 4/8px multiples); related items are closer than unrelated ones',
    'Typography: a limited type scale (≈4–6 sizes), readable line length (45–90ch), comfortable line height',
    'Responsiveness: layout adapts (stacks, reflows) rather than shrinking or cropping; no content lost at 320px',
    'Affordances: links and buttons look interactive; states (hover/focus/disabled/error) are distinguishable',
    'Above the fold on mobile: the main content/CTA is visible, not buried under banners or a giant hero',
  ]
    .map((s) => `- [ ] ${s}`)
    .join('\n');
  md += '\n';
  writeText(path.join(runDir, 'summary.md'), md);

  for (const p of pages) {
    for (const v of p.viewports) {
      process.stdout.write(`${p.name} @ ${v.viewport}: ${v.horizontalOverflow ? 'OVERFLOW ' : ''}${v.issues.filter((i) => i.severity !== 'info').length} findings\n`);
    }
  }
  finish(NAME, runDir, opts['no-screenshots'] ? '' : `; screenshots in ${rel(shotDir)}`);
}

main().catch((err) => {
  process.stderr.write(`${NAME}: ${err.stack || err.message}\n`);
  process.exit(1);
});
