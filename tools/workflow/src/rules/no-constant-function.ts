import {Array, Option, Predicate, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree, Reference, Scope, Variable} from '@oxlint/plugins'

import {variableFromScope} from './shared.ts'

function hasSingleReturnExpression(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.body === null) return false
	if (node.body.type !== 'BlockStatement') return true
	const statement = node.body.body[0]
	return node.body.body.length === 1 && statement?.type === 'ReturnStatement' && statement.argument !== null
}

function functionScope(input: {node: ESTree.Node; scope: Scope}): Option.Option<Scope> {
	if (input.scope.block === input.node) return Option.some(input.scope)
	return Array.findFirst(input.scope.childScopes, child => child.block === input.node)
}

function scopeReferences(scope: Scope): Reference[] {
	return Array.appendAll(scope.references, Array.flatMap(scope.childScopes, scopeReferences))
}

function isImportedVariable(variable: Variable) {
	return (
		Array.isArrayNonEmpty(variable.defs) &&
		Array.every(variable.defs, definition => definition.type === 'ImportBinding')
	)
}

function resolvesToImport(reference: Reference) {
	return pipe(
		variableFromScope({name: reference.identifier.name, scope: reference.from}),
		Option.exists(isImportedVariable)
	)
}

function isConstantFunction(input: {
	context: Context
	node: ESTree.Function | ESTree.ArrowFunctionExpression
	spans: ESTree.Span[]
}) {
	if (input.node.async || input.node.generator || Predicate.isNotNullish(input.node.typeParameters)) return false
	if (Array.some(input.spans, span => span.start >= input.node.start && span.end <= input.node.end)) return false
	return (
		hasSingleReturnExpression(input.node) &&
		pipe(
			functionScope({node: input.node, scope: input.context.sourceCode.getScope(input.node)}),
			Option.exists(scope => Array.every(scopeReferences(scope), resolvesToImport))
		)
	)
}

function isConstBound(node: ESTree.ArrowFunctionExpression | ESTree.Function) {
	return (
		node.parent.type === 'VariableDeclarator' &&
		node.parent.parent.type === 'VariableDeclaration' &&
		node.parent.parent.kind === 'const'
	)
}

const message = 'This function reads nothing but imports, so it is a value: hold its result in a const.'

export const noConstantFunction = defineRule({
	create: context => {
		let spans = Array.empty<ESTree.Span>()
		function mark(node: ESTree.Span) {
			spans = Array.append(spans, node)
		}
		function report(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
			if (isConstantFunction({context, node, spans})) context.report({message, node})
		}
		return {
			'ArrowFunctionExpression:exit': node => {
				if (isConstBound(node)) report(node)
			},
			'FunctionDeclaration:exit': report,
			'FunctionExpression:exit': node => {
				if (isConstBound(node)) report(node)
			},
			JSXElement: mark,
			JSXFragment: mark,
			ThisExpression: mark
		}
	},
	meta: {type: 'problem'}
})
