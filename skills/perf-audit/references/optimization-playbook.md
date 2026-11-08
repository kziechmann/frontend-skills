# Performance optimization playbook

Indexed by Lighthouse audit id (Lighthouse 12/13 ids; older equivalents in parentheses).
For each: what it means → how to find the cause → fixes → framework notes.

---

## Metrics cheat sheet

| Metric | Good | Mostly driven by |
| --- | --- | --- |
| LCP (Largest Contentful Paint) | ≤ 2.5 s | TTFB, render-blocking resources, LCP resource discovery/priority, LCP resource size |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | Unsized media, late-injected content above existing content, web-font swaps, animations of layout properties |
| TBT (lab proxy for INP) | ≤ 200 ms | Long JS tasks during load: parsing/executing large bundles, synchronous init, hydration |
| INP (field only) | ≤ 200 ms | Long event handlers, heavy re-renders, layout thrashing |
| FCP | ≤ 1.8 s | Render-blocking CSS/JS, TTFB, font loading |

When LCP is bad, look at the **LCP breakdown**: TTFB → resource load delay (discovery) →
resource load duration (bytes) → element render delay (blocking JS/CSS). Fix the biggest phase.

---

## render-blocking-insight (render-blocking-resources)
Scripts without `defer`/`async`/`type=module` in `<head>`, and stylesheets, block first paint.
- **Find:** the listed URLs; `<script src>` in `<head>`; `<link rel=stylesheet>`; CSS `@import`.
- **Fix:** add `defer` (keeps order, runs after parse) or `async` (independent scripts like
  analytics); move non-critical CSS out of the critical path (`media="print" onload="this.media='all'"`
  pattern or load per route); replace CSS `@import` with `<link>` or bundle; inline small critical CSS.
- **Careful:** inline scripts that depend on a deferred library must also run after it
  (move them into the deferred file or wrap in `DOMContentLoaded`).
- **Frameworks:** Next.js `next/script` with `strategy="afterInteractive"|"lazyOnload"`; Nuxt
  `useHead({ script: [{ src, defer: true }] })`; Vite/Angular already emit module scripts — look
  for hand-added `<script>` tags in `index.html`.

## network-dependency-tree-insight (critical-request-chains)
Long serial chains: HTML → CSS → `@import` CSS → font, or JS that injects more JS.
- **Fix:** flatten chains (`<link>` instead of `@import`, bundle), `<link rel="preload">` for
  late-discovered critical assets (fonts, LCP image set from CSS/JS), `preconnect` to required
  third-party origins (max 2–4).

## lcp-discovery-insight (prioritize-lcp-image, lcp-lazy-loaded)
- `loading="lazy"` on the LCP image → remove it (lazy-loading is for below-the-fold only).
- Add `fetchpriority="high"` to the LCP `<img>`.
- LCP image not in initial HTML (CSS background, JS-rendered, client-side routing) → render it
  in HTML, or `<link rel="preload" as="image" href=… imagesrcset=… fetchpriority="high">`.
- **Frameworks:** Next.js `<Image priority />` (or `preload`/`fetchPriority="high"` in newer versions);
  Nuxt Image `preload`; Angular `NgOptimizedImage` with `priority`.

## lcp-breakdown-insight / lcp-phases-insight (largest-contentful-paint-element)
Shows the LCP element and which phase dominates. Use it to choose between the fixes above,
image-delivery fixes, and TTFB/server work.

## image-delivery-insight (uses-optimized-images, modern-image-formats, uses-responsive-images, offscreen-images)
- Oversized dimensions → resize to the largest rendered size × 2 (DPR) and add `srcset` + `sizes`.
- Heavy format → AVIF/WebP (keep a fallback via `<picture>` if older browsers matter), quality 70–80.
- Below-the-fold images → `loading="lazy" decoding="async"`.
- Animated GIF → `<video autoplay muted loop playsinline>` (MP4/WebM).
- **Tools (if available):** `npx sharp-cli`, `cwebp`, `avifenc`, `magick`, Python Pillow, `squoosh-cli`.
- **Frameworks:** Next `next/image`, Nuxt Image, Astro `<Image>`, Angular `NgOptimizedImage` handle
  formats/srcset when configured; check the loader/CDN config before hand-encoding.

