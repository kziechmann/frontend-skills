#!/usr/bin/env node
// Visual regression guard for CSS refactors. Capture screenshots before
// changing anything (--label baseline), then capture again with
// --compare baseline: every screenshot is pixel-diffed in Chromium (no extra
// dependencies) and a red-highlighted diff image is written next to it.
import fs from 'node:fs';
import path from 'node:path';
import { cli, TARGET_HELP } from '../../../lib/cli.mjs';
import { launchBrowser } from '../../../lib/browser.mjs';
import { resolveTargets } from '../../../lib/targets.mjs';
import { prepareRunDir, writeJson, writeText, mdTable, code, finish, rel } from '../../../lib/output.mjs';

const NAME = 'visual-diff';
const USAGE = `Usage: node visual-diff.mjs (--url <url> | --dir <path>) --label <name> [--compare <label>] [options]

  1) Before refactoring:  --label baseline
  2) After refactoring:   --label after --compare baseline
${TARGET_HELP}
Diff:
  --viewports <list>   Comma-separated WxH (default 390x844,1280x800)
  --threshold <n>      Per-channel difference (0-255) treated as a changed pixel (default 32)
  --tolerance <pct>    % of changed pixels reported as "unchanged" (default 0.1)
  --max-height <px>    Clip full-page captures (default 5000)
`;

const opts = cli({
  name: NAME,
  usage: USAGE,
  options: {
    viewports: { type: 'string', default: '390x844,1280x800' },
    threshold: { type: 'string', default: '32' },
    tolerance: { type: 'string', default: '0.1' },
    'max-height': { type: 'string', default: '5000' },
  },
});
const outRoot = opts.out || 'audit-reports/css/visual';
const viewports = opts.viewports.split(',').map((v) => v.trim().split('x').map(Number));
const threshold = Number(opts.threshold);
const tolerance = Number(opts.tolerance);
const maxHeight = Number(opts['max-height']);

async function diffImages(page, aPath, bPath) {
  const toData = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
  return page.evaluate(
    async ({ a, b, threshold }) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const pixels = (img) => {
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const pa = pixels(ia);
      const pb = pixels(ib);
      const out = new ImageData(w, h);
      let changed = 0;
      let minY = h;
      let maxY = -1;
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
        if (d > threshold) {
          changed++;
          const y = Math.floor(i / 4 / w);
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          out.data.set([255, 0, 0, 255], i);
        } else {
          const g = (pb[i] + pb[i + 1] + pb[i + 2]) / 3;
          out.data.set([g, g, g, 60], i);
        }
      }
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d').putImageData(out, 0, 0);
      const blob = await c.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return {
        width: w,
        height: h,
        sizeA: [ia.width, ia.height],
        sizeB: [ib.width, ib.height],
        changed,
        pct: (changed / (w * h)) * 100,
        rows: maxY >= 0 ? [minY, maxY] : null,
        png: btoa(bin),
      };
    },
    { a: toData(aPath), b: toData(bPath), threshold },
  );
}

async function main() {
  const target = await resolveTargets(opts, NAME);
  const runDir = prepareRunDir(outRoot, opts.label);
  const browser = await launchBrowser({ chrome: opts.chrome });
  const shots = [];
  try {
    for (const t of target.targets) {
      for (const [width, height] of viewports) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768, reducedMotion: 'reduce' });
        const page = await context.newPage();
        await page.goto(t.url, { waitUntil: 'load', timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
        const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        const file = path.join(runDir, `${t.name}-${width}x${height}.png`);
        await page.screenshot({
          path: file,
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
          clip: docHeight > maxHeight ? { x: 0, y: 0, width, height: maxHeight } : undefined,
        });
        shots.push({ page: t.name, viewport: `${width}x${height}`, file: rel(file) });
        await context.close();
      }
    }

    if (opts.compare) {
      const baseDir = path.resolve(outRoot, opts.compare);
      const page = await browser.newPage();
      for (const s of shots) {
        const before = path.join(baseDir, path.basename(s.file));
        if (!fs.existsSync(before)) {
          s.status = 'no-baseline';
          continue;
        }
        const d = await diffImages(page, before, s.file);
        const diffFile = path.join(runDir, path.basename(s.file).replace(/\.png$/, '.diff.png'));
        fs.writeFileSync(diffFile, Buffer.from(d.png, 'base64'));
        Object.assign(s, {
          baseline: rel(before),
          diff: rel(diffFile),
          changedPixels: d.changed,
          changedPct: Math.round(d.pct * 1000) / 1000,
          sizeChanged: d.sizeA.join('x') !== d.sizeB.join('x') ? `${d.sizeA.join('x')} → ${d.sizeB.join('x')}` : null,
          changedRows: d.rows,
          status: d.pct <= tolerance && d.sizeA.join('x') === d.sizeB.join('x') ? 'unchanged' : 'changed',
        });
      }
    }
  } finally {
    await browser.close();
    await target.close();
  }

  const summary = { tool: 'visual-diff', schema: 1, label: opts.label, comparedTo: opts.compare, generatedAt: new Date().toISOString(), threshold, tolerance, shots };
  writeJson(path.join(runDir, 'summary.json'), summary);
  let md = `# Visual diff (${opts.label}${opts.compare ? ` vs ${opts.compare}` : ''})\n\n`;
  if (!opts.compare) {
    md += `Captured ${shots.length} screenshot(s). After making changes, re-run with ${code(`--label after --compare ${opts.label}`)}.\n\n`;
    md += mdTable(['Page', 'Viewport', 'Screenshot'], shots.map((s) => [s.page, s.viewport, s.file]));
  } else {
    const changed = shots.filter((s) => s.status === 'changed');
    md += changed.length
      ? `⚠️ ${changed.length} of ${shots.length} screenshot(s) changed. Open the .diff.png files (red = changed pixels) and confirm every change is intended.\n\n`
      : `✅ No visual changes beyond ${tolerance}% tolerance across ${shots.length} screenshot(s).\n\n`;
    md += mdTable(
      ['Page', 'Viewport', 'Status', 'Changed px', 'Size change', 'Changed rows (y)', 'Diff image'],
      shots.map((s) => [s.page, s.viewport, s.status === 'changed' ? '⚠️ changed' : s.status === 'unchanged' ? '✅ unchanged' : s.status, s.changedPct != null ? `${s.changedPct}%` : '', s.sizeChanged || '', s.changedRows ? `${s.changedRows[0]}–${s.changedRows[1]}` : '', s.diff || '']),
    );
  }
  writeText(path.join(runDir, 'summary.md'), md);
  for (const s of shots) process.stdout.write(`${s.page} @ ${s.viewport}: ${s.status ? `${s.status}${s.changedPct != null ? ` (${s.changedPct}%)` : ''}` : 'captured'}\n`);
  finish(NAME, runDir);
}

main().catch((err) => {
  process.stderr.write(`${NAME}: ${err.stack || err.message}\n`);
  process.exit(1);
});
