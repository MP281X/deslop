import {Array, Equivalence, Option, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {bindingName, matches, variableFromScope} from '#rules/shared.ts'

function namedTuple(input: {context: Context; node: ESTree.TSType; seen: ESTree.TSType[]}): boolean {
	if (Array.containsWith(Equivalence.strictEqual<ESTree.TSType>())(input.seen, input.node)) return false
	if (input.node.type === 'TSTupleType') {
		return (
			Array.isArrayNonEmpty(input.node.elementTypes) &&
			Array.every(input.node.elementTypes, element => element.type === 'TSNamedTupleMember')
		)
	}
	if (
		input.node.type === 'TSParenthesizedType' ||
		(input.node.type === 'TSTypeOperator' && input.node.operator === 'readonly')
	) {
		return namedTuple({...input, node: input.node.typeAnnotation, seen: Array.append(input.seen, input.node)})
	}
	if (input.node.type !== 'TSTypeReference' || input.node.typeName.type !== 'Identifier') return false
	return pipe(
		variableFromScope({name: input.node.typeName.name, scope: input.context.sourceCode.getScope(input.node)}),
		Option.exists(variable =>
			Array.some(
				variable.defs,
				definition =>
					definition.node.type === 'TSTypeAliasDeclaration' &&
					namedTuple({
						context: input.context,
						node: definition.node.typeAnnotation,
						seen: Array.append(input.seen, input.node)
					})
			)
		)
	)
}

function componentName(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.type !== 'ArrowFunctionExpression' && node.id !== null) return Option.some(node.id.name)
	return bindingName(node)
}

function component(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (!Option.exists(componentName(node), matches(/^[A-Z]/u)) || node.params.length !== 1 || node.body === null) {
		return false
	}
	if (node.body.type === 'JSXElement' || node.body.type === 'JSXFragment') return true
	return (
		node.body.type === 'BlockStatement' &&
		Array.some(
			node.body.body,
			statement =>
				statement.type === 'ReturnStatement' &&
				(statement.argument?.type === 'JSXElement' || statement.argument?.type === 'JSXFragment')
		)
	)
}

function isPattern(input: {
	context: Context
	node: ESTree.ParamPattern | ESTree.BindingPattern
	component: boolean
}): boolean {
	if (input.node.type === 'AssignmentPattern') return isPattern({...input, node: input.node.left})
	if (input.node.type === 'ArrayPattern') {
		return !Option.exists(Option.fromNullishOr(input.node.typeAnnotation), annotation =>
			namedTuple({context: input.context, node: annotation.typeAnnotation, seen: []})
		)
	}
	if (input.node.type !== 'ObjectPattern') return false
	const named = Array.filter(input.node.properties, property => property.type === 'Property')
	return !(
		input.component &&
		named.length === 1 &&
		named[0]?.key.type === 'Identifier' &&
		named[0].key.name === 'ref' &&
		Array.some(input.node.properties, property => property.type === 'RestElement')
	)
}

export const noDestructuredParameter = defineRule({
	create: context => {
		function reportParameters(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
			for (const parameter of Array.filter(node.params, candidate =>
				isPattern({component: component(node), context, node: candidate})
			)) {
				context.report({
					message: 'Take the value whole and read its fields instead of destructuring it.',
					node: parameter
				})
			}
		}
		function reportLoopVariable(node: ESTree.ForOfStatement | ESTree.ForInStatement) {
			if (
				node.left.type === 'VariableDeclaration' &&
				Array.some(node.left.declarations, declarator => isPattern({component: false, context, node: declarator.id}))
			) {
				context.report({
					message: 'Take the value whole and read its fields instead of destructuring it.',
					node: node.left
				})
			}
		}
		return {
			ArrowFunctionExpression: reportParameters,
			ForInStatement: reportLoopVariable,
			ForOfStatement: reportLoopVariable,
			FunctionDeclaration: reportParameters,
			FunctionExpression: reportParameters
		}
	},
	meta: {type: 'problem'}
})
