import {Array, Boolean, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, Fixer} from 'vite-plus/lint/plugins'

import {
	argumentsText,
	composedSteps,
	importedMember,
	isFilteredCount,
	lengthTest,
	matches,
	memberName
} from '#lib/ast.ts'

const FIND_FIRST = 'Find the first match with Array.findFirst instead of filtering every item.'
const MIN = 'Take the smallest item with Array.min instead of sorting every item to read the first.'
const isSort = matches(/^sort(?:By|With)?$/u)
const isEmptinessTest = matches(/^is(?:Readonly)?Array(?:Non)?Empty$/u)

// The direct operation replaces both steps and keeps the filter's own arguments; a pipe step has nowhere to put an emptiness test's `!`.
function replace(input: {
	composition: ReturnType<typeof composedSteps>[number]
	context: Context
	fixer: Fixer
	name: string
	negate: boolean
}) {
	if (input.negate && !input.composition.nested) return []
	return Option.match(input.composition.inner.call, {
		onNone: () => [],
		onSome: call => [
			input.fixer.replaceTextRange(
				[input.composition.start, input.composition.end],
				`${Boolean.match(input.negate, {onFalse: () => '', onTrue: () => '!'})}Array.${input.name}(${argumentsText(input.context, call)})`
			)
		]
	})
}

// The first item of a sort, and the first item or the emptiness of a filter.
function report(context: Context, composition: ReturnType<typeof composedSteps>[number]) {
	if (isSort(composition.inner.name) && Array.contains(['head', 'headNonEmpty'], composition.outer.name)) {
		context.report({message: MIN, node: composition.report})
	}
	if (composition.inner.name !== 'filter') return
	if (composition.outer.name === 'head') {
		context.report({
			fix: fixer => replace({composition, context, fixer, name: 'findFirst', negate: false}),
			message: FIND_FIRST,
			node: composition.report
		})
	}
	if (isEmptinessTest(composition.outer.name)) {
		context.report({
			fix: fixer =>
				replace({
					composition,
					context,
					fixer,
					name: 'some',
					negate: !Array.contains(['isArrayNonEmpty', 'isReadonlyArrayNonEmpty'], composition.outer.name)
				}),
			message: 'Test for a match with Array.some instead of filtering every item.',
			node: composition.report
		})
	}
}

// The last item of a sort stays with review, since Array.max keeps the first of tied items.
export const noIntermediateCollection = defineRule({
	create: context => ({
		CallExpression: node => {
			for (const composition of composedSteps(context, node)) {
				if (composition.inner.module === 'Array' && composition.outer.module === 'Array') {
					report(context, composition)
				}
			}
		},
		// `Array.filter(items, test)[0]` and `Array.sort(items, order)[0]` read one item of a whole new array.
		MemberExpression: node => {
			if (isFilteredCount({context, node})) {
				if (
					node.parent.type === 'BinaryExpression' &&
					node.parent.left === node &&
					Option.isSome(lengthTest(node.parent))
				) {
					context.report({message: 'Test for a match with Array.some; no filtered array is consumed.', node})
				} else {
					context.report({message: 'Count matches with Array.countBy; no filtered array is consumed.', node})
				}
				return
			}
			if (
				!node.computed ||
				node.property.type !== 'Literal' ||
				node.property.value !== 0 ||
				node.object.type !== 'CallExpression' ||
				node.object.callee.type !== 'MemberExpression' ||
				!importedMember({context, importedName: 'Array', node: node.object.callee})
			) {
				return
			}
			const name = memberName(node.object.callee)
			if (Option.contains(name, 'filter')) context.report({message: FIND_FIRST, node})
			if (Option.exists(name, isSort)) context.report({message: MIN, node})
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Array} from 'effect'
export function firstPinned(notes: readonly {pinned: boolean}[]) { return Array.findFirst(notes, note => note.pinned) }`
					}
				],
				fixes: [
					{
						'sample.ts': `import {Array} from 'effect'
export function firstPinned(notes: readonly {pinned: boolean}[]) { return Array.head(Array.filter(notes, note => note.pinned)) }`
					},
					{
						'sample.ts': `import {Array} from 'effect'
export function hasPinned(notes: readonly {pinned: boolean}[]) { return Array.isReadonlyArrayNonEmpty(Array.filter(notes, note => note.pinned)) }`
					}
				]
			}
		},
		fixable: 'code',
		type: 'problem'
	}
})
