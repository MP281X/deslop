import {Array, Option, Predicate, Record, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {effectImport, memberName, returnedExpression, variableOf} from '#lib/ast.ts'

const GUARDS: Record<string, string> = {
	bigint: 'isBigInt',
	boolean: 'isBoolean',
	function: 'isFunction',
	number: 'isNumber',
	string: 'isString',
	symbol: 'isSymbol',
	undefined: 'isUndefined'
}
const NEGATIONS = {'!==': '!', '===': ''}

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
		return Option.map(
			Option.all([check({name: input.name, node: input.node.left}), check({name: input.name, node: input.node.right})]),
			Array.flatten
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
		if (!isSubject({name: input.name, node: input.node.left}) || input.node.right.type !== 'Identifier') {
			return Option.none()
		}
		return Option.some([`instanceof ${input.node.right.name}`])
	}
	return Option.map(
		Option.firstSomeOf([
			comparison({name: input.name, operator: input.node.operator, other: input.node.right, subject: input.node.left}),
			comparison({name: input.name, operator: input.node.operator, other: input.node.left, subject: input.node.right})
		]),
		Array.of
	)
}

// Prefer the whole Predicate guard to replacing just its inner typeof comparison.
function replaceableGuard(node: ESTree.Function | ESTree.ArrowFunctionExpression) {
	const predicate = node.returnType?.typeAnnotation
	const returned = returnedExpression(node)
	if (
		predicate?.type !== 'TSTypePredicate' ||
		predicate.asserts ||
		predicate.parameterName.type !== 'Identifier' ||
		Predicate.isNullish(returned)
	) {
		return Option.none<string>()
	}
	return pipe(
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
					...Record.mapKeys(GUARDS, name => `typeof === ${name}`)
				},
				key
			)
		)
	)
}

function report(input: {context: Context; node: ESTree.Function | ESTree.ArrowFunctionExpression}) {
	Option.map(replaceableGuard(input.node), guard =>
		input.context.report({message: `Use Predicate.${guard} instead of this hand-written type guard.`, node: input.node})
	)
}

function enclosingFunction(node: ESTree.Node): Option.Option<ESTree.Function | ESTree.ArrowFunctionExpression> {
	if (
		node.type === 'ArrowFunctionExpression' ||
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression'
	) {
		return Option.some(node)
	}
	return Option.flatMap(Option.fromNullishOr(node.parent), enclosingFunction)
}

// A declared name may not exist at runtime: typeof still answers where a call throws.
function ambient(node: ESTree.Node): boolean {
	if ((Predicate.hasProperty(node, 'declare') && node.declare) || node.type === 'TSDeclareFunction') return true
	return Predicate.isNotNullish(node.parent) && ambient(node.parent)
}

function fix(input: {context: Context; fixer: Fixer; node: ESTree.UnaryExpression}) {
	if (
		input.node.argument.type !== 'Identifier' ||
		Option.exists(variableOf(input.context, input.node.argument), variable =>
			Array.some(variable.defs, definition => ambient(definition.node))
		) ||
		input.node.parent.type !== 'BinaryExpression' ||
		input.node.parent.left !== input.node ||
		(input.node.parent.operator !== '===' && input.node.parent.operator !== '!==') ||
		input.node.parent.right.type !== 'Literal' ||
		!Predicate.isString(input.node.parent.right.value)
	) {
		return []
	}
	const guard = GUARDS[input.node.parent.right.value]
	if (guard === undefined) return []
	const replacement = input.fixer.replaceTextRange(
		input.node.parent.range,
		`${NEGATIONS[input.node.parent.operator]}Predicate.${guard}(${input.node.argument.name})`
	)
	return pipe(
		effectImport({context: input.context, fixer: input.fixer, name: 'Predicate', node: input.node}),
		Option.map(imports => Array.append(imports, replacement)),
		Option.getOrElse(() => [])
	)
}

export const preferPredicate = defineRule({
	create: context => ({
		ArrowFunctionExpression: node => {
			report({context, node})
		},
		FunctionDeclaration: node => {
			report({context, node})
		},
		FunctionExpression: node => {
			report({context, node})
		},
		UnaryExpression: node => {
			if (node.operator !== 'typeof') return
			if (
				node.argument.type === 'Identifier' &&
				!Option.exists(variableOf(context, node.argument), variable => Array.isArrayNonEmpty(variable.defs))
			) {
				return
			}
			if (Option.exists(enclosingFunction(node), fn => Option.isSome(replaceableGuard(fn)))) return
			context.report({
				fix: fixer => fix({context, fixer, node}),
				message:
					'Replace typeof with its Predicate guard: Predicate.isString, isNumber, isBoolean, isFunction, isObject or isUndefined.',
				node
			})
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Predicate} from 'effect'
export function describeValue(value: unknown) { return {isText: Predicate.isString(value), value} }`
					}
				],
				fixes: [
					{
						'sample.ts': `export function describeValue(value: unknown) { return {isText: typeof value === 'string', value} }`
					}
				]
			}
		},
		fixable: 'code',
		type: 'problem'
	}
})
