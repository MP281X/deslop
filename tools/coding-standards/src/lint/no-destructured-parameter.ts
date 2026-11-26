import {Array, Equivalence, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {variableFromScope} from '#lib/ast.ts'

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
	return Option.exists(
		variableFromScope({name: input.node.typeName.name, scope: input.context.sourceCode.getScope(input.node)}),
		variable =>
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
}

function isPattern(input: {context: Context; node: ESTree.ParamPattern | ESTree.BindingPattern}): boolean {
	if (input.node.type === 'AssignmentPattern') return isPattern({...input, node: input.node.left})
	if (input.node.type === 'ArrayPattern') {
		return !Option.exists(Option.fromNullishOr(input.node.typeAnnotation), annotation =>
			namedTuple({context: input.context, node: annotation.typeAnnotation, seen: []})
		)
	}

	return input.node.type === 'ObjectPattern'
}

export const noDestructuredParameter = defineRule({
	create: context => {
		function reportParameters(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
			for (const parameter of Array.filter(node.params, candidate => isPattern({context, node: candidate}))) {
				context.report({
					message: 'Take the value whole and read its fields instead of destructuring it.',
					node: parameter
				})
			}
		}
		function reportLoopVariable(node: ESTree.ForOfStatement | ESTree.ForInStatement) {
			if (
				node.left.type === 'VariableDeclaration' &&
				Array.some(node.left.declarations, declarator => isPattern({context, node: declarator.id}))
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
			FunctionExpression: reportParameters,
			VariableDeclarator: node => {
				if (
					node.id.type !== 'ObjectPattern' ||
					node.parent.parent?.type === 'ForOfStatement' ||
					node.parent.parent?.type === 'ForInStatement'
				) {
					return
				}
				context.report({
					message: 'Read the fields from the value where they are used instead of destructuring them into local names.',
					node: node.id
				})
			}
		}
	},
	meta: {
		docs: {
			examples: {accepted: [{'sample.ts': 'export function titleOf(note: {title: string}) { return note.title }'}]}
		},
		type: 'problem'
	}
})
