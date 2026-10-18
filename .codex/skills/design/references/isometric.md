# Isometric and flat 3D figures

For an explanatory figure that shows one idea as a physical object in an isometric view. The source is the anatomy skill (MIT, https://github.com/wheresryan22/anatomy, commit e948829). Before a figure, read its `SKILL.md` ("The one idea that matters", "Craft rules", Workflow), `references/craft.md` (sections 2, 4, 5, 7) and `references/verify.md`. This file keeps the rules that carry to this repo and the repo rules that override the source.

## The object is the explanation

- Invent a real machine whose working is the concept. Say in one sentence what moves and what the motion means (`SKILL.md`, Workflow step 3).
- Too abstract: "stacked plates, floating slabs or labelled boxes" (`SKILL.md`). Layers are allowed only with a working mechanism: drawers, trays in a rack, plates on guide pillars, cards in a holder (`craft.md`, "Abstract stacks").
- Too flat and bland: one slab with lines has no volume and no parts.
- Truth first (Workflow step 2): the readout, the motion and the caption all come from one model.
- Parts list before geometry (Workflow step 4): 40–80 parts for a Figure, 80–150 for a Hero. An Epic is not built here: propose a Hero (Workflow step 1).
- Two looks: at 1× one clear machine; at 4× something true in every region. Check at 4× last and add the missing real parts (`SKILL.md`, "Check it last").

## Tones and lines

- Four side tones by facing plus a lighter top, from `extrude` (`SKILL.md`, "Let the kit shade"). Use `flat` only for floors and inlays thinner than one unit.
- Tone hierarchy is separate from facing: base `lo`, structure `mid`, the subject `hi`, exactly one `lit` (`craft.md`, section 4). Monochrome unless colour is the subject.
- Curved surfaces are smooth-shaded, never a staircase of flat tone blocks (`SKILL.md`, "Curved surfaces shade smoothly"). A texture that must end ends on an edge or fades out (`verify.md`, "No abrupt texture ends").
- Every line ends on a face, another line or a terminal dot (`SKILL.md`, "Lines resolve"). Exempt: `free` rule lines that stand for printed text, a needle's tail, a pointer's tip, and ramps from `fadeLineSvg` (`verify.md`, "Line ends").
- Text a machine displays fits its window at its widest string and is clipped to it (`verify.md`, Checklist).

## Painter's order and pass-through

- Draw back to front, bottom to top. A part that wraps another is split into a back half and a front half (`craft.md`, section 5).
- A vertical part through a horizontal one is drawn in two segments, below and above, with the block painted between them. A full ring over a cylinder that continues shows its back half: use the front arc only (`verify.md`, "Common faults").
- Nothing passes through anything. The audit's `clearance`, `through` and `sunk` lines prove it when `kit/audit.mjs` runs (see Verify).

## Projection

The kit's `iso()` at azimuth 45°, elevation 30°, z up. `k = scale × √1.6` (the kit's `UNIT`):

```ts
const k = scale * Math.sqrt(1.6)
const project = ([x, y, z]: readonly [number, number, number]) => [
	(x - y) * Math.SQRT1_2 * k,
	((x + y) * Math.SQRT1_2 * 0.5 - z * (Math.sqrt(3) / 2)) * k
]
// project([1, 1, 0]) → [0, 0.707·k]: toward the viewer lands below the origin (y grows down)
// visible sides: +x on the right, +y on the left, top
```

Fit once over the largest state: `fitProjection(points, width, height, { pad })` (`kit/iso-kit.mjs`), so the figure never rescales while it moves.

## Motion

From `references/motion.md` (the source's rules, which this repo follows):

- Time-based: `dt` from `requestAnimationFrame`, clamped to 1/30 s. Pointer and keyboard set a target; the part eases to it, never snaps.
- One loop per figure; write `setAttribute` and `textContent` through refs, never a React render per frame.
- Stop offscreen: `IntersectionObserver` with `rootMargin: "120px 0px"`, reading `entries[entries.length - 1]`.
- Idle tour after about 1.4 s; pause on hover, focus or press; resume about 3.6 s after the last interaction.
- Reduced motion: no tour, no flow or pulse, jump to targets. The figure still responds to input.
- Keyboard: focusable root, arrows step, Home and End go to the extremes, Space or Enter presses, Escape releases. `aria-valuetext` says the state in words. Focus ring: `outline: 1px solid` with `outline-offset: 6px`.

The repo's motion limits in the design skill (Build, "Motion") also apply.

## Verify

Capture each of these and read every PNG (`verify.md`, "Capture"):

- Each resting state: assembled and apart, the sliding extremes, hover, focus, and intermediate frames during motion (`--times`, `--hover`, `--key`, `--reduced`).
- Desktop at 1×, phone at 390 px, and a 4× close-up of every junction in both themes.
- Dark-mode invariant: in both themes each top face is lighter than every side. A top mixed from the foreground goes dark in dark mode, which inverted the tones in this repo's first figure. `verify.md` says "Sides shaded and tops lighter".
- Geometry: `node build.mjs --audit` ends `audit passed` and `node scripts/lines.mjs page.html` prints `line ends: 0` (`verify.md`, "Audit" and "Line ends"). Both need `kit/` and `scripts/` from `/tmp/repos/anatomy`, which this repo does not vendor. Without them a figure is proven by captures only; say so in the PR.

## Repo rules that override the source

- Figure tones are theme tokens with light and dark values in `packages/components-web/src/theme.css`, never raw colours in TSX (`craft.md`, section 7, "Every colour is a token").
- A card with `Fig n`, title, hint and readout (`SKILL.md`, Workflow step 8) frames a standalone explanatory figure only. A page section never gets a card (AGENTS.md: "pages add no cards").
- Flat: no gradient, glow, blur or soft halo (the design skill's Build, "Flat"). The source's blurred halo under the base is not used here.