## unsized-images / cls-culprits-insight / layout-shifts
- `<img>`/`<video>`/`<iframe>` without `width`+`height` (or CSS `aspect-ratio`) → add intrinsic
  dimensions; keep `height: auto` in CSS so they stay responsive.
- Content injected above existing content (promo bars, cookie banners, ads, embeds) → reserve
  the space (`min-height` on the slot), render it server-side, or overlay it (fixed/absolute)
  instead of pushing content down.
- Web fonts causing reflow → `font-display: optional` or metric overrides (`size-adjust`,
  `ascent-override`) on the fallback font; preload the main font file.
- Animations of `top/left/width/height/margin` → `transform`/`opacity`.

## bootup-time / mainthread-work-breakdown / long-tasks / total-blocking-time
- Identify the script (URL) with the most execution time.
- Synchronous init on load (analytics, A/B testing, chat widgets) → defer to
  `requestIdleCallback`/after `load`, or load the vendor snippet `async`.
- Long loops/parsing → chunk the work (yield with `await scheduler.yield?.()` / `setTimeout(0)`),
  move to a Web Worker, or memoize.
- Large framework hydration → code-split routes, lazy-hydrate below-the-fold islands
  (Astro islands, `React.lazy` + `Suspense`, Nuxt `<LazyComponent>`, Angular `@defer`).

## forced-reflow-insight
JS reads layout (`offsetHeight`, `getBoundingClientRect`, `getComputedStyle`) right after writing
styles, in a loop. Batch all reads, then all writes (or use `requestAnimationFrame`), or replace
the JS with CSS (flex/grid alignment, `aspect-ratio`).

## unused-javascript / duplicated-javascript-insight / legacy-javascript-insight
- Whole libraries for one function → import the function (`lodash-es/debounce`), use a native API,
  or inline a tiny helper.
- Route-specific code in the main bundle → dynamic `import()` / route-level code splitting.
- Duplicate packages (two versions of the same lib) → dedupe (`npm dedupe`, resolutions/overrides).
- Polyfills/transpilation for old browsers → update `browserslist`, ship modern bundles.
- Use the bundler's analyzer (`vite-bundle-visualizer`, `@next/bundle-analyzer`, `webpack-bundle-analyzer`, `source-map-explorer`) to confirm.

## unused-css-rules / unminified-css / unminified-javascript
- Stylesheets for features not on the page → load per route/component; delete dead frameworks
  (verify with a grep for their class prefixes across templates first).
- Tailwind: check `content` globs so unused utilities are purged.
- Unminified output usually means a dev build or a hand-linked file outside the bundler.

## font-display-insight (font-display)
`@font-face { font-display: swap; }` (or `optional` to avoid CLS). Self-host and preload the
primary weight; subset fonts; prefer `woff2`.

## total-byte-weight / dom-size-insight
Large pages: tackle the biggest resources first (images, video, JS). Large DOM (> ~1,400 nodes):
virtualize long lists, paginate, remove hidden duplicate markup (e.g. separate mobile/desktop menus).

## third-parties-insight
List what each third party costs. Load non-essential ones after interaction or `load`, use
facades for embeds (YouTube/maps/chat: static preview until click), remove unused tags.

## viewport-insight
Add `<meta name="viewport" content="width=device-width, initial-scale=1">` (avoids the 300 ms tap delay).

## Environment-dependent (verify in production, not in code)
`cache-insight` (uses-long-cache-ttl), `document-latency-insight` / `server-response-time`
(TTFB, redirects, compression), `modern-http-insight` (uses-http2), `uses-text-compression`.
Recommend: hashed filenames + `Cache-Control: public, max-age=31536000, immutable` for static
assets; brotli/gzip; HTTP/2+; CDN; cache HTML at the edge where possible.

---

## Verification hygiene
- Same preset, same machine, `--runs 3` for both labels when comparing.
- Lab ≠ field. If the user has CrUX/RUM data, mention that field INP/LCP may differ.
- Re-check functionality after changes (scripts that relied on synchronous execution order).
