#!/usr/bin/env node
// Generates the heavy, deliberately unoptimized assets for the perf-site
// fixture so they do not have to be committed: PNG photos (noisy, so they
// barely compress), an unminified vendor bundle that is ~95% unused, and a
// legacy CSS framework the page never uses. Deterministic (seeded PRNG).
// Usage: node generate-perf-assets.mjs <site-dir>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: generate-perf-assets.mjs <site-dir>');
  process.exit(2);
}

let seed = 1337;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// ------------------------------------------------------------------- PNG
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, [r0, g0, b0], [r1, g1, b1], noise) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    const t = y / height;
    for (let x = 0; x < width; x++) {
      const s = (x / width + t) / 2;
      const n = (rand() - 0.5) * noise;
      raw[o++] = Math.max(0, Math.min(255, r0 + (r1 - r0) * s + n));
      raw[o++] = Math.max(0, Math.min(255, g0 + (g1 - g0) * s + n));
      raw[o++] = Math.max(0, Math.min(255, b0 + (b1 - b0) * s + n));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
fs.writeFileSync(path.join(dir, 'img/hero.png'), png(1280, 720, [233, 140, 80], [40, 70, 110], 6));
const palettes = [
  [[60, 90, 60], [200, 210, 160]],
  [[90, 60, 40], [220, 180, 120]],
  [[30, 60, 90], [150, 190, 220]],
  [[80, 80, 80], [210, 210, 200]],
  [[110, 40, 40], [230, 160, 140]],
  [[40, 80, 70], [170, 220, 200]],
];
palettes.forEach(([a, b], i) => fs.writeFileSync(path.join(dir, `img/gallery-${i + 1}.png`), png(800, 533, a, b, 8)));

// ------------------------------------------------------------- vendor JS
fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
let js = `/*!\n * Vendor bundle v3.2.1 — utilities, polyfills and widgets.\n * Bundled in full; the page uses one function (formatPrice).\n */\n(function (global) {\n  'use strict';\n  var Vendor = {};\n\n`;
js += `  /**\n   * Format a number as US dollars.\n   * @param {number|string} value\n   */\n  Vendor.formatPrice = function formatPrice(value) {\n    var n = Number(value);\n    return '$' + n.toFixed(0);\n  };\n\n`;
for (let i = 0; i < 420; i++) {
  js += `  /**\n   * Widget helper #${i}: computes a layout matrix for carousel slide ${i}.\n   * Kept for backwards compatibility with v1 themes.\n   */\n`;
  const table = Array.from({ length: 24 }, () => Math.round(rand() * 1e6).toString(36)).join("', '");
  js += `  Vendor.helper${i} = function helper${i}(items, options) {\n    var table = ['${table}'];\n    var result = [];\n    options = options || {};\n    for (var j = 0; j < items.length; j++) {\n      var value = items[j] * ${(rand() * 10).toFixed(3)} + (options.offset || ${i});\n      if (value > ${Math.round(rand() * 1000)}) { result.push(Math.round(value)); } else { result.push(value / 2); }\n    }\n    return result;\n  };\n\n`;
}
js += `  global.Vendor = Vendor;\n})(window);\n`;
fs.writeFileSync(path.join(dir, 'js/vendor-bundle.js'), js);

// ----------------------------------------------------------- legacy CSS
fs.mkdirSync(path.join(dir, 'css'), { recursive: true });
let css = `/* Legacy UI framework v2 — full build. Not used by the current design. */\n`;
const props = ['margin', 'padding', 'border', 'color', 'background', 'font-size', 'line-height', 'width'];
for (let i = 0; i < 700; i++) {
  css += `.fw-component-${i} .fw-element-${i % 40} {\n  ${props[i % props.length]}: ${Math.round(rand() * 40)}px;\n  display: ${i % 3 ? 'block' : 'inline-block'};\n  box-shadow: 0 ${i % 7}px ${i % 11}px rgba(0, 0, 0, 0.${i % 9});\n}\n`;
}
fs.writeFileSync(path.join(dir, 'css/legacy-framework.css'), css);

const kb = (f) => (fs.statSync(path.join(dir, f)).size / 1024).toFixed(0) + ' KiB';
console.log(`generated perf assets in ${dir}: hero.png ${kb('img/hero.png')}, vendor-bundle.js ${kb('js/vendor-bundle.js')}, legacy-framework.css ${kb('css/legacy-framework.css')}`);
