import {Array, pipe} from 'effect'

const MARGIN = ['m', 'mx', 'my', 'ms', 'me', 'mt', 'mr', 'mb', 'ml', 'mbs', 'mbe']
// A primitive fills, fits or shrinks in its parent; a fixed width is a size the primitive owns.
const FIT = ['w-full', 'w-fit', 'w-auto', 'min-w-0', 'max-w-full']
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
const PLACEMENT = [...MARGIN, ...FIT, ...FLEX_AND_GRID, ...GRID_LINES]

// A selector for the class strings of an element and of the class helpers that match a pattern.
export function classLiterals(pattern: string) {
	return pipe(
		['JSXAttribute[name.name="className"]', 'CallExpression[callee.name=/^(?:cn|cva)$/]'],
		Array.flatMap(scope => [
			`${scope} Literal[value=/${pattern}/]`,
			`${scope} TemplateElement[value.raw=/${pattern}/]`
		]),
		Array.join(', ')
	)
}

// The options of `shadcn/no-restyle`. A popup takes a width, as the registry's own examples give one; a skeleton takes a size because the registry has none for it.
export const primitiveClasses = {
	allow: PLACEMENT,
	// The rule's `ui` setting does not reach the JS plugin, so the modules are named; a software mark is sized like an icon.
	componentImports: ['^@deslop/components-web/ui(?!/svgs)(/|$)', '^#components/ui(?!/svgs)(/|$)'],
	contracts: [
		{allow: [...PLACEMENT, ...WIDTH], pattern: '^(?:DialogContent|DropdownMenuContent|PopoverContent|SheetContent)$'},
		{allow: [...PLACEMENT, ...WIDTH, 'size', 'h', 'min-h', 'max-h'], pattern: '^Skeleton$'}
	],
	// A value from a CSS variable is a size or colour by another name.
	deny: ['*(--*'],
	message:
		'"{{className}}" is not allowed on <{{component}}>: a primitive takes only margin, a fitting width and flex or grid item classes (mt-2, w-full, flex-1, col-span-2). Choose its variant or size, or change the parent\'s layout.'
}
