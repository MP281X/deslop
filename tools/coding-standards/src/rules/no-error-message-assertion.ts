import {Array, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {matches, memberName} from '#rules/shared.ts'

const ASSERT_IDENTITY =
	"Assert the failure's identity, such as assert.containsSubset(error, {_tag: 'NotFound'}) on Effect.flip's result, never its message."

function receiverName(node: ESTree.Node) {
	if (node.type === 'Identifier') return Option.some(node.name)
	if (node.type !== 'MemberExpression') return Option.none<string>()
	return memberName(node)
}

function isErrorMessage(node?: ESTree.Node | null) {
	return (
		node?.type === 'MemberExpression' &&
		Option.contains(memberName(node), 'message') &&
		Option.exists(receiverName(node.object), matches(/^(?:e|err|error|failure|cause|exception)$|Error$/iu))
	)
}

function expectsErrorMessage(node: ESTree.Node) {
	return (
		node.type === 'CallExpression' &&
		node.callee.type === 'Identifier' &&
		node.callee.name === 'expect' &&
		isErrorMessage(node.arguments[0])
	)
}

function expectsMessage(node: ESTree.MemberExpression) {
	if (node.object.type === 'MemberExpression' && Option.contains(memberName(node.object), 'not')) {
		return expectsErrorMessage(node.object.object)
	}
	return expectsErrorMessage(node.object)
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
				context.report({message: ASSERT_IDENTITY, node})
				return
			}
			if (
				node.callee.type === 'MemberExpression' &&
				(node.arguments[0]?.type === 'Literal' || node.arguments[0]?.type === 'TemplateLiteral') &&
				(Option.exists(memberName(node.callee), name => Array.contains(['toThrow', 'toThrowError'], name)) ||
					expectsMessage(node.callee))
			) {
				context.report({message: ASSERT_IDENTITY, node})
			}
		}
	}),
	meta: {type: 'problem'}
})
