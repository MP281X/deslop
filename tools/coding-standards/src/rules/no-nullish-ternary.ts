import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {importedMember, memberName} from '#rules/shared.ts'

const nullishPredicates = ['isNotNull', 'isNotNullish', 'isNotUndefined', 'isNull', 'isNullish', 'isUndefined']

function isNullish(input: {context: Context; node: ESTree.Expression | ESTree.PrivateIdentifier}) {
	if (input.node.type === 'Literal') return input.node.value === null
	return input.node.type === 'Identifier' && input.node.name === 'undefined'
}

function testsNullish(input: {context: Context; node: ESTree.Expression}) {
	if (input.node.type === 'UnaryExpression' && input.node.operator === '!') {
		return testsNullish({context: input.context, node: input.node.argument})
	}
	if (input.node.type === 'BinaryExpression' && (input.node.operator === '===' || input.node.operator === '!==')) {
		return (
			isNullish({context: input.context, node: input.node.left}) ||
			isNullish({context: input.context, node: input.node.right})
		)
	}
	return (
		input.node.type === 'CallExpression' &&
		input.node.callee.type === 'MemberExpression' &&
		importedMember({context: input.context, importedName: 'Predicate', node: input.node.callee}) &&
		Option.exists(memberName(input.node.callee), name => Array.contains(nullishPredicates, name))
	)
}

export const noNullishTernary = defineRule({
	create: context => ({
		ConditionalExpression: node => {
			if (testsNullish({context, node: node.test})) {
				context.report({
					message: 'Use ?? for a default, or Option for a value that may be absent, instead of a nullish ternary.',
					node
				})
			}
		}
	}),
	meta: {type: 'problem'}
})
