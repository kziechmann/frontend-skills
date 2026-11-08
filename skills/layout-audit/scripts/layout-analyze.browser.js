// Runs inside the page (page.evaluate). Requires window.__fs from dom-helpers.
// Returns layout/usability issues for the current viewport. Every flagged
// element gets data-fs-issue="<n>" so the caller can draw annotations.
(({ mobile, maxPerType, height }) => {
  const { selector, snippet, isVisible, ownText } = window.__fs;
  // Layout viewport. On mobile, an overflowing page is zoomed out, which
  // inflates innerHeight; use the configured height for coverage maths.
  const vw = document.documentElement.clientWidth;
  const vh = Math.min(innerHeight, height || innerHeight);
  const zoomedOut = innerWidth > vw + 1;
  const issues = [];
  const perType = {};
  let tag = 0;

  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'br', 'wbr', 'meta', 'link', 'source', 'track', 'option', 'optgroup', 'path', 'g', 'defs', 'use', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'stop', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'symbol', 'title', 'desc', 'tspan', 'text']);
  const all = [...document.body.querySelectorAll('*')].filter((el) => !SKIP.has(el.localName));
  const vrect = (el) => el.getBoundingClientRect();
  // Rect after clipping by overflow:hidden/clip/auto ancestors (null = fully clipped).
  const clipCache = new Map();
  function clippedRect(el) {
    if (clipCache.has(el)) return clipCache.get(el);
    let r = vrect(el);
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const ar = vrect(a);
      if (cs.overflowX !== 'visible') box = { ...box, left: Math.max(box.left, ar.left), right: Math.min(box.right, ar.right) };
      if (cs.overflowY !== 'visible') box = { ...box, top: Math.max(box.top, ar.top), bottom: Math.min(box.bottom, ar.bottom) };
    }
    const out = box.right - box.left > 1 && box.bottom - box.top > 1 ? { ...box, width: box.right - box.left, height: box.bottom - box.top } : null;
    clipCache.set(el, out);
    return out;
  }
  const inFixedLayer = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const pos = getComputedStyle(a).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    }
    return false;
  };
  const visible = all.filter((el) => isVisible(el) && clippedRect(el));

  function add(type, severity, el, detail, extra = {}) {
    perType[type] = (perType[type] || 0) + 1;
    if (perType[type] > maxPerType) return;
    let id = null;
    if (el) {
      id = el.getAttribute('data-fs-issue') || String(++tag);
      el.setAttribute('data-fs-issue', id);
    }
    const r = el ? vrect(el) : null;
    issues.push({
      type,
      severity,
      selector: el ? selector(el) : undefined,
      snippet: el ? snippet(el) : undefined,
      rect: r ? { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) } : undefined,
      detail,
      annotation: id,
      ...extra,
    });
  }

  // --- viewport meta / zoom
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) add('viewport-meta-missing', 'high', null, 'No <meta name="viewport">; mobile browsers render at ~980px and zoom out');
  else if (/user-scalable\s*=\s*(no|0)\b|maximum-scale\s*=\s*(1(\.0+)?|0?\.\d+)\b/i.test(meta.content)) {
    add('zoom-disabled', 'high', null, `viewport meta "${meta.content}" blocks pinch-zoom (WCAG 1.4.4)`, { wcag: '1.4.4' });
  }

  // --- horizontal overflow
  const docWidth = document.documentElement.scrollWidth;
  const horizontalOverflow = docWidth > vw + 1;
  if (horizontalOverflow) {
    const clippedByAncestor = (el) => {
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX !== 'visible' && a !== document.body && vrect(a).right <= vw + 1) return true;
      }
      return false;
    };
    const offenders = new Set();
    for (const el of visible) {
      const r = vrect(el);
      if (r.width === 0 || (r.right <= vw + 1 && r.left >= -1)) continue;
      // Fixed layers size themselves to the (possibly zoomed-out) viewport; they are victims, not causes.
      if (inFixedLayer(el)) continue;
      if (!clippedByAncestor(el)) offenders.add(el);
    }
    // Text that overflows its own box (e.g. white-space: nowrap headings).
    for (const el of visible) {
      if (offenders.has(el) || !ownText(el) || inFixedLayer(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rr = range.getBoundingClientRect();
      if (rr.right > vw + 1 && !clippedByAncestor(el)) offenders.add(el);
    }
    const roots = [...offenders].filter((el) => !offenders.has(el.parentElement));
    for (const el of roots) {
      const cs = getComputedStyle(el);
      const r = vrect(el);
      const hints = [];
      if (cs.whiteSpace === 'nowrap' || cs.whiteSpace === 'pre') hints.push(`white-space: ${cs.whiteSpace}`);
      if (parseFloat(cs.minWidth) > vw) hints.push(`min-width: ${cs.minWidth}`);
      if (['img', 'video', 'iframe', 'canvas', 'svg', 'table', 'pre'].includes(el.localName)) hints.push(`<${el.localName}> without max-width/overflow handling`);
      if (r.width > vw) hints.push(`rendered width ${Math.round(r.width)}px > viewport ${vw}px (computed width ${cs.width})`);
      if (/\S{30,}/.test(ownText(el))) hints.push('long unbreakable string (use overflow-wrap: anywhere)');
      add('horizontal-overflow', 'high', el, `Extends to x=${Math.round(r.right)}px; page scrolls sideways (document ${docWidth}px wide at ${vw}px viewport)${hints.length ? ' — ' + hints.join('; ') : ''}`, { wcag: '1.4.10' });
    }
  }

  // --- tap targets (WCAG 2.5.8 target size minimum, with spacing exception)
  const TARGET_SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=switch]';
  const targets = visible.filter((el) => el.matches(TARGET_SEL)).map((el) => ({ el, r: vrect(el) }));
  const inSentence = (el) => el.localName === 'a' && el.parentElement && ownText(el.parentElement).length > 20;
  const distToRect = (x, y, r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
  const undersized = targets.filter((t) => (t.r.width < 24 || t.r.height < 24) && !inSentence(t.el) && !['textarea'].includes(t.el.localName));
  for (const t of undersized) {
    const cx = t.r.left + t.r.width / 2;
    const cy = t.r.top + t.r.height / 2;
    const conflict = targets.find((o) => {
      if (o === t || o.el.contains(t.el) || t.el.contains(o.el)) return false;
      if (distToRect(cx, cy, o.r) < 12) return true;
      const ou = undersized.includes(o);
      return ou && Math.hypot(cx - (o.r.left + o.r.width / 2), cy - (o.r.top + o.r.height / 2)) < 24;
    });
    if (conflict) {
      add('tap-target-too-small', mobile ? 'high' : 'medium', t.el, `${Math.round(t.r.width)}×${Math.round(t.r.height)}px target with neighbours closer than 24px (nearest: ${selector(conflict.el)})`, { wcag: '2.5.8' });
    }
  }
  if (mobile) {
    for (const t of targets) {
      if (undersized.includes(t) || inSentence(t.el) || t.el.localName === 'textarea') continue;
      if (t.r.width < 44 || t.r.height < 44) add('tap-target-below-44', 'low', t.el, `${Math.round(t.r.width)}×${Math.round(t.r.height)}px; 44×44px is the recommended touch size (WCAG 2.5.5 AAA, Apple/Material guidance)`);
    }
  }

  // --- text size, clipping and spill
  for (const el of visible) {
    const text = ownText(el);
    if (text.length < 2) continue;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs < 12) add('text-too-small', 'medium', el, `font-size ${fs}px (minimum 12px; 16px for body text)`);
    else if (mobile && fs < 16 && ['p', 'li', 'dd', 'td', 'blockquote'].includes(el.localName) && text.length > 60) add('body-text-small-on-mobile', 'low', el, `body text ${fs}px on a ${vw}px viewport (16px recommended)`);
  }
  for (const el of visible) {
    const txt = (el.innerText || '').trim();
    if (txt.length < 2) continue;
    const cs = getComputedStyle(el);
    const clipsX = cs.overflowX !== 'visible';
    const clipsY = cs.overflowY !== 'visible';
    const overX = el.scrollWidth > el.clientWidth + 2;
    const overY = el.scrollHeight > el.clientHeight + 2;
    const lineClamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    const scrollable = ['auto', 'scroll'].includes(cs.overflowY) || ['auto', 'scroll'].includes(cs.overflowX);
    const intentional = cs.textOverflow === 'ellipsis' || lineClamp || scrollable;
    if (((clipsX && overX) || (clipsY && overY)) && !intentional && el.clientHeight > 0) {
      add('text-clipped', 'medium', el, `Content is ${el.scrollHeight}×${el.scrollWidth}px but the box is ${el.clientHeight}×${el.clientWidth}px with overflow hidden — text is cut off (height: ${cs.height})`);
    } else if (!clipsY && overY && el.clientHeight > 0 && el.scrollHeight - el.clientHeight > 6 && !['html', 'body'].includes(el.localName)) {
      const hasFixedHeight = cs.height !== 'auto' && !/%/.test(el.style.height || '') && cs.display !== 'inline';
      if (hasFixedHeight && el.children.length < 30) add('content-spills-out', 'medium', el, `Content (${el.scrollHeight}px) spills out of a ${el.clientHeight}px-tall box and can overlap what follows — avoid fixed heights on text containers`);
    }
  }

  // --- overlapping content
  const content = visible
    .filter((el) => el.matches(TARGET_SEL) || el.localName === 'img' || ownText(el).length > 1)
    .filter((el) => !inFixedLayer(el)) // fixed/sticky overlap depends on scroll position; covered by the coverage check
    .map((el) => ({ el, r: clippedRect(el), interactive: el.matches(TARGET_SEL) }))
    .filter((c) => c.r.width > 2 && c.r.height > 2)
    .slice(0, 900);
  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      const a = content[i];
      const b = content[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w <= 2 || h <= 2) continue;
      const overlap = w * h;
      const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (overlap < smaller * 0.25) continue;
      const interactive = a.interactive || b.interactive;
      add('overlapping-content', interactive ? 'high' : 'medium', a.el, `Overlaps ${selector(b.el)} by ${Math.round((overlap / smaller) * 100)}% of the smaller box${interactive ? ' — may block taps/clicks' : ''}`, { other: selector(b.el) });
    }
  }

  // --- fixed elements eating the viewport
  for (const el of visible) {
    const pos = getComputedStyle(el).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    const r = vrect(el);
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const share = (w * h) / (vw * vh);
    const limit = pos === 'sticky' ? 0.2 : mobile ? 0.25 : 0.3;
    if (share > limit) add('fixed-element-covers-viewport', mobile ? 'high' : 'medium', el, `position:${pos} element covers ${Math.round(share * 100)}% of the ${vw}×${vh} viewport`);
  }

  // --- images
  for (const img of visible.filter((el) => el.localName === 'img')) {
    const r = vrect(img);
    if (!img.naturalWidth || r.width < 8 || r.height < 8) continue;
    const cs = getComputedStyle(img);
    const naturalRatio = img.naturalWidth / img.naturalHeight;
    const renderedRatio = r.width / r.height;
    if ((cs.objectFit === 'fill' || !cs.objectFit) && Math.abs(renderedRatio / naturalRatio - 1) > 0.05) {
      add('image-distorted', 'medium', img, `Rendered ${Math.round(r.width)}×${Math.round(r.height)} (ratio ${renderedRatio.toFixed(2)}) but the image is ${img.naturalWidth}×${img.naturalHeight} (ratio ${naturalRatio.toFixed(2)}); use object-fit or height:auto`);
    }
    if (r.width > img.naturalWidth * 1.5 && img.naturalWidth < 800 && !/\.svg(\?|$)/i.test(img.currentSrc)) add('image-upscaled', 'low', img, `Displayed at ${Math.round(r.width)}px from a ${img.naturalWidth}px source — will look blurry`);
  }

  // --- readability
  for (const el of visible.filter((e) => ['p', 'li', 'dd', 'blockquote'].includes(e.localName))) {
    const text = (el.innerText || '').trim();
    if (text.length < 140 || ownText(el).length < 20) continue; // skip wrappers whose text lives in children
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight);
    const lines = Math.max(1, Math.round(vrect(el).height / lh));
    const cpl = Math.round(text.length / lines);
    if (lines > 1 && cpl > 100) add('line-length-too-long', 'low', el, `~${cpl} characters per line (aim for 45–90; set max-width: 65ch–75ch)`);
    if (lh / fs < 1.3) add('line-height-tight', 'low', el, `line-height ${(lh / fs).toFixed(2)} (WCAG 1.4.12 expects text to survive 1.5)`, { wcag: '1.4.12' });
  }

  // --- consistency stats (informational, fuel for the visual review)
  const fontSizes = new Set();
  const spacing = new Set();
  const lefts = new Set();
  for (const el of visible.slice(0, 2000)) {
    const cs = getComputedStyle(el);
    if (ownText(el)) fontSizes.add(cs.fontSize);
    for (const p of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'paddingLeft', 'gap', 'rowGap']) {
      const v = parseFloat(cs[p]);
      if (v > 0) spacing.add(Math.round(v));
    }
    if (['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'img', 'form', 'table'].includes(el.localName)) lefts.add(Math.round(vrect(el).left));
  }

  for (const t of Object.keys(perType)) {
    if (perType[t] > maxPerType) issues.push({ type: t, severity: 'info', detail: `…and ${perType[t] - maxPerType} more ${t} findings` });
  }
  if (zoomedOut) issues.push({ type: 'zoomed-out', severity: 'info', detail: `Mobile browser zoomed the page out to ${Math.round((vw / innerWidth) * 100)}% to fit ${innerWidth}px of content; fix horizontal overflow first, then re-run` });
  return {
    viewport: `${vw}x${height || vh}`,
    docWidth,
    docHeight: document.documentElement.scrollHeight,
    horizontalOverflow,
    issues,
    counts: perType,
    stats: {
      distinctFontSizes: [...fontSizes].sort((a, b) => parseFloat(a) - parseFloat(b)),
      distinctSpacingValues: [...spacing].sort((a, b) => a - b),
      distinctLeftEdges: lefts.size,
    },
  };
});
