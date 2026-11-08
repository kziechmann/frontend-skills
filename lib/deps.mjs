// Resolves third-party dependencies from the plugin root and prints an
// actionable message (instead of a stack trace) when they are not installed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function importDep(name) {
  try {
    return await import(name);
  } catch (err) {
    if (err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND')) {
      process.stderr.write(
        `\n[frontend-skills] Missing dependency "${name}".\n` +
          `Install the audit tooling once with:\n\n` +
          `  npm install --prefix "${PLUGIN_ROOT}"\n\n` +
          `(Browser-based audits also need Chrome/Chromium: either a system Chrome, or\n` +
          `  npx --prefix "${PLUGIN_ROOT}" playwright install chromium)\n\n`,
      );
      process.exit(3);
    }
    throw err;
  }
}
