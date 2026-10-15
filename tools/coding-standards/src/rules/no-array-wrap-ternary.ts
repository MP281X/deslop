import {Option, Predicate} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {memberName} from '#rules/shared.ts'

function testedValue(node: ESTree.Expression) {
	if (
		node.type !== 'CallExpression' ||
		node.callee.type !== 'MemberExpression' ||
		node.callee.object.type !== 'Identifier' ||
		node.callee.object.name !== 'Array' ||
		!Option.contains(memberName(node.callee), 'isArray') ||
		node.arguments.length !== 1
	) {
		return Option.none<ESTree.Expression>()
	}
	const argument = node.arguments[0]
	if (argument?.type !== 'Identifier' && argument?.type !== 'MemberExpression') return Option.none<ESTree.Expression>()
	return Option.some(argument)
}

function isSingletonArray(input: {context: Context; node: ESTree.Expression; value: ESTree.Expression}) {
	if (input.node.type !== 'ArrayExpression' || input.node.elements.length !== 1) return false
	const element = input.node.elements[0]
	if (Predicate.isNullish(element) || element.type === 'SpreadElement') return false
	return input.context.sourceCode.getText(element) === input.context.sourceCode.getText(input.value)
}

function wrapsTestedValue(input: {
	context: Context
	kept: ESTree.Expression
	test: ESTree.Expression
	wrapped: ESTree.Expression
}) {
	return Option.exists(
		testedValue(input.test),
		value =>
			input.context.sourceCode.getText(input.kept) === input.context.sourceCode.getText(value) &&
			isSingletonArray({context: input.context, node: input.wrapped, value})
	)
}

function restatesArrayEnsure(input: {context: Context; node: ESTree.ConditionalExpression}) {
	if (input.node.test.type === 'UnaryExpression' && input.node.test.operator === '!') {
		return wrapsTestedValue({
			context: input.context,
			kept: input.node.alternate,
			test: input.node.test.argument,
			wrapped: input.node.consequent
		})
	}
	return wrapsTestedValue({
		context: input.context,
		kept: input.node.consequent,
		test: input.node.test,
		wrapped: input.node.alternate
	})
}

export const noArrayWrapTernary = defineRule({
	create: context => ({
		ConditionalExpression: node => {
			if (restatesArrayEnsure({context, node})) {
				context.report({message: 'Use Array.ensure; the ternary restates it.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
