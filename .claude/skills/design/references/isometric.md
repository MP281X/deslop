# Isometric and flat 3D figures

For a figure that explains one idea as a physical object, in flat colour with a 45°/30° isometric view. Adapted from the anatomy skill (MIT, https://github.com/wheresryan22/anatomy, read at e9488296): its `SKILL.md`, `references/craft.md` (parts vocabulary) and `references/verify.md` (checklist) hold the full recipes. Its kit is not vendored here.

## The one idea

The object is the explanation. Invent a real machine whose working is the concept, and say in one sentence what moves and what that motion means.

Two failures the source names, both seen in this repo:

- **Too abstract.** Stacked plates, floating slabs and labelled boxes read as shelves, not as anything. A stack of six plates on four posts, one plate per skill, is this failure.
- **Too flat and bland.** One slab with lines has no volume and no parts.

The fix is the same for both: a recognisable machine built from many small, precise parts, each sitting on another part.

## Size before you build

- **Figure:** one mechanism, 40–80 parts, desktop card.
- **Hero:** several layers or one 3D subject, 80–150 parts.
- **Epic:** a whole system, six hours or more. Propose a Hero that keeps the core instead.

Name the size and the parts count before geometry. "Minimal" lowers the part count, never the rules below.

## Parts list before geometry

Write the list grouped: base (plate, feet, screws, label plate), structure (posts, rails, frame bars), mechanism (carriage, bushings, springs, plunger), controls (knob, thumb screw), subject (the one lit part). Each row names what it sits on.

## Craft rules

- **Solids, not wireframes.** Fill every part and paint back to front. No dashed hidden lines.
- **Four tones by facing.** Top lightest, one side mid, the other side darkest. Base low, structure mid, subject high. One lit accent, the part the reader watches. Colour only when colour is the subject.
- **Lines resolve.** Every line ends on a face, another line or a dot. No leader lines or floating labels.
- **Texture ends on an edge or fades.** Ribs, seams and grooves never stop mid-face.
- **Painter's order is geometry, not a guess.** Split anything that wraps another part: a post through a plate is drawn as the segments in the gap between plates, so the plate hides what passes through it.
- **Hidden faces stay hidden.** A post's top face under a plate is never drawn; drawn on top, it shows as a cap.
- **Volume without gradients.** Thickness, feet and a flat offset shape under a lifted part. Never a blur or a gradient (see Flat in the design skill).
- **Composition.** Centre the figure, fill 55–65% of the card, keep one scale across figures, and read it at 390 px.
- **Card.** "Fig n" top left, short title top right, hint bottom left, live readout bottom right, a true caption under the card.

## Projection

Azimuth 45°, elevation 30°, z up, one world unit about one pixel.

```ts
const COS30 = Math.cos(Math.PI / 6)
const project = (p: {x: number; y: number; z: number}) => ({x: (p.x - p.y) * COS30, y: (p.x + p.y) / 2 - p.z})
// visible faces: top, the +x side (right), the +y side (left)
```

Fit one fixed view over the largest state, so the figure never rescales while it moves.

## Motion

One time-based or scroll-linked value drives every moving part. Tweens under 300 ms, ease-out. Reduced motion shows the final state with no movement. The readout reads the same model the parts read. Hover or focus on a part lights it, and the list beside the figure shows the same selection.

## Verify

- Capture desktop at 1×, close-ups of every junction at 4×, the phone width (390 px), light and dark. A tone that inverts in dark mode is a defect: a top face mixed from the foreground goes darker than its sides.
- Ask: is it instantly a real object? Rich in small parts with volume? Does every line end on something? Is any corner empty at 4×?
- Read each capture before you show it; the owner finds faults by zooming.

## Repo notes

- Figure tones are theme tokens with light and dark values (`packages/components-web/src/theme.css`), never raw colours in TSX.
- The anatomy kit's audit and line-check scripts are not used here; the rules above are checked by reading the captures.
