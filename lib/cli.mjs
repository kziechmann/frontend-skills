// Small wrapper around node:util parseArgs with consistent help output and
// the target options shared by every browser-based audit.
import { parseArgs } from 'node:util';

export const TARGET_OPTIONS = {
  url: { type: 'string', multiple: true },
  dir: { type: 'string' },
  pages: { type: 'string' },
  out: { type: 'string' },
  label: { type: 'string', default: 'latest' },
  compare: { type: 'string' },
  chrome: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

export const TARGET_HELP = `
Target (pick one):
  --url <url>          Page to audit. Repeat for several pages.
  --dir <path>         Static site directory to serve locally (e.g. dist/, build/, .)
  --pages <list>       With --dir: comma-separated pages, e.g. "index.html,pricing.html"
                       (default: index.html)

Output:
  --out <dir>          Output root (default: audit-reports/<audit>)
  --label <name>       Run label; results go to <out>/<label>/ (default: latest).
                       Use "baseline" before changes and "after" once fixes are in.
  --compare <label>    Compare this run against <out>/<label>/summary.json

Browser:
  --chrome <path>      Chrome/Chromium executable (default: auto-detect)
`;

export function cli({ name, usage, options }) {
  let parsed;
  try {
    parsed = parseArgs({ options: { ...TARGET_OPTIONS, ...options }, allowPositionals: false, strict: true });
  } catch (err) {
    process.stderr.write(`${name}: ${err.message}\n\n${usage}`);
    process.exit(2);
  }
  if (parsed.values.help) {
    process.stdout.write(usage);
    process.exit(0);
  }
  return parsed.values;
}

export function fail(name, message) {
  process.stderr.write(`${name}: ${message}\n`);
  process.exit(2);
}
