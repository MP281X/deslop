import {Array, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {replaceableGuard} from '#rules/no-hand-written-guard.ts'
import {effectImport, variableFor} from '#rules/shared.ts'

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

// A `declare`d name may not exist at run time, where `typeof` still answers and a call throws.
function ambient(node: ESTree.Node): boolean {
	if ((Predicate.hasProperty(node, 'declare') && node.declare) || node.type === 'TSDeclareFunction') {
		return true
	}
	return Predicate.isNotNullish(node.parent) && ambient(node.parent)
}

// `typeof value === 'string'` on a name declared in code becomes `Predicate.isString(value)`; `object` has no single guard.
function fix(input: {context: Context; fixer: Fixer; node: ESTree.UnaryExpression}) {
	if (
		input.node.argument.type !== 'Identifier' ||
		Option.exists(variableFor(input.context, input.node.argument), variable =>
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
	return Option.getOrElse(
		Option.map(
			effectImport({context: input.context, fixer: input.fixer, name: 'Predicate', node: input.node}),
			imports => Array.append(imports, replacement)
		),
		() => []
	)
}

export const noTypeof = defineRule({
	create: context => ({
		UnaryExpression: node => {
			if (node.operator !== 'typeof') return
			if (
				node.argument.type === 'Identifier' &&
				!Option.exists(variableFor(context, node.argument), variable => Array.isArrayNonEmpty(variable.defs))
			) {
				return
			}
			// no-hand-written-guard replaces the whole guard.
			if (Option.exists(enclosingFunction(node), fn => Option.isSome(replaceableGuard(fn)))) return
			context.report({
				fix: fixer => fix({context, fixer, node}),
				message:
					'Replace typeof with its Predicate guard: Predicate.isString, isNumber, isBoolean, isFunction, isObject or isUndefined.',
				node
			})
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
