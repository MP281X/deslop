import {Array, Number, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

// Modules that ship the shadcn primitives whose look a call site may not change.
const UI_MODULES = ['@deslop/components-web/ui/', '#components/ui/']

// Utilities that place a primitive without touching its shipped look.
const PLACEMENT_PREFIXES = [
	'm-',
	'mx-',
	'my-',
	'mt-',
	'mr-',
	'mb-',
	'ml-',
	'ms-',
	'me-',
	'w-',
	'h-',
	'size-',
	'min-w-',
	'min-h-',
	'max-w-',
	'max-h-',
	'basis-',
	'order-',
	'col-span-',
	'col-start-',
	'col-end-',
	'row-span-',
	'row-start-',
	'row-end-',
	'self-',
	'justify-self-',
	'place-self-',
	'inset-',
	'inset-x-',
	'inset-y-',
	'top-',
	'right-',
	'bottom-',
	'left-',
	'start-',
	'end-',
	'z-',
	'translate-',
	'pointer-events-'
]
const PLACEMENT_EXACT = [
	'flex-1',
	'flex-auto',
	'flex-none',
	'grow',
	'grow-0',
	'shrink',
	'shrink-0',
	'relative',
	'absolute',
	'fixed',
	'sticky',
	'hidden',
	'block',
	'flex',
	'inline-flex',
	'grid',
	'sr-only'
]
const RESTYLE =
	'A shadcn component keeps its shipped look: className only places it (margin, size, position, flex or grid placement). Pick a variant or change the composition instead of restyling.'

function uiImport(program: ESTree.Program) {
	return Array.flatMap(program.body, statement => {
		if (statement.type !== 'ImportDeclaration') return Array.empty<string>()
		if (!Array.some(UI_MODULES, prefix => String.startsWith(prefix)(statement.source.value))) {
			return Array.empty<string>()
		}
		return Array.map(statement.specifiers, specifier => specifier.local.name)
	})
}

// Every string a className can produce: literals, template quasis and the string arguments of cn.
function classStrings(node: ESTree.Node): string[] {
	if (node.type === 'Literal') return Array.filter([node.value], Predicate.isString)
	if (node.type === 'TemplateLiteral') return Array.map(node.quasis, quasi => quasi.value.raw)
	if (node.type === 'JSXExpressionContainer') return classStrings(node.expression)
	if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'cn') {
		return Array.flatMap(node.arguments, argument => classStrings(argument))
	}
	return Array.empty<string>()
}

// The utility after its variant prefixes and important marker, with a negative value's sign removed.
function utility(token: string) {
	const scanned = Array.reduce(String.split('')(token), {depth: 0, end: 0, index: 0}, (state, character) => {
		const index = state.index + 1
		if (character === '[') return {depth: state.depth + 1, end: state.end, index}
		if (character === ']') return {depth: Number.max(0, state.depth - 1), end: state.end, index}
		if (character === ':' && state.depth === 0) return {depth: state.depth, end: index, index}
		return {depth: state.depth, end: state.end, index}
	})
	return pipe(token, String.slice(scanned.end), String.replaceAll(/^!|!$/gu, ''), String.replace(/^-/u, ''))
}

function places(token: string) {
	const name = utility(token)
	return (
		Array.contains(PLACEMENT_EXACT, name) || Array.some(PLACEMENT_PREFIXES, prefix => String.startsWith(prefix)(name))
	)
}

function restyled(attribute: ESTree.JSXAttribute) {
	if (attribute.value === null) return false
	return pipe(
		classStrings(attribute.value),
		Array.flatMap(value => String.split(value, /\s+/u)),
		Array.filter(String.isNonEmpty),
		Array.some(token => !places(token))
	)
}

export const noPrimitiveRestyle = defineRule({
	create: context => {
		const file = {primitives: Array.empty<string>()}
		return {
			JSXOpeningElement: node => {
				if (node.name.type !== 'JSXIdentifier' || !Array.contains(file.primitives, node.name.name)) return
				pipe(
					Array.findFirst(
						node.attributes,
						attribute =>
							attribute.type === 'JSXAttribute' &&
							attribute.name.type === 'JSXIdentifier' &&
							attribute.name.name === 'className'
					),
					Option.filter(attribute => attribute.type === 'JSXAttribute' && restyled(attribute)),
					Option.map(attribute => context.report({message: RESTYLE, node: attribute}))
				)
			},
			Program: node => {
				file.primitives = uiImport(node)
			}
		}
	},
	meta: {type: 'problem'}
})
