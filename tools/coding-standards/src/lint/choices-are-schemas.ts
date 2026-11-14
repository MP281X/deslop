import {Array, HashSet, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {redundantReturnAnnotation} from '#lint/no-redundant-annotation.ts'

const LITERAL_KINDS = [
	{is: Predicate.isString, keyword: 'TSStringKeyword'},
	{is: Predicate.isNumber, keyword: 'TSNumberKeyword'},
	{is: Predicate.isBoolean, keyword: 'TSBooleanKeyword'},
	{is: Predicate.isBigInt, keyword: 'TSBigIntKeyword'}
]

function constituentKey(context: Context, node: ESTree.TSType) {
	if (node.type === 'TSLiteralType' && node.literal.type === 'Literal') {
		if (Predicate.isString(node.literal.value)) return `text:${node.literal.value}`
		if (Predicate.isNumber(node.literal.value)) return `number:${node.literal.value}`
		if (Predicate.isBoolean(node.literal.value)) return `boolean:${node.literal.value}`
		if (Predicate.isBigInt(node.literal.value)) return `bigint:${node.literal.value}`
	}
	return context.sourceCode.getText(node)
}

function overriddenLiteral(types: HashSet.HashSet<string>, literal: ESTree.TSLiteralType['literal']) {
	if (literal.type !== 'Literal') return false
	return Array.some(LITERAL_KINDS, kind => HashSet.has(types, kind.keyword) && kind.is(literal.value))
}

function nativeUnion(context: Context, node: ESTree.TSUnionType) {
	const types = HashSet.fromIterable<string>(Array.map(node.types, member => member.type))
	return (
		Array.some(['TSAnyKeyword', 'TSUnknownKeyword', 'TSNeverKeyword'], type => HashSet.has(types, type)) ||
		Array.dedupe(Array.map(node.types, member => constituentKey(context, member))).length !== node.types.length ||
		Array.some(node.types, member => member.type === 'TSLiteralType' && overriddenLiteral(types, member.literal))
	)
}

function discardedReturnType(context: Context, node: ESTree.Node): boolean {
	if (
		node.parent?.type === 'TSTypeAnnotation' &&
		(node.parent.parent.type === 'ArrowFunctionExpression' ||
			node.parent.parent.type === 'FunctionDeclaration' ||
			node.parent.parent.type === 'FunctionExpression') &&
		node.parent.parent.returnType === node.parent
	) {
		return redundantReturnAnnotation(context, node.parent.parent)
	}
	return node.parent !== null && String.startsWith('TS')(node.parent.type) && discardedReturnType(context, node.parent)
}

// A schema's own members describe its type, so `typeof X.Type` and `typeof X.literals` stay.
function schemaMember(name: ESTree.TSTypeName) {
	return (
		name.type === 'TSQualifiedName' &&
		Array.contains(['Encoded', 'Type', 'cases', 'fields', 'literals', 'members'], name.right.name)
	)
}

function valueQuery(node: ESTree.TSType): boolean {
	if (node.type === 'TSParenthesizedType') return valueQuery(node.typeAnnotation)
	if (node.type === 'TSIndexedAccessType') return valueQuery(node.objectType)
	return (
		node.type === 'TSTypeQuery' &&
		(node.exprName.type === 'Identifier' || (node.exprName.type === 'TSQualifiedName' && !schemaMember(node.exprName)))
	)
}

// An indexed access inside another one's object is reported once, at the outer access.
function nestedObject(node: ESTree.Node) {
	return node.parent?.type === 'TSIndexedAccessType' && node.parent.objectType === node
}

function fixedChoice(context: Context, node: ESTree.TSType) {
	if (node.type !== 'TSUnionType' || nativeUnion(context, node)) return false
	const members = Array.filter(
		node.types,
		member => !Array.contains(['TSNullKeyword', 'TSUndefinedKeyword', 'TSVoidKeyword'], member.type)
	)
	return (
		members.length > 1 &&
		(Array.some(members, member => member.type === 'TSLiteralType') ||
			Array.every(members, member => member.type === 'TSTypeLiteral'))
	)
}

function insideChoice(context: Context, node: ESTree.Node): boolean {
	if (node.parent?.type === 'TSUnionType') {
		return fixedChoice(context, node.parent) || insideChoice(context, node.parent)
	}
	if (
		node.parent?.type === 'TSTypeLiteral' ||
		node.parent?.type === 'TSTypeAnnotation' ||
		node.parent?.type === 'TSPropertySignature'
	) {
		return insideChoice(context, node.parent)
	}
	return false
}

export const choicesAreSchemas = defineRule({
	create: context => {
		function report(node: ESTree.Node) {
			if (discardedReturnType(context, node)) return
			context.report({
				message:
					'Declare this choice once as a named schema: Schema.Literals for fixed values, Schema.TaggedUnion with _tag for shapes, or Schema.Union to extend existing schemas; use its paired type (typeof Choice.Type).',
				node
			})
		}
		return {
			TSIndexedAccessType: node => {
				if (!nestedObject(node) && valueQuery(node.objectType)) report(node)
			},
			TSTypeOperator: node => {
				if (node.operator === 'keyof' && !nestedObject(node) && valueQuery(node.typeAnnotation)) report(node)
			},
			TSUnionType: node => {
				if (fixedChoice(context, node) && !insideChoice(context, node)) report(node)
			}
		}
	},
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Schema} from 'effect'
export type Status = typeof Status.Type
export const Status = Schema.Literals(['draft', 'published'])`
					},
					{
						'sample.ts': `import {Schema} from 'effect'
export type Loading = typeof Loading.Type
export const Loading = Schema.TaggedUnion({Failed: {message: Schema.String}, Ready: {value: Schema.String}})
export function titleOf(state: Loading) { if (state._tag === 'Ready') return state.value; return state.message }`
					},
					{
						'sample.ts': `import {Schema} from 'effect'
export type Priority = typeof Priority.Type
export const Priority = Schema.Literals([5, 10])
export type Decision = typeof Decision.Type
export const Decision = Schema.Literals([true, false, 'pending'])`
					}
				]
			}
		},
		type: 'problem'
	}
})
