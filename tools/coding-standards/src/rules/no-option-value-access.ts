import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {importedMember, memberName} from '#rules/shared.ts'

type Guard = {context: Context; subject: string}

function checks(input: Guard & {name: 'isNone' | 'isSome'; operator: '&&' | '||'; test: ESTree.Node}): boolean {
	if (input.test.type === 'LogicalExpression' && input.test.operator === input.operator) {
		return checks({...input, test: input.test.left}) || checks({...input, test: input.test.right})
	}
	return (
		input.test.type === 'CallExpression' &&
		importedMember({
			context: input.context,
			importedName: 'Option',
			node: input.test.callee,
			propertyName: input.name
		}) &&
		input.test.arguments[0] !== undefined &&
		input.context.sourceCode.getText(input.test.arguments[0]) === input.subject
	)
}

function exits(node: ESTree.Statement) {
	return (
		Array.contains(['ContinueStatement', 'ReturnStatement', 'ThrowStatement'], node.type) ||
		(node.type === 'BlockStatement' && Array.some(node.body, exits))
	)
}

function earlyExit(input: Guard & {node: ESTree.Node}) {
	if (input.node.parent?.type !== 'BlockStatement' && input.node.parent?.type !== 'Program') return false
	return Array.some(
		Array.take(
			input.node.parent.body,
			Option.getOrElse(
				Array.findFirstIndex(input.node.parent.body, statement => statement === input.node),
				() => 0
			)
		),
		statement =>
			statement.type === 'IfStatement' &&
			exits(statement.consequent) &&
			checks({...input, name: 'isNone', operator: '||', test: statement.test})
	)
}

function guarded(input: Guard & {node: ESTree.Node}): boolean {
	if (input.node.parent === null || input.node.parent.type === 'FunctionDeclaration') return false
	function some(test: ESTree.Node) {
		return checks({...input, name: 'isSome', operator: '&&', test})
	}
	return (
		(input.node.parent.type === 'IfStatement' &&
			input.node.parent.consequent === input.node &&
			some(input.node.parent.test)) ||
		(input.node.parent.type === 'ConditionalExpression' &&
			input.node.parent.consequent === input.node &&
			some(input.node.parent.test)) ||
		(input.node.parent.type === 'LogicalExpression' &&
			input.node.parent.right === input.node &&
			input.node.parent.operator === '&&' &&
			some(input.node.parent.left)) ||
		(input.node.parent.type === 'LogicalExpression' &&
			input.node.parent.right === input.node &&
			input.node.parent.operator === '||' &&
			checks({...input, name: 'isNone', operator: '||', test: input.node.parent.left})) ||
		earlyExit(input) ||
		guarded({...input, node: input.node.parent})
	)
}

export const noOptionValueAccess = defineRule({
	create: context => ({
		MemberExpression: node => {
			if (!Option.contains(memberName(node), 'value')) return
			if (guarded({context, node, subject: context.sourceCode.getText(node.object)})) {
				context.report({message: 'Read the value with Option.match, Option.map, or Option.getOrElse.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
