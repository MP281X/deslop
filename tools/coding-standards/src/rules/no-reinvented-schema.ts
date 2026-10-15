import {Array, Option, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {importedMember, memberName} from '#rules/shared.ts'

const shipped = [
	{base: 'String', check: 'isMinLength', only: 1, schema: 'NonEmptyString'},
	{base: 'String', check: 'isNonEmpty', only: undefined, schema: 'NonEmptyString'},
	{base: 'String', check: 'isTrimmed', only: undefined, schema: 'Trimmed'},
	{base: 'Number', check: 'isInt', only: undefined, schema: 'Int'},
	{base: 'Int', check: 'isGreaterThanOrEqualTo', only: 0, schema: 'Natural'}
]

function schemaMember(input: {context: Context; node: ESTree.Node}) {
	if (
		input.node.type !== 'MemberExpression' ||
		!importedMember({context: input.context, importedName: 'Schema', node: input.node})
	) {
		return Option.none()
	}
	return memberName(input.node)
}

function shippedSchema(input: {base: ESTree.Node; context: Context; filter: ESTree.Node}) {
	if (input.filter.type !== 'CallExpression') return Option.none()
	const base = schemaMember({context: input.context, node: input.base})
	const check = schemaMember({context: input.context, node: input.filter.callee})
	const [value, ...rest] = input.filter.arguments
	return pipe(
		shipped,
		Array.findFirst(
			entry =>
				Option.contains(base, entry.base) &&
				Option.contains(check, entry.check) &&
				Array.isArrayEmpty(rest) &&
				Option.match(Option.fromUndefinedOr(entry.only), {
					onNone: () => value === undefined,
					onSome: only => value?.type === 'Literal' && value.value === only
				})
		),
		Option.map(entry => entry.schema)
	)
}

function pipedBase(node: ESTree.CallExpression) {
	if (node.parent.type !== 'CallExpression') return Option.none()
	if (
		node.parent.callee.type === 'Identifier' &&
		node.parent.callee.name === 'pipe' &&
		node.parent.arguments.length === 2
	) {
		if (node.parent.arguments[1] !== node) return Option.none()
		return Option.fromNullishOr(node.parent.arguments[0])
	}
	if (
		node.parent.callee.type !== 'MemberExpression' ||
		!Option.contains(memberName(node.parent.callee), 'pipe') ||
		node.parent.arguments.length !== 1
	) {
		return Option.none()
	}
	return Option.some(node.parent.callee.object)
}

function reinventedSchema(input: {context: Context; node: ESTree.CallExpression}) {
	if (input.node.callee.type !== 'MemberExpression' || !Option.contains(memberName(input.node.callee), 'check')) {
		return Option.none()
	}
	const callee = input.node.callee
	const [filter] = input.node.arguments
	if (Option.isSome(schemaMember({context: input.context, node: callee}))) {
		if (input.node.arguments.length !== 1 || filter === undefined) return Option.none()
		return pipe(
			pipedBase(input.node),
			Option.flatMap(base => shippedSchema({base, context: input.context, filter}))
		)
	}
	return Array.findFirst(input.node.arguments, argument =>
		shippedSchema({base: callee.object, context: input.context, filter: argument})
	)
}

export const noReinventedSchema = defineRule({
	create: context => ({
		CallExpression: node => {
			Option.map(reinventedSchema({context, node}), schema => {
				context.report({
					message: `Replace this base and its matching refinement with Schema.${schema}, keeping every other check.`,
					node
				})
			})
		}
	}),
	meta: {type: 'problem'}
})
