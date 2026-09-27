import {Array, Option, Predicate, Record, String, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {memberName, returnedExpression} from './shared.ts'

function isSubject(input: {name: string; node: ESTree.Node}) {
	return input.node.type === 'Identifier' && input.node.name === input.name
}

function comparison(input: {name: string; operator: string; other: ESTree.Node; subject: ESTree.Node}) {
	if (
		input.subject.type === 'UnaryExpression' &&
		input.subject.operator === 'typeof' &&
		isSubject({name: input.name, node: input.subject.argument}) &&
		input.other.type === 'Literal' &&
		Predicate.isString(input.other.value)
	) {
		return Option.some(`typeof ${input.operator} ${input.other.value}`)
	}
	if (!isSubject({name: input.name, node: input.subject})) return Option.none()
	if (input.other.type === 'Literal' && input.other.raw === 'null') return Option.some(`${input.operator} null`)
	if (input.other.type === 'Identifier' && input.other.name === 'undefined') {
		return Option.some(`${input.operator} undefined`)
	}
	return Option.none()
}

function check(input: {name: string; node: ESTree.Expression}): Option.Option<string[]> {
	if (input.node.type === 'LogicalExpression' && input.node.operator === '&&') {
		return pipe(
			Option.all([check({name: input.name, node: input.node.left}), check({name: input.name, node: input.node.right})]),
			Option.map(Array.flatten)
		)
	}
	if (
		input.node.type === 'UnaryExpression' &&
		input.node.operator === '!' &&
		input.node.argument.type === 'CallExpression' &&
		input.node.argument.callee.type === 'MemberExpression' &&
		isSubject({name: 'Array', node: input.node.argument.callee.object}) &&
		Option.contains(memberName(input.node.argument.callee), 'isArray') &&
		input.node.argument.arguments.length === 1 &&
		Array.every(input.node.argument.arguments, argument => isSubject({name: input.name, node: argument}))
	) {
		return Option.some(['!Array.isArray'])
	}
	if (input.node.type !== 'BinaryExpression') return Option.none()
	if (input.node.operator === 'instanceof') {
		return isSubject({name: input.name, node: input.node.left}) && input.node.right.type === 'Identifier'
			? Option.some([`instanceof ${input.node.right.name}`])
			: Option.none()
	}
	return pipe(
		Option.firstSomeOf([
			comparison({name: input.name, operator: input.node.operator, other: input.node.right, subject: input.node.left}),
			comparison({name: input.name, operator: input.node.operator, other: input.node.left, subject: input.node.right})
		]),
		Option.map(Array.of)
	)
}

function report(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	const predicate = input.node.returnType?.typeAnnotation
	const returned = returnedExpression(input.node)
	if (
		predicate?.type !== 'TSTypePredicate' ||
		predicate.asserts ||
		predicate.parameterName.type !== 'Identifier' ||
		Predicate.isNullish(returned)
	) {
		return
	}
	const name = pipe(
		check({name: predicate.parameterName.name, node: returned}),
		Option.map(checks => pipe(checks, Array.sort(String.Order), Array.join(' && '))),
		Option.flatMap(key =>
			Record.get<string, string>(
				{
					'!= null': 'isNotNullish',
					'!== null': 'isNotNull',
					'!== null && !Array.isArray && typeof === object': 'isObject',
					'!== null && typeof === object': 'isObjectOrArray',
					'!== undefined': 'isNotUndefined',
					'== null': 'isNullish',
					'=== null': 'isNull',
					'=== undefined': 'isUndefined',
					'instanceof Date': 'isDate',
					'instanceof Error': 'isError',
					'instanceof Map': 'isMap',
					'instanceof RegExp': 'isRegExp',
					'instanceof Set': 'isSet',
					'instanceof Uint8Array': 'isUint8Array',
					'typeof === bigint': 'isBigInt',
					'typeof === boolean': 'isBoolean',
					'typeof === function': 'isFunction',
					'typeof === number': 'isNumber',
					'typeof === string': 'isString',
					'typeof === symbol': 'isSymbol',
					'typeof === undefined': 'isUndefined'
				},
				key
			)
		)
	)
	Option.map(name, guard => {
		input.context.report({message: `Use Predicate.${guard} instead of this hand-written type guard.`, node: input.node})
	})
}

export const noHandWrittenGuard = defineRule({
	create: context => ({
		ArrowFunctionExpression: node => {
			report({context, node})
		},
		FunctionDeclaration: node => {
			report({context, node})
		},
		FunctionExpression: node => {
			report({context, node})
		}
	}),
	meta: {type: 'problem'}
})
