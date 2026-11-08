import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EVALS = path.join(ROOT, 'evals');

export function loadCases() {
  return fs
    .readdirSync(EVALS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(EVALS, d.name, 'case.yaml')))
    .map((d) => {
      const dir = path.join(EVALS, d.name);
      const data = YAML.parse(fs.readFileSync(path.join(dir, 'case.yaml'), 'utf8'));
      return { dirName: d.name, dir, data, fixture: fixtureOf(dir) };
    });
}

export function fixtureOf(caseDir) {
  const scaffold = path.join(caseDir, 'scaffold.sh');
  if (!fs.existsSync(scaffold)) return null;
  const m = /stage-fixture\.sh"?\s+([\w-]+)\s*$/m.exec(fs.readFileSync(scaffold, 'utf8'));
  return m ? m[1] : null;
}

export function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fe-skills-${prefix}-`));
}

/** Runs a case's scaffold script in a fresh directory, like `claude plugin eval --scaffold`. */
export function stageCase(c) {
  const dir = tmpDir(c.dirName);
  execFileSync('bash', [path.join(c.dir, c.data.context.scaffold_script)], { cwd: dir, stdio: 'pipe' });
  return dir;
}

export function stageFixture(name) {
  const dir = tmpDir(name);
  execFileSync('bash', [path.join(EVALS, 'fixtures/_tools/stage-fixture.sh'), name], { cwd: dir, stdio: 'pipe' });
  return dir;
}

export function applySolution(dir, fixture) {
  const src = path.join(EVALS, 'solutions', fixture);
  if (!fs.existsSync(src)) throw new Error(`no solution for ${fixture}`);
  fs.cpSync(src, dir, { recursive: true });
}

/** Graders that can be checked without running an agent: regex/file_exists on workspace files. */
export function deterministicGraders(c) {
  return c.data.graders.filter((g) => {
    if (g.arm === 'with-only') return false;
    if (g.type === 'regex') return typeof g.target === 'object' && g.target.source === 'file' && !g.target.path.startsWith('audit-reports/');
    if (g.type === 'file_exists') return !g.path.startsWith('audit-reports/');
    return false;
  });
}

/** Re-implements the harness's regex / file_exists semantics. */
export function evaluateGrader(g, dir) {
  if (g.type === 'file_exists') return fs.existsSync(path.join(dir, g.path)) === (g.exists ?? true);
  const file = path.join(dir, g.target.path);
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  const flags = g.flags || '';
  const re = new RegExp(g.pattern, flags);
  const match = g.match || 'contains';
  if (match === 'contains') return re.test(text);
  if (match === 'not_contains') return !re.test(text);
  const n = Number(match.slice('count:'.length));
  return (text.match(new RegExp(g.pattern, flags.includes('g') ? flags : flags + 'g')) || []).length === n;
}

export function runScript(script, args, cwd) {
  const res = spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd, encoding: 'utf8', timeout: 240000 });
  if (res.status !== 0) throw new Error(`${script} exited ${res.status}\n${res.stderr}\n${res.stdout}`);
  return res;
}

export function readSummary(dir, audit, label) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'audit-reports', audit, label, 'summary.json'), 'utf8'));
}
