// Browser-side helpers injected with page.evaluate(DOM_HELPERS). They expose
// window.__fs with a stable-ish selector builder and visibility utilities so
// every audit reports elements the same way.
export const DOM_HELPERS = `(() => {
  if (window.__fs) return true;
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'));
  function selector(el) {
    if (!(el instanceof Element)) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      if (node.id && document.querySelectorAll('#' + esc(node.id)).length === 1) {
        parts.unshift('#' + esc(node.id));
        break;
      }
      let part = node.localName;
      const classes = [...node.classList].filter((c) => !/^(js-|is-|has-)/.test(c) && c.length < 40).slice(0, 2);
      if (classes.length) part += '.' + classes.map(esc).join('.');
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === node.localName);
        if (same.length > 1 && !(classes.length && parent.querySelectorAll(':scope > ' + part).length === 1)) {
          part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
      }
      parts.unshift(part);
      if (node.localName === 'body') break;
      node = parent;
    }
    return parts.join(' > ');
  }
  function snippet(el, max = 160) {
    const html = el.outerHTML || '';
    const open = html.slice(0, html.indexOf('>') + 1) || html;
    const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    const s = open + (text ? text + '…' : '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }
  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    if (el.closest('[hidden], [aria-hidden="true"], details:not([open]) > :not(summary)')) return false;
    return true;
  }
  function rect(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) };
  }
  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim().replace(/\\s+/g, ' ');
  }
  window.__fs = { selector, snippet, isVisible, rect, ownText };
  return true;
})()`;
