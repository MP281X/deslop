import {Array, Option, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {importedMember, memberName} from './shared.ts'

const shipped = [
	{base: 'String', check: 'isMinLength', only: 1, schema: 'NonEmptyString'},
	{base: 'String', check: 'isNonEmpty', only: undefined, schema: 'NonEmptyString'},
	{base: 'String', check: 'isTrimmed', only: undefined, schema: 'Trimmed'},
	{base: 'Number', check: 'isInt', only: undefined, schema: 'Int'},
	{base: 'Int', check: 'isGreaterThanOrEqualTo', only: 0, schema: 'Natural'}
]

function schemaMember(input: {context: Context; node: ESTree.Node}) {
	return input.node.type === 'MemberExpression' &&
		importedMember({context: input.context, importedName: 'Schema', node: input.node})
		? memberName(input.node)
		: Option.none()
}

function shippedSchema(input: {context: Context; node: ESTree.CallExpression}) {
	if (input.node.callee.type !== 'MemberExpression' || !Option.contains(memberName(input.node.callee), 'check')) {
		return Option.none()
	}
	const base = schemaMember({context: input.context, node: input.node.callee.object})
	return Array.findFirst(input.node.arguments, argument => {
		if (argument.type !== 'CallExpression') return Option.none()
		const check = schemaMember({context: input.context, node: argument.callee})
		const [value, ...rest] = argument.arguments
		return pipe(
			shipped,
			Array.findFirst(
				entry =>
					Option.contains(base, entry.base) &&
					Option.contains(check, entry.check) &&
					Array.isArrayEmpty(rest) &&
					(entry.only === undefined ? value === undefined : value?.type === 'Literal' && value.value === entry.only)
			),
			Option.map(entry => entry.schema)
		)
	})
}

export const noReinventedSchema = defineRule({
	create: context => ({
		CallExpression: node => {
			Option.map(shippedSchema({context, node}), schema => {
				context.report({message: `Use Schema.${schema}; Effect ships this refinement.`, node})
			})
		}
	}),
	meta: {type: 'problem'}
})
