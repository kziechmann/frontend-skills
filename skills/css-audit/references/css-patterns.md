# CSS patterns: what good looks like

## Specificity & architecture
- Style with **single classes** (`.card-title`), not IDs (`#header`) or chains
  (`#header ul#nav li a`). Target specificity ≤ `0,2,0` for components; `0,1,0` is ideal.
- Don't qualify classes with elements (`div.card`) — it raises specificity and couples CSS to markup.
- Source order should go generic → specific: reset → tokens → base elements → layout → components
  → utilities. Then `!important` is rarely needed.
- `:where()` lowers specificity of resets/base styles to zero; `@layer` makes ordering explicit:
  ```css
  @layer reset, base, components, utilities;
  ```
- Legit `!important`: utility classes meant to win (`.visually-hidden`, `.hidden`), and
  `prefers-reduced-motion` overrides.

## Design tokens (custom properties)
```css
:root {
  --color-text: #1f2430;   --color-muted: #5a6072;   --color-primary: #3b2bd9;
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem; --space-6: 1.5rem;
  --radius-sm: 4px; --radius-md: 8px;
  --font-size-sm: 0.875rem; --font-size-base: 1rem; --font-size-lg: 1.25rem;
  --z-dropdown: 10; --z-sticky: 20; --z-modal: 100; --z-toast: 200;
}
```
- Merge near-duplicates (`#333`, `#333333`, `#343434`, `rgb(51,51,51)`) into one token.
- Name by role (`--color-text-muted`) rather than value (`--gray-555`) for component-level use.
- If the project already has tokens (Sass variables, Tailwind theme, design-system package),
  use those instead of inventing new ones.
- Dark mode becomes a token swap: `@media (prefers-color-scheme: dark) { :root { --color-text: … } }`.

## Layout
- Flexbox for one-dimensional rows/columns, Grid for two-dimensional layouts and card grids:
  ```css
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: var(--space-6); }
  ```
- `gap` instead of margins on children (no `:last-child { margin-right: 0 }` hacks).
- No floats for layout (floats are for wrapping text around images); no clearfix.
- Intrinsic sizing: `max-width` + `width: 100%`, `minmax()`, `clamp()` instead of fixed widths.
- Logical properties (`margin-inline`, `padding-block`, `inset-inline-start`) when RTL matters.
- Container queries (`container-type: inline-size` + `@container`) for components that live in
  different-width slots.

## Typography
- `rem` for font sizes (respects user settings), unitless `line-height` (1.4–1.6 for body).
- A small type scale (4–6 sizes); fluid headings with `clamp(2rem, 5vw, 3.25rem)`.
- Always end `font-family` with a generic family (`sans-serif`, `serif`, `system-ui`).
- Readable measure: `max-width: 65ch` on long text.

## Motion
- Animate `transform` and `opacity` only (compositor-friendly); never `width/height/top/left/margin`.
- List transitioned properties: `transition: color .2s, background-color .2s` — not `all`.
- Respect reduced motion:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
      transition-duration: .01ms !important; scroll-behavior: auto !important; }
  }
  ```

## Accessibility in CSS
- Never `outline: none` without a replacement; use `:focus-visible { outline: 2px solid …; outline-offset: 2px }`.
- Hide visually but keep for screen readers with `.visually-hidden`, not `display:none`.
- Don't convey state by color alone; keep 3:1 contrast for UI borders and focus rings.

## Performance
- Link stylesheets from HTML or import them through the bundler; never `@import` in CSS served
  to the browser (serial requests).
- Remove unused rules only after grepping templates/JS for the class names (dynamic class names
  like `` `btn-${variant}` `` hide usages).
- `content-visibility: auto` for long off-screen sections (with `contain-intrinsic-size`).

## Vendor prefixes
- Let autoprefixer + `browserslist` add them. Hand-written `-webkit-border-radius`,
  `-moz-box-shadow`, `-webkit-box-sizing` are obsolete for every supported browser.
- Exceptions still needed without autoprefixer: `-webkit-line-clamp` (with `display:-webkit-box`),
  `-webkit-backdrop-filter` for older Safari, `-webkit-text-size-adjust`.

## SCSS specifics
- Nesting ≤ 3 levels; prefer `&__element` (BEM) over deep descendant nesting.
- `@use`/`@forward` instead of `@import` (deprecated in Dart Sass).
- Don't `@extend` across files (bloats selectors); use mixins or utility classes.

## Tailwind / utility-first projects
- Findings map to config: tokens live in `theme`/`@theme`; repeated long class lists → component
  extraction (framework component or `@apply` sparingly); ensure `content` globs purge unused CSS;
  arbitrary values (`w-[937px]`) are the utility-world equivalent of magic numbers.
