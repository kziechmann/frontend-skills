# Responsive layout fixes (by finding type)

## horizontal-overflow (WCAG 1.4.10 Reflow)
| Cause hint in summary | Fix |
| --- | --- |
| `<img>/<video>/<iframe>` wider than viewport | `img, video, iframe { max-width: 100%; height: auto; }`; for iframes use `aspect-ratio: 16/9; width: 100%` |
| fixed `width: 960px` on a container | `max-width: 960px; width: 100%` (or `width: min(100%, 960px)`) |
| flex row that cannot shrink | `flex-wrap: wrap`, or grid `repeat(auto-fit, minmax(16rem, 1fr))`; children `min-width: 0` |
| `white-space: nowrap` heading/button | remove it, use `clamp()` font-size; `text-wrap: balance` for headings |
| long unbreakable string (URL, token) | `overflow-wrap: anywhere` on the container |
| `<table>` / `<pre>` / code | wrap in `.table-scroll { overflow-x: auto }` (scrolling inside a region is allowed) |
| `width: 100vw` | use `width: 100%` (100vw includes the scrollbar) |
| negative margins / absolutely positioned decoration | contain with `overflow-x: clip` on the section, or fix the offsets |
Re-run after fixing overflow: a zoomed-out mobile page distorts every other measurement.

## tap-target-too-small / tap-target-below-44 (WCAG 2.5.8 / 2.5.5)
```css
.nav a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px; }
.icon-button { min-width: 44px; min-height: 44px; display: inline-grid; place-items: center; }
```
Keep 8px+ between adjacent targets. Inline links inside sentences are exempt.

## text-too-small / body-text-small-on-mobile
Minimum 12px for any text (legal/footers included); 16px (1rem) body text on phones. Use `rem`.

## text-clipped / content-spills-out
Replace `height: Npx` on text containers with `min-height` (or nothing). If truncation is the
design, make it explicit: `text-overflow: ellipsis` (single line) or `-webkit-line-clamp` + a way
to read the full text (expand button, tooltip, detail page).

## overlapping-content
- Negative `margin-top` pulling an element over its sibling → remove; use `gap`/positive spacing.
- `position: absolute` badges/labels → reserve space (`padding-top`) or position inside a
  `position: relative` parent with known size.
- Fixed heights + growing text → see text-clipped.
Check at the widths where it happens; overlaps often appear only when text wraps.

## fixed-element-covers-viewport
Cookie/consent banners, chat bubbles, app promos and sticky headers:
- Compact on mobile (short copy, one row of buttons), max ~25% of viewport height, dismissible.
- Sticky header: keep ≤ ~15% of viewport height on phones; collapse on scroll if needed; add
  `scroll-padding-top` so anchors/focused elements are not hidden under it (WCAG 2.4.11).
- Leave space at the bottom of the page (`padding-bottom`) so the last content can scroll above
  a fixed bottom bar.

## image-distorted / image-upscaled
```css
.thumb { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }  /* crop, don't stretch */
img { height: auto; }                                              /* keep intrinsic ratio */
```
Upscaled raster images: provide a larger source via `srcset` (or use SVG for illustrations).

## line-length-too-long / line-height-tight (WCAG 1.4.12)
`p { max-width: 65ch; line-height: 1.5; }` — center the column or use a grid with a text column.

## viewport-meta-missing / zoom-disabled
`<meta name="viewport" content="width=device-width, initial-scale=1">` — never `user-scalable=no`
or `maximum-scale=1`.

## Scale check (informational)
- > 8 distinct font sizes or > 12 distinct spacing values on one page → introduce a type scale and
  spacing tokens (4/8px based), see css-audit.
- Many distinct left edges for block content → align to a grid/container; consistent section padding.

## Patterns worth reaching for
- `min()`, `max()`, `clamp()` for fluid sizing: `padding-inline: clamp(1rem, 4vw, 3rem)`.
- Container queries for components reused in sidebars and main columns.
- `dvh`/`svh` units instead of `100vh` for full-height mobile sections (address bar issues).
- Grid `auto-fit` + `minmax` instead of breakpoint-by-breakpoint column counts.
