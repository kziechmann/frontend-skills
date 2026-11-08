// Locates a Chrome/Chromium binary and launches Playwright with it.
import fs from 'node:fs';
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

export async function resolveChromePath(explicit) {
  if (explicit) {
    if (!exists(explicit)) throw new Error(`--chrome ${explicit} does not exist`);
    return explicit;
  }
  const fromEnv = [process.env.FRONTEND_AUDIT_CHROME];
  for (const p of fromEnv) if (exists(p)) return p;

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
  return chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}
