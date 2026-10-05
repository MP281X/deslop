import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {matches, memberName} from '#rules/shared.ts'

function receiverName(node: ESTree.Node) {
	if (node.type === 'Identifier') return Option.some(node.name)
	return node.type === 'MemberExpression' ? memberName(node) : Option.none<string>()
}

function isErrorMessage(node?: ESTree.Node | null) {
	return (
		node?.type === 'MemberExpression' &&
		Option.contains(memberName(node), 'message') &&
		Option.exists(receiverName(node.object), matches(/^(?:e|err|error|failure|cause|exception)$|Error$/iu))
	)
}

function expectsMessage(node: ESTree.MemberExpression) {
	const subject =
		node.object.type === 'MemberExpression' && Option.contains(memberName(node.object), 'not')
			? node.object.object
			: node.object
	return (
		subject.type === 'CallExpression' &&
		subject.callee.type === 'Identifier' &&
		subject.callee.name === 'expect' &&
		isErrorMessage(subject.arguments[0])
	)
}

function assertsMessage(node: ESTree.CallExpression) {
	const [actual, expected] = node.arguments
	return (
		node.callee.type === 'MemberExpression' &&
		node.callee.object.type === 'Identifier' &&
		node.callee.object.name === 'assert' &&
		isErrorMessage(actual) &&
		(expected?.type === 'Literal' || expected?.type === 'TemplateLiteral')
	)
}

export const noErrorMessageAssertion = defineRule({
	create: context => ({
		CallExpression: node => {
			if (assertsMessage(node)) {
				context.report({message: 'Assert the failure, never its message wording.', node})
				return
			}
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
