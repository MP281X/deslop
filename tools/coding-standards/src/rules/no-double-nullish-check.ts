import {Array, Option, Result, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {effectImport, variableFor} from '#rules/shared.ts'

const VARIANTS = {
	'&&': {comparison: '!==', guard: 'isNotNullish', message: 'Use Predicate.isNotNullish.'},
	'||': {comparison: '===', guard: 'isNullish', message: 'Use Predicate.isNullish.'}
} as const

type Check = {node: ESTree.Expression; nullish: string; subject: ESTree.Expression}

// A parameter or local named `undefined` is a value, not the global.
function nullishOperand(input: {context: Context; node: ESTree.Expression}) {
	if (input.node.type === 'Literal' && input.node.value === null) return Option.some('null')
	if (
		input.node.type === 'Identifier' &&
		input.node.name === 'undefined' &&
		!Option.exists(variableFor(input.context, input.node), variable => Array.isArrayNonEmpty(variable.defs))
	) {
		return Option.some('undefined')
	}
	return Option.none()
}

function operands(input: {node: ESTree.Expression; operator: '&&' | '||'}): ESTree.Expression[] {
	if (input.node.type !== 'LogicalExpression' || input.node.operator !== input.operator) return [input.node]
	return Array.appendAll(
		operands({node: input.node.left, operator: input.operator}),
		operands({node: input.node.right, operator: input.operator})
	)
}

function comparedNullish(input: {context: Context; node: ESTree.Expression; operator: '!==' | '==='}) {
	if (input.node.type !== 'BinaryExpression' || input.node.operator !== input.operator) return Option.none<Check>()
	const subject = input.node.left
	return Option.map(nullishOperand({context: input.context, node: input.node.right}), nullish => ({
		node: input.node,
		nullish,
		subject
	}))
}

function doubled(input: {context: Context; first: Check; second: Check}) {
	return (
		input.context.sourceCode.getText(input.first.subject) === input.context.sourceCode.getText(input.second.subject) &&
		input.first.nullish !== input.second.nullish
	)
}

// Two neighbouring checks of one plain name, joined only by the operator, become one guard call.
function guardCall(input: {checks: [Check, Check]; context: Context; fixer: Fixer; guard: string}) {
	if (
		input.checks[0].subject.type !== 'Identifier' ||
		!doubled({context: input.context, first: input.checks[0], second: input.checks[1]}) ||
		input.context.sourceCode.getTokensBetween(input.checks[0].node, input.checks[1].node).length !== 1
	) {
		return Option.none()
	}
	return Option.map(
		effectImport({context: input.context, fixer: input.fixer, name: 'Predicate', node: input.checks[0].node}),
		imports =>
			Array.append(
				imports,
				input.fixer.replaceTextRange(
					[input.checks[0].node.range[0], input.checks[1].node.range[1]],
					`Predicate.${input.guard}(${input.context.sourceCode.getText(input.checks[0].subject)})`
				)
			)
	)
}

export const noDoubleNullishCheck = defineRule({
	create: context => ({
		LogicalExpression: node => {
			if (node.operator === '??') return
			if (node.parent.type === 'LogicalExpression' && node.parent.operator === node.operator) return
			const variant = VARIANTS[node.operator]
			const checks = Array.map(operands({node, operator: node.operator}), operand =>
				comparedNullish({context, node: operand, operator: variant.comparison})
			)
			if (
				pipe(
					Array.filterMap(checks, check => Result.fromOption(check, () => undefined)),
					present => Array.some(present, first => Array.some(present, second => doubled({context, first, second})))
				)
			) {
				context.report({
					fix: fixer =>
						pipe(
							Array.zip(checks, Array.drop(checks, 1)),
							Array.findFirst(pair =>
								Option.flatMap(Option.all(pair), adjacent =>
									guardCall({checks: adjacent, context, fixer, guard: variant.guard})
								)
							),
							Option.getOrElse(() => [])
						),
					message: variant.message,
					node
				})
			}
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
