import {Array, HashSet, Option, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isImportBinding, memberName} from '#lib/ast.ts'
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

function tagProperty(property: ESTree.ObjectExpression['properties'][number]) {
	return (
		property.type === 'Property' &&
		((!property.computed && property.key.type === 'Identifier' && property.key.name === '_tag') ||
			(property.key.type === 'Literal' && property.key.value === '_tag'))
	)
}

function schemaCall(context: Context, node: ESTree.Expression): boolean {
	if (node.type === 'CallExpression') return schemaCall(context, node.callee)
	if (node.type !== 'MemberExpression' || node.object.type !== 'Identifier') return false
	if (isImportBinding({context, importedName: 'Schema', node: node.object, source: 'effect'})) {
		return Option.exists(memberName(node), name =>
			Array.contains(['Struct', 'Class', 'Error', 'TaggedClass', 'TaggedError', 'TaggedStruct'], name)
		)
	}
	return (
		isImportBinding({context, importedName: 'Model', node: node.object, source: 'effect/schema'}) &&
		Option.contains(memberName(node), 'Class')
	)
}

// Sse's parser callback is a library-owned Event/Retry protocol, not a schema union.
function sseCallback(context: Context, node: ESTree.Node): boolean {
	if (node.parent === null) return false
	if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
		return (
			node.parent.type === 'CallExpression' &&
			node.parent.callee.type === 'MemberExpression' &&
			node.parent.callee.object.type === 'Identifier' &&
			Option.contains(memberName(node.parent.callee), 'makeParser') &&
			isImportBinding({context, importedName: 'Sse', node: node.parent.callee.object, source: 'effect/encoding'})
		)
	}
	return sseCallback(context, node.parent)
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
			BinaryExpression: node => {
				if (!Array.contains(['===', '!==', '==', '!='], node.operator)) return
				if (
					!Array.some(
						[node.left, node.right],
						operand => operand.type === 'MemberExpression' && Option.contains(memberName(operand), '_tag')
					)
				) {
					return
				}
				if (sseCallback(context, node)) return
				context.report({
					message:
						'Check tags with the schema guards or isAnyOf; use the owning Effect type predicate for library values.',
					node
				})
			},
			CallExpression: node => {
				if (!importedMember({context, importedName: 'Match', node: node.callee, propertyName: 'when'})) return
				const pattern = node.arguments[0]
				if (pattern?.type !== 'ObjectExpression') return
				const tag = Array.findFirst(pattern.properties, tagProperty)
				if (!Option.isSome(tag)) return
				context.report({
					fix: fixer => {
						if (
							pattern.properties.length !== 1 ||
							tag.value.type !== 'Property' ||
							tag.value.value.type !== 'Literal'
						) {
							return undefined
						}
						return [
							fixer.replaceText(node.callee, 'Match.tag'),
							fixer.replaceText(pattern, context.sourceCode.getText(tag.value.value))
						]
					},
					message: 'Match tags with the schema match method or Match.tag, not a hand-written _tag pattern.',
					node
				})
			},
			ObjectExpression: node => {
				if (!Array.some(node.properties, tagProperty)) return
				if (
					node.parent.type === 'CallExpression' &&
					(schemaCall(context, node.parent.callee) ||
						importedMember({context, importedName: 'Match', node: node.parent.callee, propertyName: 'when'}))
				) {
					return
				}
				context.report({
					message:
						'Build tagged values with the schema case constructor (Union.cases.Tag.make), a tagged class constructor, or the machine event protocol.',
					node
				})
			},
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
export function titleOf(state: Loading) { if (Loading.guards.Ready(state)) return state.value; return state.message }
export const created = Loading.cases.Ready.make({value: 'ready'})
export function known(state: Loading) { return Loading.isAnyOf(['Ready', 'Failed'])(state) }`
					},
					{
						'sample.ts': `import {Schema} from 'effect'
export type Priority = typeof Priority.Type
export const Priority = Schema.Literals([5, 10])
export type Decision = typeof Decision.Type
export const Decision = Schema.Literals([true, false, 'pending'])`
					},
					{
						'sample.ts': `import {MutableList} from 'effect'
import {Sse} from 'effect/encoding'
export const messages = MutableList.make<string>()
export const parser = Sse.makeParser(event => { if (event._tag === 'Event') MutableList.append(messages, event.data) })`
					}
				],
				fixes: [
					{
						'sample.ts': `import {Match, Schema, pipe} from 'effect'
export type Loading = typeof Loading.Type
export const Loading = Schema.TaggedUnion({Failed: {message: Schema.String}, Ready: {value: Schema.String}})
export function titleOf(state: Loading) { return pipe(Match.value(state), Match.when({_tag: 'Ready'}, ready => ready.value), Match.orElse(failed => failed.message)) }`
					}
				]
			}
		},
		fixable: 'code',
		type: 'problem'
	}
})
