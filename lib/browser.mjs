// Locates a Chrome/Chromium binary and launches Playwright with it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importDep } from './deps.mjs';

const COMMON_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const exists = (p) => {
  try {
    return Boolean(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// chrome-headless-shell (installed by `npx playwright install chromium`) is
// preferred: it is lighter and, unlike full Chrome in --headless=new mode, it
// does not open a Unix-socket process singleton, so it also runs inside
// sandboxes that block socket() (e.g. the Claude Code / `claude plugin eval`
// sandbox on Linux).
function findHeadlessShell() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
  ].filter((r) => r && r !== '0');
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-'));
    } catch {
      continue;
    }
    entries.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of entries) {
      for (const sub of ['chrome-headless-shell-linux64', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-win64', 'chrome-linux', 'chrome-mac', 'chrome-win']) {
        for (const bin of ['chrome-headless-shell', 'chrome-headless-shell.exe', 'headless_shell', 'headless_shell.exe']) {
          const p = path.join(root, dir, sub, bin);
          if (exists(p)) return p;
        }
      }
    }
  }
  return null;
}

export async function resolveChromePath(explicit) {
  if (explicit) {
    if (!exists(explicit)) throw new Error(`--chrome ${explicit} does not exist`);
    return explicit;
  }
  const fromEnv = [process.env.FRONTEND_AUDIT_CHROME];
  for (const p of fromEnv) if (exists(p)) return p;

  const shell = findHeadlessShell();
  if (shell) return shell;

  try {
    const { chromium } = await import('playwright');
    const managed = chromium.executablePath();
    if (exists(managed)) return managed;
  } catch {
    /* playwright missing or no managed browser; keep looking */
  }

  for (const p of [process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH, ...COMMON_PATHS]) {
    if (exists(p)) return p;
  }
  throw new Error(
    'No Chrome/Chromium found. Install one (e.g. `npx playwright install chromium`) or pass --chrome <path> / set FRONTEND_AUDIT_CHROME.',
  );
}

export async function launchBrowser({ chrome } = {}) {
  const { chromium } = await importDep('playwright');
  const executablePath = await resolveChromePath(chrome);
  try {
    return await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  } catch (err) {
    if (/socket\(\) failed|Operation not permitted/.test(String(err.message))) {
      throw new Error(
        `Chrome could not start (${executablePath}): the environment blocks the sockets full Chrome needs. ` +
          'Install chrome-headless-shell (`npx playwright install chromium`, it is preferred automatically) or point FRONTEND_AUDIT_CHROME at it.',
      );
    }
    throw err;
  }
}
