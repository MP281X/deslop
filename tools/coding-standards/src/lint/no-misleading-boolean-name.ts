import {Array, Option, Predicate, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {childNodes, isFunction, matches, memberName, resolveBinding, variableFromScope} from '#lib/ast.ts'

const MESSAGE = 'An is, has, can or should name promises a boolean; rename it to say what it holds, or make it one.'
const NON_BOOLEAN_OPERATORS = ['%', '&', '*', '**', '+', '-', '/', '<<', '>>', '>>>', '^', '|']
const NON_BOOLEAN_NODES = [
	'ArrayExpression',
	'ClassExpression',
	'JSXElement',
	'JSXFragment',
	'NewExpression',
	'ObjectExpression',
	'TemplateLiteral',
	'UpdateExpression'
]
const isBooleanName = matches(/^(?:is|has|can|should)[A-Z0-9]/u)

// Oxlint exposes no TypeScript program to JS rules; use the annotations present in its AST.
function annotation(context: Context, node: ESTree.Node) {
	if (node.type !== 'Identifier') return Option.none<ESTree.TSType>()
	return Option.flatMap(variableFromScope({name: node.name, scope: context.sourceCode.getScope(node)}), variable =>
		Option.flatMap(Array.head(variable.identifiers), id => Option.fromNullishOr(id.typeAnnotation?.typeAnnotation))
	)
}

function hasLength(type: ESTree.TSType): boolean {
	if (type.type === 'TSTypeOperator' && type.operator === 'readonly') return hasLength(type.typeAnnotation)
	return (
		type.type === 'TSStringKeyword' ||
		type.type === 'TSArrayType' ||
		type.type === 'TSTupleType' ||
		(type.type === 'TSTypeReference' &&
			type.typeName.type === 'Identifier' &&
			Array.contains(['Array', 'ReadonlyArray'], type.typeName.name))
	)
}

function nonBooleanType(type: ESTree.TSType): boolean {
	if (type.type === 'TSUnionType') return Array.every(type.types, nonBooleanType)
	return (
		hasLength(type) ||
		Array.contains(['TSBigIntKeyword', 'TSNumberKeyword', 'TSSymbolKeyword'], type.type) ||
		(type.type === 'TSTypeLiteral' && Array.every(type.members, member => member.type !== 'TSCallSignatureDeclaration'))
	)
}

function nonBoolean(context: Context, node: ESTree.Node) {
	if (node.type === 'Literal') return node.value !== null && !Predicate.isBoolean(node.value)
	if (node.type === 'BinaryExpression') return Array.contains(NON_BOOLEAN_OPERATORS, node.operator)
	if (node.type === 'UnaryExpression') return Array.contains(['+', '-', 'typeof', '~'], node.operator)
	if (Option.exists(annotation(context, node), nonBooleanType)) return true
	if (node.type === 'MemberExpression' && Option.contains(memberName(node), 'length')) {
		const object = resolveBinding(context, node.object)
		return (
			Option.exists(annotation(context, node.object), hasLength) ||
			object.type === 'ArrayExpression' ||
			(object.type === 'Literal' && Predicate.isString(object.value))
		)
	}
	return Array.contains(NON_BOOLEAN_NODES, node.type)
}

// The values a function returns from its own body, not from the functions inside it.
function returnedValues(context: Context, node: ESTree.Node): ESTree.Node[] {
	if (node.type === 'ReturnStatement') return Option.toArray(Option.fromNullishOr(node.argument))
	if (isFunction(node)) return []
	return Array.flatMap(childNodes(context, node), child => returnedValues(context, child))
}

function returnsNonBoolean(context: Context, node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	if (node.generator || node.body === null) return false
	if (node.body.type !== 'BlockStatement') return nonBoolean(context, node.body)
	return pipe(
		node.body.body,
		Array.flatMap(statement => returnedValues(context, statement)),
		Array.some(value => nonBoolean(context, value))
	)
}

export const noMisleadingBooleanName = defineRule({
	create: context => ({
		FunctionDeclaration: node => {
			if (node.id !== null && isBooleanName(node.id.name) && returnsNonBoolean(context, node)) {
				context.report({message: MESSAGE, node: node.id})
			}
		},
		VariableDeclarator: node => {
			if (node.id.type !== 'Identifier' || !isBooleanName(node.id.name) || node.init === null) return
			if (
				nonBoolean(context, node.init) ||
				((node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') &&
					returnsNonBoolean(context, node.init))
			) {
				context.report({message: MESSAGE, node: node.id})
			}
		}
	}),
	meta: {
		docs: {examples: {accepted: [{'sample.ts': 'export function hasBudget(balance: number) { return balance > 0 }'}]}},
		type: 'problem'
	}
})
