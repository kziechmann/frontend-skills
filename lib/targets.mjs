// Turns --url / --dir / --pages into a list of page targets. For --dir runs it
// starts a local static server and can map served URLs back to source files,
// which lets summaries print "source: css/main.css" next to a finding.
import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer } from './static-server.mjs';

export function slugify(input) {
  return (
    String(input)
      .replace(/^https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'page'
  );
}

export async function resolveTargets(opts, toolName) {
  const urls = opts.url || [];
  if (!urls.length && !opts.dir) {
    throw new Error(`${toolName}: pass --url <url> or --dir <static-site-dir> (see --help)`);
  }
  if (urls.length && opts.dir) {
    throw new Error(`${toolName}: use either --url or --dir, not both`);
  }

  if (urls.length) {
    const targets = urls.map((u) => {
      const parsed = new URL(u);
      return { url: parsed.href, name: slugify(parsed.pathname === '/' ? parsed.host : parsed.host + parsed.pathname) };
    });
    return { targets, mode: 'url', sourceFor: () => null, close: async () => {} };
  }

  const server = await startStaticServer(opts.dir);
  let pages = (opts.pages || '')
    .split(',')
    .map((p) => p.trim().replace(/^\/+/, ''))
    .filter(Boolean);
  if (!pages.length) {
    if (fs.existsSync(path.join(server.root, 'index.html'))) pages = ['index.html'];
    else {
      const html = fs.readdirSync(server.root).filter((f) => f.endsWith('.html'));
      if (!html.length) throw new Error(`${toolName}: no .html files in ${opts.dir}; pass --pages`);
      pages = [html[0]];
    }
  }
  for (const p of pages) {
    if (!fs.existsSync(path.join(server.root, p))) throw new Error(`${toolName}: ${p} not found in ${opts.dir}`);
  }

  const targets = pages.map((p) => ({ url: `${server.origin}/${p}`, name: slugify(p.replace(/\.html?$/, '')) }));

  // Map a URL served by the local server back to a path relative to the CWD.
  const sourceFor = (url) => {
    if (!url || !url.startsWith(server.origin)) return null;
    try {
      const pathname = decodeURIComponent(new URL(url).pathname);
      let file = path.join(server.root, pathname);
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      return path.relative(process.cwd(), file) || '.';
    } catch {
      return null;
    }
  };

  return { targets, mode: 'dir', origin: server.origin, root: server.root, sourceFor, close: server.close };
}
