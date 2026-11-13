import {Array, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	containsNode,
	importedMember,
	isFunction,
	isImportBinding,
	matches,
	memberName,
	resolveBinding,
	typeWrapped,
	variableFromScope
} from '#lib/ast.ts'

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

function errorValue(context: Context, node: ESTree.Node) {
	return (
		Option.exists(receiverName(node), matches(/^(?:e|err|error|failure|cause|exception)$|Error$/iu)) ||
		failureValue(context, node)
	)
}

function isErrorMessage(context: Context, node?: ESTree.Node | null) {
	if (Predicate.isNullish(node)) return false
	const value = resolveBinding(context, node)
	if (value.type === 'CallExpression') {
		if (value.callee.type === 'Identifier' && value.callee.name === 'String') {
			const argument = value.arguments[0]
			return argument !== undefined && errorValue(context, argument)
		}
		return (
			value.callee.type === 'MemberExpression' &&
			Option.contains(memberName(value.callee), 'toString') &&
			errorValue(context, value.callee.object)
		)
	}
	return (
		value.type === 'MemberExpression' &&
		Option.contains(memberName(value), 'message') &&
		errorValue(context, value.object)
	)
}

// The preset bans expect, so assert is the only assertion API.
function assertsMessage(context: Context, node: ESTree.CallExpression) {
	const [actual, expected] = node.arguments
	return (
		node.callee.type === 'MemberExpression' &&
		node.callee.object.type === 'Identifier' &&
		isErrorMessage(context, actual) &&
		expected !== undefined &&
		Array.contains(['Literal', 'TemplateLiteral'], resolveBinding(context, expected).type)
	)
}

export const testAssertions = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type !== 'MemberExpression' ||
				node.callee.object.type !== 'Identifier' ||
				!isImportBinding({context, importedName: 'assert', node: node.callee.object, source: '@effect/vitest'})
			) {
				return
			}
			if (assertsMessage(context, node)) {
				context.report({message: ASSERT_IDENTITY, node})
				return
			}
			if (
				Option.exists(memberName(node.callee), name =>
					Array.contains(
						[
							'notInclude',
							'notIncludeDeepMembers',
							'notIncludeMembers',
							'notMatch',
							'notProperty',
							'notNestedProperty',
							'notOwnProperty'
						],
						name
					)
				)
			) {
				context.report({
					message:
						'Assert the current rule through the answer a caller receives; delete checks for removed code or superseded behavior.',
					node
				})
				return
			}
			const [actual, expected] = node.arguments
			if (
				actual === undefined ||
				expected === undefined ||
				context.sourceCode.getText(actual) !== context.sourceCode.getText(expected)
			) {
				return
			}
			if (
				containsNode({
					context,
					matches: inner =>
						isFunction(inner) ||
						Array.contains(
							[
								'AssignmentExpression',
								'AwaitExpression',
								'CallExpression',
								'ClassExpression',
								'ImportExpression',
								'NewExpression',
								'TaggedTemplateExpression',
								'UpdateExpression',
								'YieldExpression'
							],
							inner.type
						),
					node: actual,
					throughFunctions: false
				})
			) {
				return
			}
			context.report({
				message: 'Compare the answer with an independent expected value, not the same expression on both sides.',
				node
			})
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.test.ts': `import {assert, it} from '@effect/vitest'
function hasBudget(balance: number) { return balance > 0 }

it('refuses spending without a balance', () => { assert.isFalse(hasBudget(0)); assert.isTrue(hasBudget(2)) })`
					}
				]
			}
		},
		type: 'problem'
	}
})
