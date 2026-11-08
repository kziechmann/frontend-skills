# WCAG fix playbook (by axe rule / audit finding)

Format: rule id — WCAG criterion — fix. Prefer the first option listed.

## Text alternatives
- **image-alt** — 1.1.1 — Informative image: `alt` that conveys the purpose ("Riverside Garden home"
  for a logo link, not "logo"). Decorative: `alt=""` (and no `title`). Complex chart: short alt +
  longer description nearby (`aria-describedby` or visible text).
- **svg-img-alt / role-img-alt** — 1.1.1 — `<svg role="img" aria-label="…">` or `<title>` as first child;
  decorative inline SVG: `aria-hidden="true" focusable="false"`.
- **input-image-alt / area-alt / object-alt** — 1.1.1 — add `alt` / text alternative.

## Names, roles, values
- **button-name** — 4.1.2 — Visible text, or `aria-label` for icon-only buttons; hide the icon
  (`aria-hidden="true"`).
- **link-name** — 2.4.4/4.1.2 — Text content, or `aria-label` on icon links; for image links the
  image's `alt` is the link name; add visually hidden text (`.visually-hidden`) when design forbids text.
- **label / select-name / form-field-multiple-labels** — 1.3.1/4.1.2 — `<label for="id">` (visible,
  persistent). Placeholder is not a label. Grouped controls: `<fieldset><legend>`.
- **aria-*** (aria-required-attr, aria-valid-attr-value, aria-allowed-role, aria-hidden-focus…) —
  4.1.2 — Fix or remove the ARIA; usually replace the custom widget with a native element.
- **nested-interactive** — 4.1.2 — Don't put links/buttons inside buttons/links; restructure.
- **frame-title** — 4.1.2 — `<iframe title="…">`.

## Keyboard & focus
- **no-focus-indicator** (keyboard walk) — 2.4.7 — Remove `outline: none`/`0`, or replace with
  `:focus-visible { outline: 2px solid <3:1 color>; outline-offset: 2px; }`.
- **focus-obscured** (keyboard walk) — 2.4.11 — Sticky headers/cookie banners must not cover focus:
  `scroll-padding-top` equal to header height; make banners not cover content or dismissible.
- **focus-trap** (keyboard walk) — 2.1.2 — Ensure Tab/Shift+Tab can leave the component (modals are the
  exception while open; they need Escape to close and focus return).
- **focusable-without-role** / mouse-only clickable — 2.1.1/4.1.2 — Use `<button type="button">`
  (actions) or `<a href>` (navigation). If unavoidable: `role="button" tabindex="0"` + Enter/Space handlers.
- **tabindex** (positive) — 2.4.3 — Remove positive values; fix DOM order instead.
- **scrollable-region-focusable** — 2.1.1 — `tabindex="0"` + accessible name on scroll containers.
- **skip-link / bypass** — 2.4.1 — "Skip to content" link targeting `<main id="main">`.

## Structure
- **html-has-lang / html-lang-valid / valid-lang** — 3.1.1/3.1.2 — `<html lang="en">`, `lang` on
  foreign-language passages.
- **document-title** — 2.4.2 — Unique, descriptive `<title>`.
- **heading-order / page-has-heading-one / empty-heading** — 1.3.1 (best practice) — One `<h1>`; don't skip
  levels; choose levels by structure and style with CSS.
- **landmark-one-main / region / landmark-unique / landmark-*** — 1.3.1 (best practice) — Wrap content
  in `<header>`, `<nav aria-label>`, `<main>`, `<footer>`; label duplicate landmarks.
- **list / listitem / definition-list** — 1.3.1 — Only `<li>` directly inside `<ul>/<ol>`.
- **th-has-data-cells / td-headers-attr / table-duplicate-name** — 1.3.1 — `<th scope>` for headers; don't
  use tables for layout.

## Visual
- **color-contrast** — 1.4.3 — 4.5:1 normal text, 3:1 large (≥24px or ≥18.66px bold). Adjust lightness,
  keep hue. Placeholder text counts. Text over images needs an overlay.
- **color-contrast-enhanced** — 1.4.6 (AAA) — 7:1, only if the user targets AAA.
- **link-in-text-block** — 1.4.1 — Links in body text need a non-color cue (underline) or 3:1 against text.
- **meta-viewport / meta-viewport-large** — 1.4.4 — Remove `user-scalable=no` and `maximum-scale<2`.
- Non-text contrast (manual + layout audit) — 1.4.11 — UI borders, icons, focus rings 3:1.
- Reflow (layout audit at 320px) — 1.4.10 — No horizontal scrolling for text content.

## Forms (often missed by automation)
- Visible labels; `autocomplete` tokens on personal data fields (1.3.5): `name`, `email`, `tel`, `street-address`…
- Errors: text (not color only), linked with `aria-describedby`, `aria-invalid="true"` on the field,
  announced via `role="alert"`/`aria-live` or focus moved to an error summary (3.3.1, 4.1.3).
- Required fields: `required` attribute + visible indicator explained in text.

## Motion & media
- `prefers-reduced-motion: reduce` disables non-essential animation (2.3.3); no flashing > 3/s (2.3.1).
- Video: captions (1.2.2), audio description or transcript (1.2.3/1.2.5); no autoplay audio (1.4.2).

## Snippets
```css
.visually-hidden { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
:focus-visible { outline: 2px solid #1f5fbf; outline-offset: 2px; }
```
```html
<a class="skip-link" href="#main">Skip to content</a>
<p id="form-status" role="status" aria-live="polite"></p>
```
