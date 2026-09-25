import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {memberName} from './shared.ts'

function expectsMessage(node: ESTree.MemberExpression) {
	const subject =
		node.object.type === 'MemberExpression' && Option.contains(memberName(node.object), 'not')
			? node.object.object
			: node.object
	return (
		subject.type === 'CallExpression' &&
		subject.callee.type === 'Identifier' &&
		subject.callee.name === 'expect' &&
		subject.arguments[0]?.type === 'MemberExpression' &&
		Option.contains(memberName(subject.arguments[0]), 'message')
	)
}

export const noErrorMessageAssertion = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type === 'MemberExpression' &&
				(node.arguments[0]?.type === 'Literal' || node.arguments[0]?.type === 'TemplateLiteral') &&
				(Option.exists(memberName(node.callee), name => Array.contains(['toThrow', 'toThrowError'], name)) ||
					expectsMessage(node.callee))
			) {
				context.report({message: 'Assert the failure, never its message wording.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
