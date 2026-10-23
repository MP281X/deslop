import {Array, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isImportBinding, matches, memberName, typeWrapped, variableFromScope} from '#rules/shared.ts'

const ASSERT_IDENTITY =
	"Assert the failure's class or stable payload, such as assert.instanceOf(error, NotesError), not its message wording."

function flippedValue(context: Context, node: ESTree.Node): boolean {
	const unwrapped = Option.getOrElse(typeWrapped(node), () => node)
	if (unwrapped !== node) return flippedValue(context, unwrapped)
	if (node.type !== 'YieldExpression' || !node.delegate || node.argument?.type !== 'CallExpression') return false
	if (importedMember({context, importedName: 'Effect', node: node.argument.callee, propertyName: 'flip'})) return true
	const last = node.argument.arguments[node.argument.arguments.length - 1]
	return (
		node.argument.callee.type === 'Identifier' &&
		isImportBinding({context, importedName: 'pipe', node: node.argument.callee, source: 'effect'}) &&
		last !== undefined &&
		last.type !== 'SpreadElement' &&
		importedMember({context, importedName: 'Effect', node: last, propertyName: 'flip'})
	)
}

function failureValue(context: Context, node: ESTree.Node) {
	if (flippedValue(context, node)) return true
	if (node.type !== 'Identifier') return false
	return Option.exists(variableFromScope({name: node.name, scope: context.sourceCode.getScope(node)}), variable => {
		const definition = variable.defs[0]?.node
		return (
			variable.defs.length === 1 &&
			definition?.type === 'VariableDeclarator' &&
			definition.parent.type === 'VariableDeclaration' &&
			definition.parent.kind === 'const' &&
			definition.init !== null &&
			flippedValue(context, definition.init)
		)
	})
}

function receiverName(node: ESTree.Node) {
	if (node.type === 'Identifier') return Option.some(node.name)
	if (node.type !== 'MemberExpression') return Option.none<string>()
	return memberName(node)
}

function isErrorMessage(context: Context, node?: ESTree.Node | null) {
	return (
		node?.type === 'MemberExpression' &&
		Option.contains(memberName(node), 'message') &&
		(Option.exists(receiverName(node.object), matches(/^(?:e|err|error|failure|cause|exception)$|Error$/iu)) ||
			failureValue(context, node.object))
	)
}

function expectsErrorMessage(context: Context, node: ESTree.Node) {
	return (
		node.type === 'CallExpression' &&
		node.callee.type === 'Identifier' &&
		node.callee.name === 'expect' &&
		isErrorMessage(context, node.arguments[0])
	)
}

function expectsMessage(context: Context, node: ESTree.MemberExpression) {
	if (node.object.type === 'MemberExpression' && Option.contains(memberName(node.object), 'not')) {
		return expectsErrorMessage(context, node.object.object)
	}
	return expectsErrorMessage(context, node.object)
}

function assertsMessage(context: Context, node: ESTree.CallExpression) {
	const [actual, expected] = node.arguments
	return (
		node.callee.type === 'MemberExpression' &&
		node.callee.object.type === 'Identifier' &&
		node.callee.object.name === 'assert' &&
		isErrorMessage(context, actual) &&
		(expected?.type === 'Literal' || expected?.type === 'TemplateLiteral')
	)
}

export const noErrorMessageAssertion = defineRule({
	create: context => ({
		CallExpression: node => {
			if (assertsMessage(context, node)) {
				context.report({message: ASSERT_IDENTITY, node})
				return
			}
			if (
				node.callee.type === 'MemberExpression' &&
				(node.arguments[0]?.type === 'Literal' || node.arguments[0]?.type === 'TemplateLiteral') &&
				(Option.exists(memberName(node.callee), name => Array.contains(['toThrow', 'toThrowError'], name)) ||
					expectsMessage(context, node.callee))
			) {
				context.report({message: ASSERT_IDENTITY, node})
			}
		}
	}),
	meta: {type: 'problem'}
})
