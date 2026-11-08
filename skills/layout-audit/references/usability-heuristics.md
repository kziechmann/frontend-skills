# Visual & usability review rubric

Use while looking at the screenshots. For each item: pass / issue (with screenshot + location) /
not applicable. Keep observations concrete and actionable ("At 390px the 'Start free trial'
button sits below 2.5 screens of hero text" — not "hierarchy could be better").

## 1. Visual hierarchy
- One obvious primary action per view; secondary actions look secondary.
- Headings clearly outrank body text (size/weight/spacing), and there is one dominant element per section.
- Squint test: blurred, does the most important thing still stand out?

## 2. Alignment & grid
- Content aligns to a small number of edges/columns; no "almost aligned" elements (off by a few px).
- Consistent container width and section padding across the page.
- Text alignment: left-aligned body copy for readability; centered only for short blocks.

## 3. Spacing & grouping (Gestalt proximity)
- Related items are closer together than unrelated ones (label ↔ field, heading ↔ its content).
- Spacing comes from a consistent scale; sections breathe; nothing touches the viewport edge on mobile.

## 4. Typography & readability
- Body 16px+ on mobile, line length 45–90 characters, line-height 1.4–1.6.
- 4–6 type sizes in total; consistent weights; sufficient contrast (see a11y audit for numbers).
- No orphaned single words in headings where avoidable (`text-wrap: balance`).

## 5. Responsiveness
- Layout adapts (stacks, reflows, reorders) instead of shrinking or cropping.
- Nothing is cut off or requires horizontal scrolling at 320px.
- Images keep their aspect ratio and are not blurry; tables have a mobile strategy.

## 6. Affordances & feedback (Nielsen #1, #4)
- Links look like links, buttons like buttons; consistent styles for the same action.
- Interactive elements have visible hover/focus/active states; disabled states are clear.
- Forms: visible labels, clear required/optional marking, inline errors near the field.

## 7. Content priority on mobile
- The page purpose and primary CTA are visible within the first screen or one scroll.
- Banners, cookie bars, chat widgets and sticky headers do not obscure content or the CTA.

## 8. Consistency & standards (Nielsen #4)
- Same component → same appearance and behavior across the page.
- Platform conventions: logo links home, navigation in expected places, icons with labels when ambiguous.

## 9. Error prevention & recovery (Nielsen #5, #9)
- Destructive actions are distinguished and confirmable; error messages say what happened and how to fix it.

## 10. Aesthetic & minimalist design (Nielsen #8)
- No competing focal points, decorative clutter, or redundant copy; every element earns its place.

## Severity scale for reporting
- **High**: blocks a task or hides content (overflow, overlap on controls, covered CTA, unreadable text).
- **Medium**: slows users down or causes errors (weak hierarchy, crowded targets, confusing grouping).
- **Low**: polish (alignment, spacing inconsistencies, minor type-scale sprawl).
