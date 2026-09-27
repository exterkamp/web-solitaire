---
name: ui-polish
description: Apply or extend this repo's visual design conventions when touching the Angular chrome (menu, setup, settings, stats, play overlays) — colors, type, spacing, motion, depth. Use before styling a new screen or component, or when asked to make the UI feel more polished/less flat. Not for the Phaser board itself (felt, cards, table) — that's already a separate, more ornate layer; see table.ts and card-sprite.ts.
---

# UI polish conventions

There's already a real design system here — `src/styles.scss`, `src/_type.scss`
and `src/_page.scss`. Read those three files before writing new CSS; this skill
is what to do *with* them, not a replacement.

## What already exists — reuse it, don't reinvent it

- **Type**: `--font-display` (Cinzel, uppercase, tracked — via the
  `display-type` mixin) for headings and anything shouting; `--font-body`
  (Jost) for everything read as a sentence; `numeric-type` mixin
  (tabular-nums) for anything that counts up or down in place; `--font-score`
  (Schoolbell) only for the record book's handwritten entries.
- **Color**: felt/page background `#07241f`; primary green `#17594a`
  (hover `#1d6d5b`); gold `#ffd166` for "this is the active/focused one" and
  nothing else; text `#fdfdfd` on dark, `#cfead0`/`#9fc4a4`/`#7fae86` for
  progressively quieter green-tinted secondary text. Gold's exclusivity is
  load-bearing — it's the one color that means "selected" or "focused"
  anywhere in the app; don't use it decoratively. **One deliberate
  exception**: the main menu's title sits in a Vegas-marquee treatment
  (`.marquee` in main-menu.scss) — chasing bulbs and a neon text-glow, both
  gold. A title isn't a control, so there's nothing for the glow to be
  mistaken for. Don't extend the marquee treatment to other headings, and
  don't read its presence as license to use gold decoratively elsewhere.
- **Components**: `.button`, `.button--quiet`, `.button--small`, `.pill`,
  `.pill--active`, `.field` are global, in `styles.scss`, on purpose —
  component-scoped Angular styles can't be reached from a shared overlay, so
  anything button-shaped goes through one of these rather than a new
  per-page class. If a screen needs a variant none of these cover, extend the
  shared rule with a new modifier class there, not a local reimplementation.
- **Layout**: `page-fits` / `page-grows` / `page-scrolls` mixins in
  `_page.scss` are the three page shapes in the app. `_page.scss`'s own
  history is the warning here — five screens each hand-wrote the same
  centred column under different class names before these existed. A new
  page reaches for one of the three; it doesn't write a fourth.

## The actual gap — motion and depth

The board (`table.ts`, `solitaire-scene.ts`) is genuinely ornate: generated
felt with a nap texture, a lit pool falling off to shadow, a rendered rail.
The Angular chrome around it is comparatively flat *in a way that isn't a
deliberate restraint* — it's an omission:

- **No screen has a CSS `transition` on anything.** Every `:hover` and
  `:focus-visible` state on `.button`/`.pill`/`.field` snaps instantly. That's
  what reads as "simplistic" more than any color or shape choice — real
  surfaces settle into a pressed or focused state, they don't teleport into it.
- **Shadow is used three times, each with a different one-off value**
  (`0 1px 3px`, `0 2px 5px`, `0 8px 24px` — in `dye-swatch.scss`,
  `settings-page.scss`, and `play.scss`), and never on the primary
  `.button`/`.pill` that appear on every screen. There's no shared elevation
  scale to reach for, so nothing outside those three spots has any depth
  against the felt at all.

When asked to make a screen (or the app generally) feel more polished, this is
where the work actually is — not new colors or decoration, since the palette
and the quiet/loud type split are already deliberate (see `.menu__family`'s
comment: "quiet on purpose... the buttons under it have to stay the loudest
thing on the page"). Concretely:

1. **Add transitions to the shared components in `styles.scss`**, not
   per-page — `.button`, `.pill`, `.field` and their hover/focus/disabled
   states. One rule, ~150–200ms, `ease` or `ease-out`, covering `background`,
   `border-color`, `color`, `transform` as each needs. This is a single edit
   in one file, the same shape as the mixins it sits beside.
2. **Establish a small elevation scale** (two steps is probably enough — a
   near shadow for controls that sit slightly off the page, a far one for
   overlays/panels) instead of the three ad hoc values, and put the primary
   `.button`/`.pill` on the near step so they read as pressable objects
   rather than flat paint.
3. **Respect `prefers-reduced-motion`** for anything beyond a color/opacity
   fade — the Phaser scene already checks it (`solitaire-scene.ts:607`); any
   new CSS transform-based motion (not a simple color transition) should too.

## Before calling a screen done

- Every new interactive element goes through `.button`/`.pill`/`.field` (or a
  documented modifier on one of them), not a bespoke class.
- Touch targets stay ≥44px — the main menu's own comment calls this out as a
  constraint it had to fit nine games around.
- `:focus-visible` is visible (gold outline, already the global convention)
  on anything new that can be focused.
- Text contrast against `#07241f` holds up, especially for the quieter
  greens (`#7fae86` is already close to the floor this app uses).
- Any transition or animation added checks `prefers-reduced-motion` if it
  moves something rather than just fading a color.
