const MARGIN = ['m', 'mx', 'my', 'ms', 'me', 'mt', 'mr', 'mb', 'ml', 'mbs', 'mbe']
const WIDTH = ['w', 'min-w', 'max-w']
const FLEX_AND_GRID = [
	'flex',
	'grow',
	'shrink',
	'basis',
	'order',
	'align-self',
	'justify-self',
	'place-self',
	'min-h-0'
]
const GRID_LINES = ['col-start-end', 'col-start', 'col-end', 'row-start-end', 'row-start', 'row-end']

// Where a primitive sits is a screen's to say; how it looks is the primitive's own variant and size.
const PLACEMENT = [...MARGIN, ...WIDTH, ...FLEX_AND_GRID, ...GRID_LINES]

// The options of `shadcn/no-restyle`; a skeleton and an avatar take a size because the registry has none for them.
export const primitiveClasses = {
	allow: PLACEMENT,
	// The rule's `ui` setting does not reach the JS plugin, so the modules are named; a software mark is sized like an icon.
	componentImports: ['^@deslop/components-web/ui(?!/svgs)(/|$)', '^#components/ui(?!/svgs)(/|$)'],
	contracts: [{allow: [...PLACEMENT, 'size', 'h', 'min-h', 'max-h'], pattern: '^(?:Avatar|Skeleton)$'}],
	message:
		'"{{className}}" is not allowed on <{{component}}>: a primitive takes only margin, width and flex or grid item classes (mt-2, w-full, flex-1, col-span-2). Choose its variant or size, or put the class on a parent element.'
}
