// Output helpers shared by all audits: run directories, JSON/Markdown writers,
// baseline comparison and small Markdown formatting utilities.
import fs from 'node:fs';
import path from 'node:path';

export function prepareRunDir(outRoot, label) {
  if (!/^[\w.-]+$/.test(label)) throw new Error(`--label must be alphanumeric (got "${label}")`);
  const dir = path.resolve(outRoot, label);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (['EROFS', 'EACCES', 'EPERM', 'ENOENT'].includes(err.code)) {
      throw new Error(`cannot write audit output to ${dir} (${err.code}). Pass --out <writable directory>.`);
    }
    throw err;
  }
  return dir;
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n');
}

export function loadComparison(outRoot, label) {
  if (!label) return null;
  const file = path.resolve(outRoot, label, 'summary.json');
  if (!fs.existsSync(file)) {
    process.stderr.write(`warning: --compare ${label}: ${file} not found; skipping comparison\n`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const rel = (p) => path.relative(process.cwd(), p) || '.';

export function truncate(str, max = 160) {
  const s = String(str ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function mdEscape(str) {
  return String(str ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function mdTable(headers, rows) {
  if (!rows.length) return '_none_\n';
  const head = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n`;
  return head + rows.map((r) => `| ${r.map((c) => mdEscape(c)).join(' | ')} |`).join('\n') + '\n';
}

export function code(str) {
  const s = String(str ?? '').replace(/`/g, "'");
  return '`' + s + '`';
}

export function fmtDelta(before, after, { lowerIsBetter = true, unit = '', digits = 0 } = {}) {
  if (before == null || after == null) return 'n/a';
  const d = after - before;
  if (Math.abs(d) < Math.pow(10, -digits) / 2) return '±0';
  const better = lowerIsBetter ? d < 0 : d > 0;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(digits)}${unit} ${better ? '✅' : '⚠️'}`;
}

export function finish(toolName, runDir, extra = '') {
  process.stdout.write(
    `\n${toolName}: wrote ${rel(path.join(runDir, 'summary.md'))} (read this first) and ${rel(path.join(runDir, 'summary.json'))}${extra}\n`,
  );
}
