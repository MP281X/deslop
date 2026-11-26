import {mediaQueryAtom} from '#lib/media.ts'

// A foldable held half open like a book: Safari 27.1's posture is `folded` with two segments side by side, one per half of the screen. Flat, fully open or closed, it is `continuous`, so the page keeps its ordinary layout.
export const foldedAtom = mediaQueryAtom('(device-posture: folded) and (horizontal-viewport-segments: 2)')

// A grid's tracks at the fold: the first segment, whatever the hinge takes between the two, then the second segment. A page's two panes take the first and third track, so neither reaches under the hinge.
export const FOLD_COLUMNS =
	'env(viewport-segment-width 0 0, 50%) calc(env(viewport-segment-left 1 0, 50%) - env(viewport-segment-width 0 0, 50%)) minmax(0, 1fr)'
