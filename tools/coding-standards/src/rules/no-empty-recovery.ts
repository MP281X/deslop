import {Array, Option, Predicate, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isImportBinding, memberName, returnedExpression} from '#rules/shared.ts'

function calleeOf(node: ESTree.Expression) {
	if (node.type === 'CallExpression' && node.callee.type !== 'Super') return node.callee
	return node
}

// Effect's empty constructors, such as `Array.empty()`, `HashMap.empty()` and `String.empty`.
function isEffectEmpty(input: {context: Context; node: ESTree.Expression}) {
	const member = calleeOf(input.node)
	return (
		member.type === 'MemberExpression' &&
		member.object.type === 'Identifier' &&
		Option.contains(memberName(member), 'empty') &&
		isImportBinding({context: input.context, node: member.object, source: 'effect'})
	)
}

function isEmptyValue(input: {context: Context; node?: ESTree.Expression | null}) {
	if (Predicate.isNullish(input.node)) return false
	if (input.node.type === 'Identifier') return input.node.name === 'undefined'
	if (input.node.type === 'Literal') return input.node.value === null || input.node.value === ''
	if (input.node.type === 'ArrayExpression') return Array.isArrayEmpty(input.node.elements)
	if (input.node.type === 'ObjectExpression') return Array.isArrayEmpty(input.node.properties)
	if (input.node.type === 'TemplateLiteral') {
		return Array.isArrayEmpty(input.node.expressions) && Array.every(input.node.quasis, quasi => quasi.value.raw === '')
	}
	return isEffectEmpty({context: input.context, node: input.node})
}

// `Effect.void` or `Effect.succeed(<empty value>)`: a recovery that reports nothing.
function isEmptySuccess(input: {context: Context; node?: ESTree.Expression | null}) {
	if (Predicate.isNullish(input.node)) return false
	if (importedMember({context: input.context, importedName: 'Effect', node: input.node, propertyName: 'void'})) {
		return true
	}
	return (
		input.node.type === 'CallExpression' &&
		input.node.callee.type !== 'Super' &&
		importedMember({
			context: input.context,
			importedName: 'Effect',
			node: input.node.callee,
			propertyName: 'succeed'
		}) &&
		Array.every(
			input.node.arguments,
			argument => argument.type !== 'SpreadElement' && isEmptyValue({context: input.context, node: argument})
		)
	)
}

// Effect.orElseSucceed returns the value itself; the catch and orElse family return an Effect.
function recoversEmpty(input: {context: Context; name: string; node?: ESTree.Expression | null}) {
	if (input.name === 'orElseSucceed') return isEmptyValue({context: input.context, node: input.node})
	return isEmptySuccess({context: input.context, node: input.node})
}

export const noEmptyRecovery = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type !== 'MemberExpression' ||
				!importedMember({context, importedName: 'Effect', node: node.callee})
			) {
				return
			}
			const name = pipe(
				memberName(node.callee),
				Option.getOrElse(() => '')
			)
			if (!pipe(name, String.startsWith('catch')) && !pipe(name, String.startsWith('orElse'))) return
			for (const argument of node.arguments) {
				if (
					(argument.type === 'ArrowFunctionExpression' || argument.type === 'FunctionExpression') &&
					recoversEmpty({context, name, node: returnedExpression(argument)})
				) {
					context.report({
						message:
							'Let the failure flow, map it with Effect.mapError(cause => ServiceError.make({cause, message})), or use Effect.option when absence is a valid result; an empty value hides the failure.',
						node: argument
					})
				}
			}
		}
	}),
	meta: {type: 'problem'}
})
