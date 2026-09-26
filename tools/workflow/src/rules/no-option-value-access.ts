import {Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {importedMember, memberName} from './shared.ts'

function guardsSome(input: {context: Context; name: string; test: ESTree.Expression}): boolean {
	if (input.test.type === 'LogicalExpression' && input.test.operator === '&&') {
		return (
			guardsSome({context: input.context, name: input.name, test: input.test.left}) ||
			guardsSome({context: input.context, name: input.name, test: input.test.right})
		)
	}
	return (
		input.test.type === 'CallExpression' &&
		importedMember({context: input.context, importedName: 'Option', node: input.test.callee, propertyName: 'isSome'}) &&
		input.test.arguments[0]?.type === 'Identifier' &&
		input.test.arguments[0].name === input.name
	)
}

function guardedBySome(input: {context: Context; name: string; node: ESTree.Node}): boolean {
	const parent = input.node.parent
	if (parent === null || parent.type === 'Program' || parent.type === 'FunctionDeclaration') return false
	const guarded =
		(parent.type === 'IfStatement' && parent.test !== input.node && guardsSome({...input, test: parent.test})) ||
		(parent.type === 'ConditionalExpression' &&
			parent.test !== input.node &&
			guardsSome({...input, test: parent.test})) ||
		(parent.type === 'LogicalExpression' &&
			parent.operator === '&&' &&
			parent.right === input.node &&
			guardsSome({...input, test: parent.left}))
	return guarded || guardedBySome({context: input.context, name: input.name, node: parent})
}

export const noOptionValueAccess = defineRule({
	create: context => ({
		MemberExpression: node => {
			if (node.object.type !== 'Identifier' || !Option.contains(memberName(node), 'value')) return
			if (guardedBySome({context, name: node.object.name, node})) {
				context.report({message: 'Read the value with Option.match, Option.map, or Option.getOrElse.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
