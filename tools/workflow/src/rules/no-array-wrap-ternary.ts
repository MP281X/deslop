import {Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {memberName} from './shared.ts'

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
	if (element === null || element === undefined || element.type === 'SpreadElement') return false
	return input.context.sourceCode.getText(element) === input.context.sourceCode.getText(input.value)
}

function restatesArrayEnsure(input: {context: Context; node: ESTree.ConditionalExpression}) {
	const test =
		input.node.test.type === 'UnaryExpression' && input.node.test.operator === '!'
			? input.node.test.argument
			: input.node.test
	const negated = test !== input.node.test
	return Option.exists(
		testedValue(test),
		value =>
			input.context.sourceCode.getText(negated ? input.node.alternate : input.node.consequent) ===
				input.context.sourceCode.getText(value) &&
			isSingletonArray({context: input.context, node: negated ? input.node.consequent : input.node.alternate, value})
	)
}

export const noArrayWrapTernary = defineRule({
	create: context => ({
		ConditionalExpression: node => {
			if (restatesArrayEnsure({context, node})) {
				context.report({message: 'Array.ensure wraps a value or keeps an array; the ternary restates it.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
