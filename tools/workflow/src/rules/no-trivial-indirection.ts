import {Array, Option, String, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {variableFor, variableFromScope} from './shared.ts'

function parameterName(parameter: ESTree.ParamPattern) {
	if (parameter.type === 'Identifier') return Option.some(parameter.name)
	if (parameter.type === 'RestElement' && parameter.argument.type === 'Identifier') {
		return Option.some(parameter.argument.name)
	}
	return Option.none()
}

function forwardedCall(input: {names: string[]; node: ESTree.CallExpression | ESTree.NewExpression}) {
	return (
		input.node.arguments.length === input.names.length &&
		Array.every(input.node.arguments, (argument, index) => {
			const name = input.names[index]
			if (argument.type === 'SpreadElement') {
				return argument.argument.type === 'Identifier' && argument.argument.name === name
			}
			return argument.type === 'Identifier' && argument.name === name
		})
	)
}

function returnedExpression(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.body === null) return
	if (node.body.type !== 'BlockStatement') return node.body
	if (node.body.body.length !== 1 || node.body.body[0]?.type !== 'ReturnStatement') return
	return node.body.body[0].argument
}

function hasSingleStatementExpression(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.body === null) return false
	if (node.body.type !== 'BlockStatement') return true
	if (node.body.body.length !== 1) return false
	const statement = node.body.body[0]
	return (
		statement?.type === 'ExpressionStatement' || (statement?.type === 'ReturnStatement' && statement.argument !== null)
	)
}

function exactForwardingFunction(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	const names = pipe(node.params, Array.map(parameterName), Array.getSomes)
	const returned = returnedExpression(node)
	if (names.length === 0 || names.length !== node.params.length || returned === null || returned === undefined) {
		return false
	}
	if (returned.type === 'Identifier') return names.length === 1 && returned.name === names[0]
	return (
		(returned.type === 'CallExpression' || returned.type === 'NewExpression') &&
		returned.callee.type === 'Identifier' &&
		forwardedCall({names, node: returned})
	)
}

function singleUseThunk(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	if (
		input.node.params.length !== 0 ||
		input.node.typeParameters !== null ||
		!hasSingleStatementExpression(input.node)
	) {
		return false
	}
	let name = ''
	if (input.node.type === 'FunctionDeclaration') {
		name = input.node.id?.name ?? ''
	} else if (input.node.parent.type === 'VariableDeclarator' && input.node.parent.id.type === 'Identifier') {
		name = input.node.parent.id.name
	}
	if (String.isEmpty(name)) return false
	return pipe(
		variableFromScope({name, scope: input.context.sourceCode.getScope(input.node)}),
		Option.exists(variable => Array.filter(variable.references, reference => reference.isRead()).length === 1)
	)
}

function immutableSource(context: Context, node: ESTree.IdentifierReference) {
	return pipe(
		variableFor(context, node),
		Option.exists(variable => {
			if (Array.some(variable.references, reference => reference.isWrite() && !reference.init)) return false
			return Array.some(variable.defs, definition => {
				if (definition.type === 'ImportBinding' || definition.type === 'Parameter') return true
				return (
					definition.node.type === 'VariableDeclarator' &&
					definition.node.parent.type === 'VariableDeclaration' &&
					definition.node.parent.kind === 'const'
				)
			})
		})
	)
}

function redundantConstAlias(input: {context: Context; node: ESTree.VariableDeclarator}) {
	if (
		input.node.parent.type !== 'VariableDeclaration' ||
		input.node.parent.kind !== 'const' ||
		input.node.id.type !== 'Identifier' ||
		input.node.id.typeAnnotation !== null ||
		input.node.init?.type !== 'Identifier' ||
		!immutableSource(input.context, input.node.init)
	) {
		return false
	}
	return pipe(
		variableFromScope({name: input.node.id.name, scope: input.context.sourceCode.getScope(input.node)}),
		Option.exists(alias => Array.filter(alias.references, reference => reference.isRead()).length === 1)
	)
}

export const noTrivialIndirection = defineRule({
	create: context => ({
		ArrowFunctionExpression: node => {
			if (
				(node.parent.type === 'VariableDeclarator' || node.parent.type === 'Property') &&
				(exactForwardingFunction(node) || singleUseThunk({context, node}))
			) {
				context.report({message: 'Inline this function at its only use site.', node})
			}
		},
		FunctionDeclaration: node => {
			if (exactForwardingFunction(node) || singleUseThunk({context, node})) {
				context.report({message: 'Inline this function at its only use site.', node})
			}
		},
		FunctionExpression: node => {
			if (
				(node.parent.type === 'VariableDeclarator' ||
					node.parent.type === 'Property' ||
					(node.parent.type === 'MethodDefinition' && node.parent.override !== true)) &&
				(exactForwardingFunction(node) || singleUseThunk({context, node}))
			) {
				context.report({message: 'Inline this function at its only use site.', node})
			}
		},
		VariableDeclarator: node => {
			if (redundantConstAlias({context, node})) {
				context.report({message: 'Use the immutable source binding directly.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
